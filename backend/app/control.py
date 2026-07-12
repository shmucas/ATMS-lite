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
from .snmp import SnmpError

log = logging.getLogger('atms.control')

OMIT_COL = 2
HOLD_COL = 4
FORCE_OFF_COL = 5
VEH_CALL_COL = 6
PED_CALL_COL = 7
ARM_TIMEOUT_S = 300  # an armed intersection auto-disarms after 5 minutes


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
        self.armed_until = None
        # Desired call masks, keyed (kind, group) -> bitmask. Source of truth
        # for what we have asked the controller to hold.
        self._veh = {}
        self._ped = {}
        self._hold = {}
        self._omit = {}
        self._forced_phase = None
        self._lock = asyncio.Lock()

    def status(self):
        return {
            'armed': self.armed,
            'armed_until': self.armed_until,
            'veh_calls': dict(self._veh),
            'ped_calls': dict(self._ped),
            'holds': dict(self._hold),
            'omits': dict(self._omit),
            'forced_phase': self._forced_phase,
        }

    def _check_armed(self):
        if not self.armed:
            raise ControlError('intersection is not armed')
        if self.armed_until and _now() > self.armed_until:
            raise ControlError('arm window expired; re-arm to send controls')

    async def arm(self, actor='ui'):
        async with self._lock:
            self.armed = True
            until = datetime.datetime.now(datetime.timezone.utc) + \
                datetime.timedelta(seconds=ARM_TIMEOUT_S)
            self.armed_until = until.isoformat(timespec='milliseconds')
            self.audit.write(self.cfg['id'], actor, 'arm', {})
            self._publish()
        return self.status()

    async def disarm(self, actor='ui', reason='manual'):
        async with self._lock:
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

    async def hold_phase(self, phase, on=True, actor='ui'):
        self._check_phase(phase)
        async with self._lock:
            self._check_armed()
            group, mask = self._set_bit(self._hold, phase, on)
            await self._write(HOLD_COL, group, mask, actor,
                              f'hold phase {phase} {"on" if on else "off"}')
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
                for other in ring['phases']:
                    if other == phase:
                        continue
                    group, mask = self._set_bit(self._omit, other, True)
                    await self._write(OMIT_COL, group, mask, actor,
                                      f'omit phase {other} (forcing {phase})')
                group, mask = self._set_bit(self._veh, phase, True)
                await self._write(VEH_CALL_COL, group, mask, actor,
                                  f'veh_call phase {phase} on (force)')
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
        self._veh.clear()
        self._ped.clear()
        self._hold.clear()
        self._omit.clear()
        self._forced_phase = None

    async def on_disconnect(self):
        """Called by the poller when the link drops. Drop arm and desired
        state so a reconnect never silently re-applies stale calls."""
        async with self._lock:
            if self.armed or self._veh or self._ped or self._hold or self._omit:
                self.audit.write(self.cfg['id'], 'system', 'auto-disarm',
                                 {'reason': 'controller disconnected'})
            self.armed = False
            self.armed_until = None
            self._veh.clear()
            self._ped.clear()
            self._hold.clear()
            self._omit.clear()
            self._forced_phase = None
            self._publish()

    async def shutdown(self):
        async with self._lock:
            await self._clear_all_locked('system', 'shutdown')
            self.armed = False

    def _publish(self):
        self.hub.control[self.cfg['id']] = self.status()
        self.hub.publish_control(self.cfg['id'], self.status())


class AuditLog:
    """Append-only JSONL audit of every control action."""

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
        lines = self.path.read_text().splitlines()[-limit:]
        return [json.loads(line) for line in lines]
