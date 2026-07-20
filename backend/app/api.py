"""REST endpoints. The WebSocket stream lands in M3."""

import asyncio
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, StrictInt

from . import ntcip
from .config import (CONTROL_TOKEN, ENV, SUPPORTED_DEVICE_TYPES,
                     normalize_corridor, normalize_intersection,
                     normalize_movements, read_communities,
                     read_raw_intersections, write_communities,
                     write_raw_intersections)
from .control import ControlError
from .registry import start_intersection, stop_intersection
from .snmp import SnmpClient, SnmpError

router = APIRouter()


# Request bodies. StrictInt matters on phase: JSON true would otherwise pass
# an isinstance(int) check because bool subclasses int. lat/lon are strict so
# a string can never reach the frontend, where it would crash toFixed().
class PhaseBody(BaseModel):
    phase: StrictInt = Field(ge=1)
    on: bool = True


class CallBody(PhaseBody):
    kind: Literal['veh', 'ped'] = 'veh'


class PhaseGroupBody(BaseModel):
    """One phase, or a concurrent phase pair, held or forced off together."""
    phases: list[StrictInt] = Field(min_length=1, max_length=8)
    on: bool = True


class IntersectionCreate(BaseModel):
    name: str
    host: str
    id: str | None = None
    port: StrictInt | None = Field(default=None, ge=1, le=65535)
    device_type: str = 'maxtime'
    lat: float | None = Field(default=None, strict=True)
    lon: float | None = Field(default=None, strict=True)
    poll_groups: StrictInt | None = Field(default=None, ge=1, le=5)
    movements: list | None = None
    corridor: dict | None = None
    # Stored in the gitignored communities sidecar, never in
    # intersections.json (public repo).
    read_community: str | None = None
    write_community: str | None = None


class IntersectionUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    id: None = None  # ids are permanent; reject attempts to change one
    port: StrictInt | None = Field(default=None, ge=1, le=65535)
    device_type: str | None = None
    lat: float | None = Field(default=None, strict=True)
    lon: float | None = Field(default=None, strict=True)
    poll_groups: StrictInt | None = Field(default=None, ge=1, le=5)
    movements: list | None = None
    corridor: dict | None = None
    read_community: str | None = None
    write_community: str | None = None


class ProbeBody(BaseModel):
    host: str
    port: StrictInt = Field(default=161, ge=1, le=65535)
    read_community: str | None = None

_SLUG_RE = re.compile(r'[^a-z0-9]+')

# Serializes every read-modify-write of intersections.json so concurrent
# create/update/delete requests cannot clobber each other's edits.
_mutations = asyncio.Lock()

# Changing any of these means we are talking to a different device (or
# talking to it differently), so the poller must restart. Anything else
# (name, lat/lon, movements) is cosmetic and updates in place, keeping the
# live poll stream, MOE window, and any armed control session intact.
_CONNECTION_KEYS = ('host', 'port', 'device_type', 'read_community',
                    'write_community', 'poll_groups')


def _slugify(name):
    slug = _SLUG_RE.sub('-', name.strip().lower()).strip('-')
    return slug or 'intersection'


def _store_communities(iid, read_community, write_community):
    """Persist non-empty community overrides to the gitignored sidecar.
    Blank or absent means keep whatever is already configured."""
    updates = {}
    if read_community and read_community.strip():
        updates['read_community'] = read_community.strip()
    if write_community and write_community.strip():
        updates['write_community'] = write_community.strip()
    if not updates:
        return
    overrides = read_communities()
    overrides.setdefault(iid, {}).update(updates)
    write_communities(overrides)


def _drop_communities(iid):
    overrides = read_communities()
    if iid in overrides:
        del overrides[iid]
        write_communities(overrides)


def _unique_id(base, existing_ids):
    if base not in existing_ids:
        return base
    n = 2
    while f'{base}-{n}' in existing_ids:
        n += 1
    return f'{base}-{n}'


