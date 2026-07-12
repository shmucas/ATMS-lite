"""Start/stop a single intersection's poller at runtime.

Startup uses this for every configured intersection; the create/edit/delete
API endpoints use it to bring a poller up or down without restarting the
process.
"""

import asyncio
import logging

from .config import SUPPORTED_DEVICE_TYPES
from .control import Controller
from .poller import Poller

log = logging.getLogger('atms.registry')


def start_intersection(app, cfg):
    """Register cfg and, if its device_type is pollable, start the poller
    task. Unsupported device types are stored so they render on the map but
    stay in a permanent 'unsupported' state."""
    if cfg['device_type'] not in SUPPORTED_DEVICE_TYPES:
        app.state.unsupported[cfg['id']] = cfg
        return None
    poller = Poller(cfg, app.state.hub, app.state.poll_hz)
    controller = Controller(cfg, poller.client, app.state.hub, app.state.audit)
    poller.controller = controller
    app.state.pollers[cfg['id']] = poller
    app.state.controllers[cfg['id']] = controller
    task = asyncio.create_task(poller.run(), name=f"poller-{cfg['id']}")
    app.state.tasks[cfg['id']] = task
    return poller


async def stop_intersection(app, iid):
    app.state.unsupported.pop(iid, None)
    task = app.state.tasks.pop(iid, None)
    controller = app.state.controllers.pop(iid, None)
    app.state.pollers.pop(iid, None)
    if controller is not None:
        await controller.shutdown()
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception('[%s] poller task raised during stop', iid)
    # Drop every trace from the hub, or deleted intersections keep riding
    # the hello payload to every new WebSocket client.
    hub = app.state.hub
    hub.latest.pop(iid, None)
    hub.static.pop(iid, None)
    hub.control.pop(iid, None)
    hub.events.pop(iid, None)
