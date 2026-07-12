"""Dual-ring, eight-phase actuated NEMA signal engine.

Models the standard ring-and-barrier layout the bench 2070 uses:

    Ring 1:  1  2 | 3  4
    Ring 2:  5  6 | 7  8
             barrier

Concurrent phases (one per ring, same side of the barrier) run together. Each
phase times green (min green extended by actuation up to max), yellow change,
and red clearance. A barrier crossing waits for both rings to be ready.

This is a real actuated engine, not a canned animation: vehicle and ped calls
change what serves and for how long, which is what makes the emulator useful
for exercising the ATMS control path.
"""

import time


# Per-phase timing (seconds). Mirrors typical 2070 defaults.
DEFAULT_TIMING = {
    'min_green': 7.0,
    'max_green': 30.0,
    'extend': 3.0,       # each vehicle actuation extends green by this, up to max
    'yellow': 3.5,
    'red_clear': 1.5,
    'walk': 7.0,
    'ped_clear': 10.0,
}

RING1 = [1, 2, 3, 4]
RING2 = [5, 6, 7, 8]
# Barrier groups: phases that may be green together.
BARRIERS = [[1, 2, 5, 6], [3, 4, 7, 8]]
# Coordinated mainline phases: on recall, so the intersection rests in green on
# them when there is no other demand, matching the bench controller.
COORDINATED = {2, 6}

GREEN, YELLOW, RED = 'green', 'yellow', 'red'


class Phase:
    def __init__(self, num, timing):
        self.num = num
        self.timing = timing
        self.signal = RED
        self.state_since = 0.0
        self.veh_call = False
        self.ped_call = False
        self.ped_state = 'dont_walk'  # walk / ped_clear / dont_walk
        self.extensions = 0.0
        self.recall = num in COORDINATED  # coordinated phases re-call each cycle
        # phaseControlGroup inputs (NTCIP columns 4, 2, 5). Hold pins an
        # active green; omit removes the phase from selection once it has
        # finished serving; force-off terminates green as soon as the
        # minimum green has been served.
        self.hold = False
        self.omit = False
        self.force_off = False

    def ring(self):
        return 1 if self.num in RING1 else 2


