"""Control path with a server-side safety interlock.

Every write to a controller is refused unless that intersection is explicitly
armed. Arming is per-intersection and expires on a timer so a forgotten armed
session cannot linger. All calls are cleared automatically on disarm, on
disconnect, and on shutdown, and every write is appended to an audit log.

The control bitmask columns are in NTCIP phaseControlGroupTable (asc.1.5.1):
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
        self._lock = asyncio.Lock()

    def status(self):
        return {
            'armed': self.armed,
            'armed_until': self.armed_until,
            'veh_calls': dict(self._veh),
            'ped_calls': dict(self._ped),
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
        polled = self.hub.static.get(self.cfg['id'], {}).get('polled_phases', 8)
        if not 1 <= phase <= polled:
            raise ControlError(f'phase {phase} out of range 1..{polled}')
        async with self._lock:
            self._check_armed()
            group = (phase - 1) // 8 + 1
            bit = 1 << ((phase - 1) % 8)
            store = self._veh if kind == 'veh' else self._ped
            mask = store.get(group, 0)
            mask = (mask | bit) if on else (mask & ~bit)
            column = VEH_CALL_COL if kind == 'veh' else PED_CALL_COL
            await self._write(column, group, mask, actor,
                              f'{kind}_call phase {phase} {"on" if on else "off"}')
            store[group] = mask
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
        self._veh.clear()
        self._ped.clear()

    async def on_disconnect(self):
        """Called by the poller when the link drops. Drop arm and desired
        state so a reconnect never silently re-applies stale calls."""
        async with self._lock:
            if self.armed or self._veh or self._ped:
                self.audit.write(self.cfg['id'], 'system', 'auto-disarm',
                                 {'reason': 'controller disconnected'})
            self.armed = False
            self.armed_until = None
            self._veh.clear()
            self._ped.clear()
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
