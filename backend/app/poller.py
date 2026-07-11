"""Per-intersection poll loop with a connection state machine.

States: connected -> degraded (first missed poll) -> disconnected (third
consecutive miss). While disconnected the loop keeps probing at a slow
cadence and recovers on the first successful reply. Health is judged by
SNMP responses only; this controller drops or ignores other traffic.
"""

import asyncio
import collections
import datetime
import logging
import time

from . import ntcip
from .snmp import SnmpClient, SnmpError

log = logging.getLogger('atms.poller')

CONNECTED = 'connected'
DEGRADED = 'degraded'
DISCONNECTED = 'disconnected'
STARTING = 'starting'

DISCONNECTED_AFTER = 3
RECONNECT_INTERVAL = 2.0


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')


class Poller:
    def __init__(self, cfg, hub, poll_hz):
        self.cfg = cfg
        self.hub = hub
        self.interval = 1.0 / poll_hz
        self.client = SnmpClient(cfg['host'], cfg['port'], cfg['read_community'],
                                 timeout=1.0, retries=1,
                                 write_community=cfg.get('write_community'))
        # Starts in its own state, not DISCONNECTED, so that a controller which
        # is already dead at boot still emits a disconnected event.
        self.state = STARTING
        self.failures = 0
        self.seq = 0
        self.groups = 1
        self.max_phases = 8
        self.controller = None  # set by main after construction
        self.last_uptime = None
        self.last_latency_ms = None
        self.cycle_length = None
        self.recent_cycles = collections.deque(maxlen=10)
        self.last_greens = set()
        self.reference_phase = None
        self.last_cycle_start = None
        self._static_loaded = False

    def _event(self, kind, detail=''):
        event = {'intersection_id': self.cfg['id'], 'ts': _now(),
                 'kind': kind, 'detail': detail}
        log.info('[%s] %s %s', self.cfg['id'], kind, detail)
        self.hub.publish_event(event)

    async def _load_static(self):
        values = await self.client.get(
            [ntcip.SYS_DESCR, ntcip.MAX_PHASES, ntcip.MAX_PHASE_GROUPS])
        controller_max = int(values.get(ntcip.MAX_PHASES, 8) or 8)
        controller_groups = int(values.get(ntcip.MAX_PHASE_GROUPS, 1) or 1)
        self.groups = max(1, min(controller_groups,
                                 self.cfg.get('poll_groups', 2)))
        self.max_phases = min(controller_max, self.groups * 8)
        sys_descr = values.get(ntcip.SYS_DESCR, '')

        # Read the intersection's real ring structure off the controller rather
        # than assuming the textbook 8-phase layout.
        phases = list(range(1, self.max_phases + 1))
        ring_oids = [f'{ntcip.PHASE_RING}.{p}' for p in phases]
        conc_oids = [f'{ntcip.PHASE_CONCURRENCY}.{p}' for p in phases]
        rings, barriers = [], []
        try:
            cfg_values = await self.client.get(ring_oids + conc_oids)
            ring_by_phase = {}
            conc_by_phase = {}
            for p in phases:
                ring = cfg_values.get(f'{ntcip.PHASE_RING}.{p}')
                if ring is None:
                    continue
                ring_by_phase[p] = int(ring)
                conc_by_phase[p] = ntcip.parse_concurrency(
                    cfg_values.get(f'{ntcip.PHASE_CONCURRENCY}.{p}'))
            rings, barriers = ntcip.build_rings(ring_by_phase, conc_by_phase)
        except SnmpError as exc:
            # Ring config is a nicety; a controller that will not answer here
            # should still stream phase status.
            log.warning('[%s] could not read ring config: %s', self.cfg['id'], exc)

        self.hub.static[self.cfg['id']] = {
            'sys_descr': sys_descr.prettyPrint()
            if hasattr(sys_descr, 'prettyPrint') else str(sys_descr),
            'controller_max_phases': controller_max,
            'controller_phase_groups': controller_groups,
            'polled_groups': self.groups,
            'polled_phases': self.max_phases,
            'rings': rings,
            'barriers': barriers,
        }
        self._static_loaded = True
        log.info('[%s] static loaded: %s phases, rings=%s barriers=%s',
                 self.cfg['id'], self.max_phases,
                 [r['phases'] for r in rings], barriers)

    async def _poll_once(self):
        t0 = time.monotonic()
        oids = ([ntcip.SYS_UPTIME] + ntcip.status_oids(self.groups)
                + ntcip.COORD_OIDS)
        values = await self.client.get(oids)
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        uptime = int(values.get(ntcip.SYS_UPTIME, 0))
        if self.last_uptime is not None and uptime < self.last_uptime:
            self._event('controller-reboot',
                        f'uptime went from {self.last_uptime} to {uptime}')
            self._static_loaded = False
        self.last_uptime = uptime
        self.last_latency_ms = latency_ms

        masks = ntcip.decode_groups(values, self.groups)

        def coord_int(oid):
            raw = values.get(oid)
            try:
                return int(raw)
            except (TypeError, ValueError):
                return None

        phases = ntcip.phase_list(masks, self.max_phases)

        # Measure the cycle by timing the signals themselves rather than
        # trusting a coordination counter. Every phase goes green once per
        # cycle, so the interval between consecutive rising edges of the same
        # phase's green IS the cycle length. This works on any controller and
        # in free mode, and it is verifiable against a stopwatch.
        greens = {p['phase'] for p in phases if p['signal'] == 'green'}
        rising = greens - self.last_greens
        self.last_greens = greens
        if self.reference_phase is None and rising:
            self.reference_phase = min(rising)
        if self.reference_phase in rising:
            now = time.monotonic()
            if self.last_cycle_start is not None:
                measured = now - self.last_cycle_start
                # Ignore absurd values from a stalled or restarted controller.
                if 20 <= measured <= 600:
                    self.cycle_length = round(measured, 1)
                    self.recent_cycles.append(self.cycle_length)
            self.last_cycle_start = now

        cycle_elapsed = (round(time.monotonic() - self.last_cycle_start, 1)
                         if self.last_cycle_start is not None else None)

        self.seq += 1
        return {
            'schema': 'atms.snapshot.v1',
            'intersection_id': self.cfg['id'],
            'seq': self.seq,
            'ts': _now(),
            'connection': CONNECTED,
            'uptime_ticks': uptime,
            'poll_latency_ms': latency_ms,
            'phases': phases,
            'masks': masks,
            'coord': {
                # Raw NTCIP coordination objects, reported as the controller
                # states them.
                'pattern': coord_int(ntcip.COORD_PATTERN),
                'cycle_status': coord_int(ntcip.COORD_CYCLE),
                'sync_timer': coord_int(ntcip.COORD_SYNC),
                'local_free': coord_int(ntcip.COORD_LOCAL_FREE),
                # Measured by this poller from the observed signal sequence,
                # not read from the controller. This intersection runs
                # actuated, so cycle length varies with demand: report the last
                # one and a rolling average rather than pretending it is fixed.
                'last_cycle': self.cycle_length,
                'avg_cycle': (round(sum(self.recent_cycles)
                                    / len(self.recent_cycles), 1)
                              if self.recent_cycles else None),
                'cycles_seen': len(self.recent_cycles),
                'cycle_elapsed': cycle_elapsed,
                'reference_phase': self.reference_phase,
            },
        }

    def _on_success(self):
        if self.state != CONNECTED:
            self._event('connected' if self.state == STARTING else 'reconnected',
                        f'{self.failures} failed polls' if self.failures else '')
        self.state = CONNECTED
        self.failures = 0

    def _on_failure(self, exc):
        self.failures += 1
        if self.failures >= DISCONNECTED_AFTER:
            if self.state != DISCONNECTED:
                self.state = DISCONNECTED
                self._event('disconnected', str(exc))
                # Safety: a link we cannot see is a link we must not hold calls
                # on. Drop arm and desired state on disconnect.
                if self.controller is not None:
                    asyncio.create_task(self.controller.on_disconnect())
        elif self.state in (CONNECTED, STARTING):
            self.state = DEGRADED
            self._event('degraded', str(exc))

    async def run(self):
        log.info('[%s] poller starting for %s:%s',
                 self.cfg['id'], self.cfg['host'], self.cfg['port'])
        while True:
            try:
                if not self._static_loaded:
                    await self._load_static()
                snapshot = await self._poll_once()
                self._on_success()
                self.hub.publish_snapshot(snapshot)
            except SnmpError as exc:
                self._on_failure(exc)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception('[%s] unexpected poller error', self.cfg['id'])
                self._on_failure(SnmpError('internal error'))
            await asyncio.sleep(
                RECONNECT_INTERVAL if self.state == DISCONNECTED else self.interval)
