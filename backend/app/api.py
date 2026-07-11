"""REST endpoints. The WebSocket stream lands in M3."""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


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
