"""REST endpoints. The WebSocket stream lands in M3."""

import re
import secrets

from fastapi import APIRouter, Body, Header, HTTPException, Request

from .config import (CONTROL_TOKEN, SUPPORTED_DEVICE_TYPES,
                     normalize_intersection, normalize_movements,
                     read_raw_intersections, write_raw_intersections)
from .control import ControlError
from .registry import start_intersection, stop_intersection

router = APIRouter()

_SLUG_RE = re.compile(r'[^a-z0-9]+')


def _slugify(name):
    slug = _SLUG_RE.sub('-', name.strip().lower()).strip('-')
    return slug or 'intersection'


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
async def place_call(iid: str, request: Request, body: dict = Body(...),
                     x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    kind = body.get('kind', 'veh')
    phase = body.get('phase')
    on = bool(body.get('on', True))
    if not isinstance(phase, int):
        raise HTTPException(422, 'phase must be an integer')
    try:
        return await controller.place_call(kind, phase, on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.post('/api/intersections/{iid}/hold')
async def hold_phase(iid: str, request: Request, body: dict = Body(...),
                     x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    phase = body.get('phase')
    on = bool(body.get('on', True))
    if not isinstance(phase, int):
        raise HTTPException(422, 'phase must be an integer')
    try:
        return await controller.hold_phase(phase, on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.post('/api/intersections/{iid}/force')
async def force_phase(iid: str, request: Request, body: dict = Body(...),
                      x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    controller = _controller(request, iid)
    phase = body.get('phase')
    on = bool(body.get('on', True))
    if not isinstance(phase, int):
        raise HTTPException(422, 'phase must be an integer')
    try:
        return await controller.force_phase(phase, on)
    except ControlError as exc:
        raise HTTPException(409, str(exc))


@router.get('/api/audit')
def audit(request: Request, limit: int = 100):
    return request.app.state.audit.tail(limit)


@router.post('/api/intersections')
async def create_intersection(request: Request, body: dict = Body(...),
                              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    name = (body.get('name') or '').strip()
    host = (body.get('host') or '').strip()
    if not name:
        raise HTTPException(422, 'name is required')
    if not host:
        raise HTTPException(422, 'host is required')
    device_type = body.get('device_type', 'maxtime')

    raw = read_raw_intersections()
    existing_ids = {item['id'] for item in raw}
    iid = (body.get('id') or '').strip() or _slugify(name)
    if iid in existing_ids:
        iid = _unique_id(iid, existing_ids)

    item = {
        'id': iid,
        'name': name,
        'host': host,
        'port': int(body.get('port') or 161),
        'device_type': device_type,
        'lat': body.get('lat'),
        'lon': body.get('lon'),
    }
    if body.get('poll_groups'):
        item['poll_groups'] = int(body['poll_groups'])
    if 'movements' in body:
        item['movements'] = normalize_movements(body['movements'])
    cfg = normalize_intersection(item)

    raw.append(item)
    write_raw_intersections(raw)
    start_intersection(request.app, cfg)

    summary = _intersection_summary(request.app, cfg)
    request.app.state.hub.publish_intersection_added(summary)
    return summary


@router.put('/api/intersections/{iid}')
async def update_intersection(iid: str, request: Request, body: dict = Body(...),
                              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    raw = read_raw_intersections()
    item = next((i for i in raw if i['id'] == iid), None)
    if item is None:
        raise HTTPException(404, f'unknown intersection {iid}')

    for key in ('name', 'host', 'device_type'):
        if body.get(key):
            item[key] = body[key]
    for key in ('lat', 'lon'):
        if key in body:
            item[key] = body[key]
    if body.get('port'):
        item['port'] = int(body['port'])
    if body.get('poll_groups'):
        item['poll_groups'] = int(body['poll_groups'])
    if 'movements' in body:
        item['movements'] = normalize_movements(body['movements'])

    cfg = normalize_intersection(item)
    write_raw_intersections(raw)

    await stop_intersection(request.app, iid)
    start_intersection(request.app, cfg)

    summary = _intersection_summary(request.app, cfg)
    request.app.state.hub.publish_intersection_updated(summary)
    return summary


@router.delete('/api/intersections/{iid}')
async def delete_intersection(iid: str, request: Request,
                              x_control_token: str = Header(default='')):
    _require_control_token(x_control_token)
    raw = read_raw_intersections()
    if not any(i['id'] == iid for i in raw):
        raise HTTPException(404, f'unknown intersection {iid}')
    raw = [i for i in raw if i['id'] != iid]
    write_raw_intersections(raw)

    await stop_intersection(request.app, iid)
    request.app.state.hub.publish_intersection_removed(iid)
    return {'id': iid, 'deleted': True}
