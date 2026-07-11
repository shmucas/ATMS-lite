"""REST endpoints. The WebSocket stream lands in M3."""

import secrets

from fastapi import APIRouter, Body, Header, HTTPException, Request

from .config import CONTROL_TOKEN
from .control import ControlError

router = APIRouter()


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
        'lat': cfg['lat'],
        'lon': cfg['lon'],
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


@router.get('/api/audit')
def audit(request: Request, limit: int = 100):
    return request.app.state.audit.tail(limit)
