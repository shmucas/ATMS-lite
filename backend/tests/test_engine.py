"""SignalEngine semantics under a fake clock: deterministic, no sleeping."""

import signal_engine
from signal_engine import GREEN, RED, SignalEngine

TIMING = {'min_green': 5.0, 'max_green': 20.0, 'extend': 3.0,
          'yellow': 2.0, 'red_clear': 1.0, 'walk': 3.0, 'ped_clear': 3.0}


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def monotonic(self):
        return self.t

    def advance(self, engine, seconds, step=0.1):
        end = self.t + seconds
        while self.t < end:
            self.t = min(self.t + step, end)
            engine.tick()


def make_engine(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(signal_engine.time, 'monotonic', clock.monotonic)
    return SignalEngine(TIMING), clock


def greens(engine):
    return {n for n, ph in engine.phases.items() if ph.signal == GREEN}


def test_free_running_serves_both_barriers(monkeypatch):
    engine, clock = make_engine(monkeypatch)
    seen = set()
    for _ in range(20):
        clock.advance(engine, 5)
        seen |= greens(engine)
    assert {2, 6} <= seen and {3, 7} & seen


def test_omitted_phase_never_serves(monkeypatch):
    engine, clock = make_engine(monkeypatch)
    engine.set_group_mask('omit', 1, 0b0000_0110)  # omit 2 and 3
    seen = set()
    for _ in range(40):
        clock.advance(engine, 5)
        seen |= greens(engine)
    assert 2 not in seen and 3 not in seen
    assert seen  # everything else still cycles


def test_hold_pins_green_past_max_and_release_resumes(monkeypatch):
    engine, clock = make_engine(monkeypatch)
    clock.advance(engine, 1)
    assert 2 in greens(engine)  # recall phase serving at start
    engine.set_group_mask('hold', 1, 0b0000_0010)
    clock.advance(engine, 3 * TIMING['max_green'])
    assert 2 in greens(engine)
    engine.set_group_mask('hold', 1, 0)
    start_cycles = engine.cycle_count
    clock.advance(engine, 60)
    assert engine.cycle_count > start_cycles


def test_force_off_ends_green_at_min_green(monkeypatch):
    engine, clock = make_engine(monkeypatch)
    clock.advance(engine, 1)
    assert 2 in greens(engine)
    engine.set_group_mask('veh', 1, 0b0000_0010)       # standing call extends
    engine.set_group_mask('forceoff', 1, 0b0000_0010)  # but force-off wins
    clock.advance(engine, TIMING['min_green'] + 1)
    assert engine.phases[2].signal != GREEN


def test_veh_call_brings_side_street(monkeypatch):
    engine, clock = make_engine(monkeypatch)
    engine.set_veh_call(3)
    seen = set()
    for _ in range(40):
        clock.advance(engine, 5)
        seen |= greens(engine)
        if 3 in seen:
            break
    assert 3 in seen


def test_status_masks_are_consistent(monkeypatch):
    engine, clock = make_engine(monkeypatch)
    clock.advance(engine, 7)
    masks = engine.status_masks()
    for num, ph in engine.phases.items():
        bit = 1 << (num - 1)
        assert bool(masks['greens'] & bit) == (ph.signal == GREEN)
        assert bool(masks['reds'] & bit) == (ph.signal == RED)
    # Exactly one signal state per phase.
    assert masks['reds'] & masks['greens'] == 0
    assert masks['reds'] & masks['yellows'] == 0