def _intersection_summary(app, cfg):
    poller = app.state.pollers.get(cfg['id'])
    return {
        'id': cfg['id'],
        'name': cfg['name'],
        'host': cfg['host'],
        'port': cfg['port'],
        'device_type': cfg.get('device_type', 'maxtime'),
        'lat': cfg['lat'],
        'lon': cfg['lon'],
        'movements': cfg.get('movements', []),
        'corridor': cfg.get('corridor'),
        'connection': poller.state if poller else 'unsupported',
        'static': app.state.hub.static.get(cfg['id']) if poller else None,
    }


def _controller(request, iid):
    controller = request.app.state.controllers.get(iid)
    if controller is None:
        raise HTTPException(404, f'unknown intersection {iid}')
    return controller


def _require_control_token(token):
    """Guard the write endpoints. No-op when no token is configured (open bench
    mode); constant-time compare when one is set."""
    if not CONTROL_TOKEN:
        return
    if not token or not secrets.compare_digest(token, CONTROL_TOKEN):
        raise HTTPException(401, 'invalid or missing control token')


def _summary(poller, hub):
    cfg = poller.cfg
    latest = hub.latest.get(cfg['id'])
    return {
        'id': cfg['id'],
        'name': cfg['name'],
        'host': cfg['host'],
        'device_type': cfg.get('device_type', 'maxtime'),
        'lat': cfg['lat'],
        'lon': cfg['lon'],
        'movements': cfg.get('movements', []),
        'corridor': cfg.get('corridor'),
        'connection': poller.state,
        'poll_latency_ms': poller.last_latency_ms,
        'last_seq': latest['seq'] if latest else None,
        'last_ts': latest['ts'] if latest else None,
        'static': hub.static.get(cfg['id']),
    }


@router.get('/healthz')
def healthz(request: Request):
    return {'status': 'ok',
            'intersections': len(request.app.state.pollers)}


@router.get('/api/device-types')
def device_types():
    return {
        'supported': sorted(SUPPORTED_DEVICE_TYPES),
        'all': ['maxtime', 'econolite', 'siemens'],
    }


@router.get('/api/intersections')
def intersections(request: Request):
    hub = request.app.state.hub
    return [_summary(p, hub) for p in request.app.state.pollers.values()]


@router.post('/api/probe')
async def probe(body: ProbeBody, x_control_token: str = Header(default='')):
    """One-shot reachability check for the add/edit form: a single SNMP v1
    GET with a short timeout, so a typo'd address fails in the form instead
    of as a forever-grey pin."""
    _require_control_token(x_control_token)
    host = body.host.strip()
    if not host:
        raise HTTPException(422, 'host is required')
    community = ((body.read_community or '').strip()
                 or ENV.get('ATMS_SNMP_READ_COMMUNITY', 'public'))
    client = SnmpClient(host, body.port, community, timeout=1.5, retries=0)
    try:
        values = await client.get(
            [ntcip.SYS_DESCR, ntcip.SYS_UPTIME, ntcip.MAX_PHASES])
    except SnmpError as exc:
        return {'ok': False,
                'error': str(exc) or 'no response before timeout'}
    except Exception as exc:
        # pysnmp wraps resolver/socket failures in its own error types; a
        # probe should report them, never 500.
        return {'ok': False, 'error': str(exc)}
    descr = values.get(ntcip.SYS_DESCR, '')
    def as_int(oid):
        try:
            return int(values.get(oid))
        except (TypeError, ValueError):
            return None
    return {
        'ok': True,
        'sys_descr': (descr.prettyPrint()
                      if hasattr(descr, 'prettyPrint') else str(descr)),
        'uptime_ticks': as_int(ntcip.SYS_UPTIME),
        'max_phases': as_int(ntcip.MAX_PHASES),
    }