class SignalEngine:
    """Advances two rings in lockstep across barriers. Call tick() often; it is
    time-based, not tick-count based, so poll rate does not affect timing."""

    def __init__(self, timing=None):
        t = {**DEFAULT_TIMING, **(timing or {})}
        self.phases = {n: Phase(n, t) for n in range(1, 9)}
        self.barrier = 0
        # Active phase per ring within the current barrier.
        self.active = {1: None, 2: None}
        self.cycle_count = 0
        self._now = time.monotonic()
        self._start_barrier()

    # --- external inputs (the ATMS control path drives these) ---

    def set_veh_call(self, phase, on=True):
        if phase in self.phases:
            self.phases[phase].veh_call = on

    def set_ped_call(self, phase, on=True):
        if phase in self.phases:
            self.phases[phase].ped_call = on

    def set_group_mask(self, kind, group, mask):
        """Apply a phaseControlGroup bitmask (group of 8 phases)."""
        base = (group - 1) * 8
        for bit in range(8):
            phase = base + bit + 1
            if phase in self.phases:
                on = bool(mask & (1 << bit))
                ph = self.phases[phase]
                if kind == 'veh':
                    ph.veh_call = on
                elif kind == 'ped':
                    ph.ped_call = on
                elif kind == 'hold':
                    ph.hold = on
                elif kind == 'omit':
                    ph.omit = on
                elif kind == 'forceoff':
                    ph.force_off = on

    # --- engine core ---

    def _phases_in(self, ring, barrier):
        members = BARRIERS[barrier]
        ring_phases = RING1 if ring == 1 else RING2
        return [p for p in ring_phases if p in members]

    def _next_phase(self, ring, barrier):
        """Pick the next phase to serve in this ring/barrier: the first with a
        call, else the first (so coordination keeps the mainline moving).
        Omitted phases are never selected."""
        candidates = [p for p in self._phases_in(ring, barrier)
                      if not self.phases[p].omit]
        for p in candidates:
            ph = self.phases[p]
            if ph.veh_call or ph.ped_call or ph.recall:
                return p
        return candidates[0] if candidates else None

    def _start_barrier(self):
        for ring in (1, 2):
            phase = self._next_phase(ring, self.barrier)
            self.active[ring] = phase
            if phase is not None:
                self._set_green(phase)

    def _set_green(self, phase):
        ph = self.phases[phase]
        ph.signal = GREEN
        ph.state_since = self._now
        ph.extensions = 0.0
        ph.ped_state = 'walk' if ph.ped_call else 'dont_walk'

    def _elapsed(self, ph):
        return self._now - ph.state_since

    def _green_done(self, ph):
        t = ph.timing
        elapsed = self._elapsed(ph)
        # A held phase never terminates its green; hold wins over force-off,
        # matching controller behavior where force-off cannot end a hold.
        if ph.hold:
            return False
        if elapsed < t['min_green']:
            return False
        # Force-off terminates green as soon as the minimum has been served.
        if ph.force_off:
            return True
        # Ped timing holds green through walk + ped clear.
        if ph.ped_state == 'walk' and elapsed < t['walk']:
            return False
        # Actuated extension: a standing vehicle call extends up to max green.
        cap = min(t['max_green'], t['min_green'] + ph.extensions)
        if ph.veh_call and elapsed < t['max_green']:
            ph.extensions = min(t['max_green'] - t['min_green'],
                                ph.extensions + t['extend'])
            return False
        return elapsed >= cap

    def tick(self):
        self._now = time.monotonic()
        for ring in (1, 2):
            phase = self.active[ring]
            if phase is None:
                continue
            ph = self.phases[phase]
            t = ph.timing
            elapsed = self._elapsed(ph)

            if ph.signal == GREEN:
                # Update ped sub-state.
                if ph.ped_state == 'walk' and elapsed >= t['walk']:
                    ph.ped_state = 'ped_clear'
                if (ph.ped_state == 'ped_clear'
                        and elapsed >= t['walk'] + t['ped_clear']):
                    ph.ped_state = 'dont_walk'
                    ph.ped_call = False
                if self._green_done(ph):
                    ph.signal = YELLOW
                    ph.state_since = self._now
                    ph.veh_call = False
            elif ph.signal == YELLOW:
                if elapsed >= t['yellow']:
                    ph.signal = RED
                    ph.state_since = self._now
            # RED phases are between-service; handled by barrier advance below.

        self._maybe_advance()

    def _maybe_advance(self):
        """When both active phases have finished (are red past red-clear),
        advance to the next phase or barrier."""
        for ring in (1, 2):
            phase = self.active[ring]
            if phase is None:
                continue
            ph = self.phases[phase]
            if ph.signal != RED:
                return  # a ring is still serving; wait
            if self._elapsed(ph) < ph.timing['red_clear']:
                return  # still in red clearance

        # Both rings cleared. Advance the barrier (wrap counts a cycle).
        self.barrier += 1
        if self.barrier >= len(BARRIERS):
            self.barrier = 0
            self.cycle_count += 1
        self._start_barrier()

    # --- outputs the SNMP agent reads ---

    def status_masks(self):
        """Return the phaseStatusGroup bitmasks for group 1 (phases 1-8)."""
        masks = {'reds': 0, 'yellows': 0, 'greens': 0, 'dont_walks': 0,
                 'ped_clears': 0, 'walks': 0, 'veh_calls': 0, 'ped_calls': 0,
                 'phase_ons': 0, 'phase_nexts': 0}
        next_phases = {self._next_phase(r, self.barrier) for r in (1, 2)}
        for num, ph in self.phases.items():
            bit = 1 << (num - 1)
            if ph.signal == RED:
                masks['reds'] |= bit
            elif ph.signal == YELLOW:
                masks['yellows'] |= bit
            elif ph.signal == GREEN:
                masks['greens'] |= bit
            if ph.ped_state == 'walk':
                masks['walks'] |= bit
            elif ph.ped_state == 'ped_clear':
                masks['ped_clears'] |= bit
            else:
                masks['dont_walks'] |= bit
            if ph.veh_call:
                masks['veh_calls'] |= bit
            if ph.ped_call:
                masks['ped_calls'] |= bit
            if self.active.get(ph.ring()) == num and ph.signal != RED:
                masks['phase_ons'] |= bit
            if num in next_phases:
                masks['phase_nexts'] |= bit
        return masks
