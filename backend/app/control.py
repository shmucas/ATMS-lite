"""Control path with a server-side safety interlock.

Every write to a controller is refused unless that intersection is explicitly
armed. Arming is per-intersection and expires on a timer so a forgotten armed
session cannot linger. All calls are cleared automatically on disarm, on
disconnect, and on shutdown, and every write is appended to an audit log.

The control bitmask columns are in NTCIP phaseControlGroupTable (asc.1.5.1),
confirmed against the bench unit (see docs/ntcip-oids.md):
  col 2 = phaseControlGroupPhaseOmit
  col 4 = phaseControlGroupHold
  col 5 = phaseControlGroupForceOff
  col 6 = phaseControlGroupVehCall
  col 7 = phaseControlGroupPedCall
Each is an 8-bit mask per group of 8 phases.
"""

import asyncio
import datetime
import json
import logging
import pathlib

from . import ntcip
from .config import ARM_TIMEOUT_S
from .snmp import SnmpError

log = logging.getLogger('atms.control')

OMIT_COL = 2
HOLD_COL = 4
FORCE_OFF_COL = 5
VEH_CALL_COL = 6
PED_CALL_COL = 7


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')


def control_oid(column, group):
    return f'{ntcip.ASC}.1.5.1.{column}.{group}'


class ControlError(Exception):
    pass