@router.get('/api/intersections/{iid}/status')
def status(iid: str, request: Request):
    poller = request.app.state.pollers.get(iid)
    if poller is None:
        raise HTTPException(404, f'unknown intersection {iid}')
    hub = request.app.state.hub
    latest = hub.latest.get(iid)
    if latest is None:
        return {'intersection_id': iid, 'connection': poller.state,
                'note': 'no successful poll yet'}
    return {**latest, 'connection': poller.state}


@router.get('/api/intersections/{iid}/events')
def events(iid: str, request: Request):
    poller = request.app.state.pollers.get(iid)
    if poller is None:
        raise HTTPException(404, f'unknown intersection {iid}')
    return list(request.app.state.hub.events.get(iid, []))


HIRES_MAX_RANGE_MINUTES = 60


@router.get('/api/intersections/{iid}/hires')
async def hires_events(iid: str, request: Request,
                       minutes: int = 15, limit: int = 1000,
                       start: str | None = None, end: str | None = None):
    """Hi-res (Indiana enumeration) events derived from polling.

    Either an explicit start/end range (ISO 8601, capped to
    HIRES_MAX_RANGE_MINUTES) or a trailing `minutes` window from now.
    """
    if request.app.state.pollers.get(iid) is None:
        raise HTTPException(404, f'unknown intersection {iid}')
    store = request.app.state.hires
    if store is None:
        raise HTTPException(
            503, 'hi-res capture is not enabled; set ATMS_DB_DSN')

    start_dt = end_dt = None
    if start is not None or end is not None:
        if start is None or end is None:
            raise HTTPException(400, 'start and end must both be set')
        try:
            start_dt = datetime.fromisoformat(start)
            end_dt = datetime.fromisoformat(end)
        except ValueError:
            raise HTTPException(400, 'start and end must be ISO 8601 timestamps')
        # A naive timestamp would be read in the database session's timezone,
        # silently shifting the window; treat it as UTC explicitly instead.
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        if end_dt <= start_dt:
            raise HTTPException(400, 'end must be after start')
        span = end_dt - start_dt
        if span > timedelta(minutes=HIRES_MAX_RANGE_MINUTES):
            raise HTTPException(
                400, f'range cannot exceed {HIRES_MAX_RANGE_MINUTES} minutes')

    try:
        return await store.query(
            iid, minutes=max(1, min(minutes, HIRES_MAX_RANGE_MINUTES)),
            limit=max(1, min(limit, 10000)), start=start_dt, end=end_dt)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))


@router.get('/api/intersections/{iid}/control')
def control_status(iid: str, request: Request):
    return _controller(request, iid).status()


