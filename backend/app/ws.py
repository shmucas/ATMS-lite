"""WebSocket stream: one socket multiplexes every intersection.

Protocol (JSON, schema-versioned like the REST payloads):
  server -> client on connect:  {"type": "hello", "intersections": [...],
                                 "snapshots": {id: snapshot}}
  server -> client streaming:   {"type": "snapshot", "data": {...}}
                                {"type": "event", "data": {...}}
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger('atms.ws')

router = APIRouter()


@router.websocket('/ws')
async def stream(ws: WebSocket):
    await ws.accept()
    hub = ws.app.state.hub
    pollers = ws.app.state.pollers
    queue = hub.subscribe()
    try:
        # Replay the event buffer: a client connecting mid-session must still
        # see the history (disconnects, reboots), not just what happens next.
        history = []
        for buffer in hub.events.values():
            history.extend(buffer)
        history.sort(key=lambda e: e['ts'])

        await ws.send_json({
            'type': 'hello',
            'intersections': [
                {'id': p.cfg['id'], 'name': p.cfg['name'],
                 'lat': p.cfg['lat'], 'lon': p.cfg['lon'],
                 'connection': p.state,
                 'static': hub.static.get(p.cfg['id'])}
                for p in pollers.values()
            ],
            'snapshots': hub.latest,
            'events': history,
        })
        while True:
            message = await queue.get()
            await ws.send_json(message)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:
        log.exception('websocket closed with error')
    finally:
        hub.unsubscribe(queue)
