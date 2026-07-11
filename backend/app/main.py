"""ATMS-lite backend entry point.

Run from the repo root:
    .venv/bin/uvicorn app.main:app --app-dir backend --port 8000
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import CORS_ORIGINS, POLL_HZ, ROOT, load_intersections
from .control import AuditLog, Controller
from .poller import Poller
from .state import Hub
from .ws import router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s %(message)s')


@asynccontextmanager
async def lifespan(app: FastAPI):
    hub = Hub()
    audit = AuditLog(ROOT / 'docs' / 'backups' / 'control-audit.jsonl')
    pollers = {}
    controllers = {}
    tasks = []
    for cfg in load_intersections():
        poller = Poller(cfg, hub, POLL_HZ)
        controller = Controller(cfg, poller.client, hub, audit)
        poller.controller = controller
        pollers[cfg['id']] = poller
        controllers[cfg['id']] = controller
        tasks.append(asyncio.create_task(
            poller.run(), name=f"poller-{cfg['id']}"))
    app.state.hub = hub
    app.state.pollers = pollers
    app.state.controllers = controllers
    app.state.audit = audit
    yield
    # Safety: clear every call we placed before the process exits.
    await asyncio.gather(*(c.shutdown() for c in controllers.values()),
                         return_exceptions=True)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title='ATMS-lite', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.include_router(router)
app.include_router(ws_router)
