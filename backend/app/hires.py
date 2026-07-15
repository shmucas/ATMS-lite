"""High-resolution controller events derived from the poll stream (M10).

The poller sees full phase state at ~5 Hz. Every transition between two
consecutive snapshots becomes an event in the Indiana Traffic Signal
Hi-Resolution Data Logger enumeration, the vocabulary ATSPM consumes:

  1   phase begin green            (param = phase)
  8   phase begin yellow clearance (param = phase)
  10  phase begin red clearance    (param = phase; red onset - polling
                                    cannot split red clearance from red)
  21  ped begin walk               (param = phase)
  22  ped begin clearance (FDW)    (param = phase)
  23  ped begin solid dont walk    (param = phase)
  43  phase call registered        (param = phase)
  44  phase call dropped           (param = phase)
  45  ped call registered          (param = phase)
  81  detector on (occupied)       (param = detector channel)
  82  detector off (unoccupied)    (param = detector channel)
  131 coord pattern change         (param = new pattern)

True hi-res loggers timestamp at 10 Hz inside the controller; events here
carry the poll timestamp, so resolution equals the poll interval. That is
the accepted trade-off of deriving from polling instead of reading a log
object this controller does not expose (decided at M10 kickoff).
"""

import asyncio
import datetime
import logging

log = logging.getLogger('atms.hires')

PHASE_BEGIN_GREEN = 1
PHASE_BEGIN_YELLOW = 8
PHASE_BEGIN_RED = 10
PED_BEGIN_WALK = 21
PED_BEGIN_CLEARANCE = 22
PED_BEGIN_DONT_WALK = 23
PHASE_CALL_REGISTERED = 43
PHASE_CALL_DROPPED = 44
PED_CALL_REGISTERED = 45
DETECTOR_ON = 81
DETECTOR_OFF = 82
COORD_PATTERN_CHANGE = 131

_SIGNAL_ONSET = {
    'green': PHASE_BEGIN_GREEN,
    'yellow': PHASE_BEGIN_YELLOW,
    'red': PHASE_BEGIN_RED,
}

_PED_ONSET = {
    'walk': PED_BEGIN_WALK,
    'ped_clear': PED_BEGIN_CLEARANCE,
    'dont_walk': PED_BEGIN_DONT_WALK,
}


def derive_events(prev_phases, cur_phases, prev_pattern=None, cur_pattern=None):
    """Diff two snapshots' phase lists into (event_code, event_param) pairs.

    prev_phases may be None (first poll): no events, since onsets cannot be
    distinguished from pre-existing state.
    """
    events = []
    if prev_phases is None:
        return events
    prev_by_phase = {p['phase']: p for p in prev_phases}
    for cur in cur_phases:
        prev = prev_by_phase.get(cur['phase'])
        if prev is None:
            continue
        num = cur['phase']
        if cur['signal'] != prev['signal'] and cur['signal'] in _SIGNAL_ONSET:
            events.append((_SIGNAL_ONSET[cur['signal']], num))
        if cur['ped'] != prev['ped'] and cur['ped'] in _PED_ONSET:
            events.append((_PED_ONSET[cur['ped']], num))
        if cur['veh_call'] and not prev['veh_call']:
            events.append((PHASE_CALL_REGISTERED, num))
        if not cur['veh_call'] and prev['veh_call']:
            events.append((PHASE_CALL_DROPPED, num))
        if cur['ped_call'] and not prev['ped_call']:
            events.append((PED_CALL_REGISTERED, num))
    if (cur_pattern is not None and prev_pattern is not None
            and cur_pattern != prev_pattern):
        events.append((COORD_PATTERN_CHANGE, cur_pattern))
    return events