class Controller:
    """One per intersection. Holds the arm state and desired call masks, and
    owns the only code path that writes to the physical controller."""

    def __init__(self, cfg, client, hub, audit):
        self.cfg = cfg
        self.client = client
        self.hub = hub
        self.audit = audit
        self.armed = False
        self.armed_until = None  # datetime, serialized to ISO in status()
        self._expiry_task = None
        # Desired call masks, keyed (kind, group) -> bitmask. Source of truth
        # for what we have asked the controller to hold.
        self._veh = {}
        self._ped = {}
        self._hold = {}
        self._omit = {}
        self._force_off = {}
        self._forced_phase = None
        self._lock = asyncio.Lock()

    def status(self):
        return {
            'armed': self.armed,
            'armed_until': (self.armed_until.isoformat(timespec='milliseconds')
                            if self.armed_until else None),
            'veh_calls': dict(self._veh),
            'ped_calls': dict(self._ped),
            'holds': dict(self._hold),
            'omits': dict(self._omit),
            'force_offs': dict(self._force_off),
            'forced_phase': self._forced_phase,
        }

    def _check_armed(self):
        if not self.armed:
            raise ControlError('intersection is not armed')
        if (self.armed_until
                and datetime.datetime.now(datetime.timezone.utc) > self.armed_until):
            raise ControlError('arm window expired; re-arm to send controls')

    def _cancel_expiry(self):
        task = self._expiry_task
        self._expiry_task = None
        if (task is not None and not task.done()
                and task is not asyncio.current_task()):
            task.cancel()

    async def _expire_arm(self):
        """Runs while armed; at the deadline it disarms, which clears every
        mask on the controller. Cancelled by re-arm, disarm, and disconnect."""
        try:
            await asyncio.sleep(ARM_TIMEOUT_S)
        except asyncio.CancelledError:
            return
        # Detach first so disarm's _cancel_expiry never cancels this task
        # out from under itself mid-write.
        self._expiry_task = None
        if not self.armed:
            return
        try:
            await self.disarm(actor='system', reason='arm window expired')
        except Exception:
            log.exception('[%s] auto-disarm at arm expiry failed', self.cfg['id'])

    async def arm(self, actor='ui'):
        async with self._lock:
            self.armed = True
            self.armed_until = (datetime.datetime.now(datetime.timezone.utc)
                                + datetime.timedelta(seconds=ARM_TIMEOUT_S))
            self._cancel_expiry()
            self._expiry_task = asyncio.create_task(
                self._expire_arm(), name=f"arm-expiry-{self.cfg['id']}")
            self.audit.write(self.cfg['id'], actor, 'arm', {})
            self._publish()
        return self.status()

    async def disarm(self, actor='ui', reason='manual'):
        async with self._lock:
            self._cancel_expiry()
            await self._clear_all_locked(actor, reason)
            self.armed = False
            self.armed_until = None
            self.audit.write(self.cfg['id'], actor, 'disarm', {'reason': reason})
            self._publish()
        return self.status()

    async def place_call(self, kind, phase, on=True, actor='ui'):
        if kind not in ('veh', 'ped'):
            raise ControlError(f'unknown call kind {kind}')
        self._check_phase(phase)
        async with self._lock:
            self._check_armed()
            store = self._veh if kind == 'veh' else self._ped
            column = VEH_CALL_COL if kind == 'veh' else PED_CALL_COL
            group, mask = self._set_bit(store, phase, on)
            await self._write(column, group, mask, actor,
                              f'{kind}_call phase {phase} {"on" if on else "off"}')
            self._publish()
        return self.status()

    def _set_bit(self, store, phase, on):
        group = (phase - 1) // 8 + 1
        bit = 1 << ((phase - 1) % 8)
        mask = store.get(group, 0)
        mask = (mask | bit) if on else (mask & ~bit)
        store[group] = mask
        return group, mask

    def _check_phase(self, phase):
        polled = self.hub.static.get(self.cfg['id'], {}).get('polled_phases', 8)
        if not 1 <= phase <= polled:
            raise ControlError(f'phase {phase} out of range 1..{polled}')

    def _check_concurrent(self, phases):
        """A phase pair (or larger group) may only be held or forced off
        together if the controller's own concurrency table says they can run
        at the same time. Ground truth is per-phase concurrency, not the
        coarser barrier grouping, which can bundle phases that are not all
        pairwise concurrent (split/lag phasing)."""
        if len(phases) <= 1:
            return
        concurrency = self.hub.static.get(self.cfg['id'], {}).get('concurrency', {})
        for a in phases:
            allowed = set(concurrency.get(a, []))
            for b in phases:
                if b != a and b not in allowed:
                    raise ControlError(
                        f'phases {a} and {b} cannot run concurrently')

    def _set_bits(self, store, phases, on):
        """Set/clear bits for every phase in `phases`, returning the final
        mask for each group touched so the caller writes each group once."""
        groups = {}
        for phase in phases:
            group, mask = self._set_bit(store, phase, on)
            groups[group] = mask
        return groups

    async def hold_group(self, phases, on=True, actor='ui'):
        """Hold one phase, or a concurrent phase pair, in its current
        interval. Passing a single phase is the common case."""
        for phase in phases:
            self._check_phase(phase)
        self._check_concurrent(phases)
        async with self._lock:
            self._check_armed()
            groups = self._set_bits(self._hold, phases, on)
            for group, mask in groups.items():
                await self._write(HOLD_COL, group, mask, actor,
                                  f'hold phases {phases} {"on" if on else "off"}')
            self._publish()
        return self.status()

    async def hold_phase(self, phase, on=True, actor='ui'):
        return await self.hold_group([phase], on=on, actor=actor)

    async def force_off_group(self, phases, on=True, actor='ui'):
        """True NTCIP force-off (phaseControlGroupForceOff): ends a phase's
        green early so the ring can advance. One phase, or a concurrent
        phase pair forced off together to clear a whole barrier."""
        for phase in phases:
            self._check_phase(phase)
        self._check_concurrent(phases)
        async with self._lock:
            self._check_armed()
            groups = self._set_bits(self._force_off, phases, on)
            for group, mask in groups.items():
                await self._write(FORCE_OFF_COL, group, mask, actor,
                                  f'force off phases {phases} {"on" if on else "off"}')
            self._publish()
        return self.status()

    async def force_phase(self, phase, on=True, actor='ui'):
        """Force a single phase to serve now: omit every other phase in its
        ring and place a call on the target. Releasing clears only the omit
        bits this action set, and only for the phase it forced."""
        self._check_phase(phase)
        rings = self.hub.static.get(self.cfg['id'], {}).get('rings', [])
        ring = next((r for r in rings if phase in r['phases']), None)
        if ring is None:
            raise ControlError(f'phase {phase} is not in a known ring')
        async with self._lock:
            self._check_armed()
            if on:
                if self._forced_phase is not None and self._forced_phase != phase:
                    raise ControlError(
                        f'phase {self._forced_phase} is already forced; release it first')
                # Roll back any omits already written if a later SET fails,
                # so a half-applied force never leaves phases stuck omitted.
                applied = []
                try:
                    for other in ring['phases']:
                        if other == phase:
                            continue
                        group, mask = self._set_bit(self._omit, other, True)
                        await self._write(OMIT_COL, group, mask, actor,
                                          f'omit phase {other} (forcing {phase})')
                        applied.append(other)
                    group, mask = self._set_bit(self._veh, phase, True)
                    await self._write(VEH_CALL_COL, group, mask, actor,
                                      f'veh_call phase {phase} on (force)')
                except ControlError:
                    self._set_bit(self._veh, phase, False)
                    # Clear the store bit for every omit attempted (the failed
                    # write set its bit locally too), but only re-write the
                    # ones that actually reached the controller.
                    for other in ring['phases']:
                        if other == phase:
                            continue
                        group, mask = self._set_bit(self._omit, other, False)
                        if other not in applied:
                            continue
                        try:
                            await self._write(
                                OMIT_COL, group, mask, actor,
                                f'rollback omit phase {other} (force {phase} failed)')
                        except ControlError:
                            pass
                    raise
                self._forced_phase = phase
            else:
                for other in ring['phases']:
                    if other == phase:
                        continue
                    group, mask = self._set_bit(self._omit, other, False)
                    await self._write(OMIT_COL, group, mask, actor,
                                      f'clear omit phase {other} (release force {phase})')
                self._forced_phase = None
            self._publish()
        return self.status()

    async def _write(self, column, group, mask, actor, detail):
        oid = control_oid(column, group)
        try:
            echoed = await self.client.set_int(oid, mask)
        except SnmpError as exc:
            self.audit.write(self.cfg['id'], actor, 'write-failed',
                             {'oid': oid, 'mask': mask, 'error': str(exc)})
            raise ControlError(f'SNMP SET failed: {exc}')
        self.audit.write(self.cfg['id'], actor, 'write',
                         {'detail': detail, 'oid': oid, 'mask': mask,
                          'echoed': echoed})
        log.info('[%s] %s -> %s (mask %s)', self.cfg['id'], detail, oid, mask)

    async def _clear_all_locked(self, actor, reason):
        """Zero every call mask we have set. Best effort: a disconnected
        controller cannot be written, but our desired state still goes to
        zero so nothing is re-sent on reconnect."""
        for group, mask in list(self._veh.items()):
            if mask:
                try:
                    await self._write(VEH_CALL_COL, group, 0, actor,
                                      f'clear veh group {group} ({reason})')
                except ControlError:
                    pass
        for group, mask in list(self._ped.items()):
            if mask:
                try:
                    await self._write(PED_CALL_COL, group, 0, actor,
                                      f'clear ped group {group} ({reason})')
                except ControlError:
                    pass
        for group, mask in list(self._hold.items()):
            if mask:
                try:
                    await self._write(HOLD_COL, group, 0, actor,
                                      f'clear hold group {group} ({reason})')
                except ControlError:
                    pass
        for group, mask in list(self._omit.items()):
            if mask:
                try:
                    await self._write(OMIT_COL, group, 0, actor,
                                      f'clear omit group {group} ({reason})')
                except ControlError:
                    pass
        for group, mask in list(self._force_off.items()):
            if mask:
                try:
                    await self._write(FORCE_OFF_COL, group, 0, actor,
                                      f'clear force off group {group} ({reason})')
                except ControlError:
                    pass
        self._veh.clear()
        self._ped.clear()
        self._hold.clear()
        self._omit.clear()
        self._force_off.clear()
        self._forced_phase = None

    async def on_disconnect(self):
        """Called by the poller when the link drops. Drop arm and desired
        state so a reconnect never silently re-applies stale calls."""
        async with self._lock:
            self._cancel_expiry()
            if (self.armed or self._veh or self._ped or self._hold
                    or self._omit or self._force_off):
                self.audit.write(self.cfg['id'], 'system', 'auto-disarm',
                                 {'reason': 'controller disconnected'})
            self.armed = False
            self.armed_until = None
            self._veh.clear()
            self._ped.clear()
            self._hold.clear()
            self._omit.clear()
            self._force_off.clear()
            self._forced_phase = None
            self._publish()

    async def shutdown(self):
        async with self._lock:
            self._cancel_expiry()
            await self._clear_all_locked('system', 'shutdown')
            self.armed = False
            self.armed_until = None

    def _publish(self):
        self.hub.control[self.cfg['id']] = self.status()
        self.hub.publish_control(self.cfg['id'], self.status())


class AuditLog:
    """Append-only JSONL audit of every control action."""

    # tail() reads at most this many bytes off the end of the file, so the
    # endpoint's cost stays flat as the log grows over months of bench work.
    TAIL_READ_BYTES = 512 * 1024

    def __init__(self, path):
        self.path = pathlib.Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, intersection_id, actor, action, detail):
        record = {'ts': _now(), 'intersection_id': intersection_id,
                  'actor': actor, 'action': action, **detail}
        with self.path.open('a') as fh:
            fh.write(json.dumps(record) + '\n')

    def tail(self, limit=100):
        if not self.path.exists():
            return []
        with self.path.open('rb') as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - self.TAIL_READ_BYTES))
            chunk = fh.read().decode(errors='replace')
        lines = chunk.splitlines()
        # A mid-line start point leaves a partial first record; drop it.
        if size > self.TAIL_READ_BYTES and lines:
            lines = lines[1:]
        out = []
        for line in lines[-limit:]:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out