@router.post('/api/intersections/{iid}/arm')
async def arm(iid: str, request: Request,
              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    return await _controller(request, iid).arm()


@router.post('/api/intersections/{iid}/disarm')
async def disarm(iid: str, request: Request,
                 x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    return await _controller(request, iid).disarm()


@router.post('/api/intersections/{iid}/call')
async def place_call(iid: str, request: Request, body: CallBody,
                     x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    try:
        return await controller.place_call(body.kind, body.phase, body.on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.post('/api/intersections/{iid}/hold')
async def hold_phases(iid: str, request: Request, body: PhaseGroupBody,
                      x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    try:
        return await controller.hold_group(body.phases, body.on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.post('/api/intersections/{iid}/force-off')
async def force_off_phases(iid: str, request: Request, body: PhaseGroupBody,
                           x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    try:
        return await controller.force_off_group(body.phases, body.on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.post('/api/intersections/{iid}/force')
async def force_phase(iid: str, request: Request, body: PhaseBody,
                      x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    try:
        return await controller.force_phase(body.phase, body.on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.get('/api/audit')
def audit(request: Request, limit: int = 100):
    return request.app.state.audit.tail(limit)


@router.post('/api/intersections')
async def create_intersection(request: Request, body: IntersectionCreate,
                              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    name = body.name.strip()
    host = body.host.strip()
    if not name:
        raise HTTPException(422, 'name is required')
    if not host:
        raise HTTPException(422, 'host is required')

    async with _mutations:
        raw = read_raw_intersections()
        existing_ids = {item['id'] for item in raw}
        iid = _slugify(body.id or name)
        if iid in existing_ids:
            iid = _unique_id(iid, existing_ids)

        item = {
            'id': iid,
            'name': name,
            'host': host,
            'port': body.port or 161,
            'device_type': body.device_type,
            'lat': body.lat,
            'lon': body.lon,
        }
        if body.poll_groups:
            item['poll_groups'] = body.poll_groups
        if body.movements is not None:
            item['movements'] = normalize_movements(body.movements)
        if body.corridor is not None:
            item['corridor'] = normalize_corridor(body.corridor)
        # Before normalize_intersection, which reads the sidecar back.
        _store_communities(iid, body.read_community, body.write_community)
        cfg = normalize_intersection(item)

        raw.append(item)
        write_raw_intersections(raw)
        start_intersection(request.app, cfg)

    summary = _intersection_summary(request.app, cfg)
    request.app.state.hub.publish_intersection_added(summary)
    return summary


@router.put('/api/intersections/{iid}')
async def update_intersection(iid: str, request: Request,
                              body: IntersectionUpdate,
                              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    # Only fields the client actually sent: lat/lon may be set to null to
    # unpin, so present-but-None and absent must stay distinguishable.
    data = body.model_dump(exclude_unset=True)
    async with _mutations:
        raw = read_raw_intersections()
        item = next((i for i in raw if i['id'] == iid), None)
        if item is None:
            raise HTTPException(404, f'unknown intersection {iid}')
        old_cfg = normalize_intersection(item)

        for key in ('name', 'host', 'device_type'):
            if data.get(key):
                item[key] = data[key]
        for key in ('lat', 'lon'):
            if key in data:
                item[key] = data[key]
        if data.get('port'):
            item['port'] = data['port']
        if data.get('poll_groups'):
            item['poll_groups'] = data['poll_groups']
        if 'movements' in data:
            # normalize_movements(None) is [], so movements: null clears.
            item['movements'] = normalize_movements(data['movements'])
        if 'corridor' in data:
            # normalize_corridor(None) is None, so corridor: null clears.
            item['corridor'] = normalize_corridor(data['corridor'])

        # After old_cfg, before the new normalize: a community change then
        # shows up as a connection-key diff and restarts the poller.
        _store_communities(iid, data.get('read_community'),
                           data.get('write_community'))
        cfg = normalize_intersection(item)
        write_raw_intersections(raw)

        live_cfg = (poller.cfg if (poller := request.app.state.pollers.get(iid))
                    else request.app.state.unsupported.get(iid))
        if live_cfg is None or any(
                cfg[k] != old_cfg[k] for k in _CONNECTION_KEYS):
            await stop_intersection(request.app, iid)
            start_intersection(request.app, cfg)
            live_cfg = cfg
        else:
            # Cosmetic edit: mutate the running poller/controller's shared
            # cfg dict in place so live polling and control state survive.
            for key in ('name', 'lat', 'lon', 'movements', 'corridor'):
                live_cfg[key] = cfg[key]

        summary = _intersection_summary(request.app, live_cfg)
    request.app.state.hub.publish_intersection_updated(summary)
    return summary


@router.delete('/api/intersections/{iid}')
async def delete_intersection(iid: str, request: Request,
                              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    async with _mutations:
        raw = read_raw_intersections()
        if not any(i['id'] == iid for i in raw):
            raise HTTPException(404, f'unknown intersection {iid}')
        raw = [i for i in raw if i['id'] != iid]
        write_raw_intersections(raw)
        _drop_communities(iid)
        await stop_intersection(request.app, iid)
    request.app.state.hub.publish_intersection_removed(iid)
    return {'id': iid, 'deleted': True}