def derive_detector_events(prev_detectors, cur_detectors):
    """Diff two snapshots' detector lists into (event_code, event_param) pairs.

    prev_detectors may be None (first poll): no events, since onsets cannot be
    distinguished from pre-existing state. A detector with occupancy None
    (not reporting) is treated the same as occupancy 0 (clear).
    """
    events = []
    if prev_detectors is None:
        return events
    prev_by_det = {d['detector']: d for d in prev_detectors}
    for cur in cur_detectors:
        prev = prev_by_det.get(cur['detector'])
        if prev is None:
            continue
        num = cur['detector']
        prev_on = bool(prev['occupancy'])
        cur_on = bool(cur['occupancy'])
        if cur_on and not prev_on:
            events.append((DETECTOR_ON, num))
        elif prev_on and not cur_on:
            events.append((DETECTOR_OFF, num))
    return events


_SCHEMA = """
CREATE TABLE IF NOT EXISTS hires_events (
    location_id text        NOT NULL,
    ts          timestamptz NOT NULL,
    event_code  smallint    NOT NULL,
    event_param smallint    NOT NULL
);
CREATE INDEX IF NOT EXISTS hires_events_location_ts
    ON hires_events (location_id, ts DESC);
"""

FLUSH_INTERVAL_S = 2.0
MAX_BUFFER = 5000  # hard cap while the database is unreachable


class HiresStore:
    """Buffered writer: pollers append synchronously, a background task
    batches rows into Postgres. Database trouble degrades to dropped
    events and a logged warning; it never stalls polling."""

    def __init__(self, dsn):
        self.dsn = dsn
        self._buffer = []
        self._task = None
        self._conn = None
        self._connected = False
        # One connection shared by the flush task and query requests;
        # psycopg async connections are not safe for concurrent tasks.
        self._db_lock = asyncio.Lock()

    def add(self, location_id, ts, events):
        if not events:
            return
        if len(self._buffer) >= MAX_BUFFER:
            # Shed oldest first so a recovered database gets recent signal
            # state rather than a stale backlog.
            del self._buffer[:len(events)]
        self._buffer.extend(
            (location_id, ts, code, param) for code, param in events)

    async def start(self):
        self._task = asyncio.create_task(self._run(), name='hires-writer')

    async def stop(self):
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._conn is not None:
            try:
                await self._flush()
                await self._conn.close()
            except Exception:
                pass

    async def _connect(self):
        import psycopg
        self._conn = await psycopg.AsyncConnection.connect(
            self.dsn, autocommit=True)
        async with self._conn.cursor() as cur:
            await cur.execute(_SCHEMA)
        if not self._connected:
            self._connected = True
            log.info('hi-res event store connected')

    async def _flush(self):
        if not self._buffer or self._conn is None:
            return
        rows, self._buffer = self._buffer, []
        async with self._db_lock:
            async with self._conn.cursor() as cur:
                async with cur.copy(
                        'COPY hires_events (location_id, ts, event_code, '
                        'event_param) FROM STDIN') as copy:
                    for row in rows:
                        await copy.write_row(row)

    async def _run(self):
        while True:
            try:
                if self._conn is None or self._conn.closed:
                    await self._connect()
                await self._flush()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._connected:
                    self._connected = False
                    log.warning('hi-res store lost database: %s', exc)
                self._conn = None
            await asyncio.sleep(FLUSH_INTERVAL_S)

    async def query(self, location_id, minutes=15, limit=1000, start=None, end=None):
        """Events for one intersection, newest first.

        Either an explicit [start, end] range or a trailing `minutes` window
        (the default) selects the events.
        """
        if self._conn is None or self._conn.closed:
            raise RuntimeError('hi-res store is not connected to the database')
        until = end or datetime.datetime.now(datetime.timezone.utc)
        since = start or (until - datetime.timedelta(minutes=minutes))
        async with self._db_lock:
            async with self._conn.cursor() as cur:
                await cur.execute(
                    'SELECT ts, event_code, event_param FROM hires_events '
                    'WHERE location_id = %s AND ts >= %s AND ts <= %s '
                    'ORDER BY ts DESC LIMIT %s',
                    (location_id, since, until, limit))
                rows = await cur.fetchall()
        return [{'ts': ts.isoformat(timespec='milliseconds'),
                 'event_code': code, 'event_param': param}
                for ts, code, param in rows]
