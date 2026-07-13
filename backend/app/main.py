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
from .config import (AUDIT_LOG_PATH, CORS_ORIGINS, DB_DSN, POLL_HZ,
                     load_intersections)
from .control import AuditLog
from .hires import HiresStore
from .registry import start_intersection
from .state import Hub
from .ws import router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s %(message)s')


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.hub = Hub()
    app.state.pollers = {}
    app.state.controllers = {}
    app.state.unsupported = {}
    app.state.tasks = {}
    app.state.audit = AuditLog(AUDIT_LOG_PATH)
    app.state.poll_hz = POLL_HZ
    app.state.hires = None
    if DB_DSN:
        app.state.hires = HiresStore(DB_DSN)
        await app.state.hires.start()
    for cfg in load_intersections():
        start_intersection(app, cfg)
    yield
    # Safety: clear every call we placed before the process exits.
    await asyncio.gather(*(c.shutdown() for c in app.state.controllers.values()),
                         return_exceptions=True)
    for task in app.state.tasks.values():
        task.cancel()
    await asyncio.gather(*app.state.tasks.values(), return_exceptions=True)
    if app.state.hires is not None:
        await app.state.hires.stop()


app = FastAPI(title='ATMS-lite', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.include_router(router)
app.include_router(ws_router)
