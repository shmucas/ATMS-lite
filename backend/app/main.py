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
from .config import CORS_ORIGINS, POLL_HZ, load_intersections
from .poller import Poller
from .state import Hub
from .ws import router as ws_router

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s %(message)s')


@asynccontextmanager
async def lifespan(app: FastAPI):
    hub = Hub()
    pollers = {}
    tasks = []
    for cfg in load_intersections():
        poller = Poller(cfg, hub, POLL_HZ)
        pollers[cfg['id']] = poller
        tasks.append(asyncio.create_task(
            poller.run(), name=f"poller-{cfg['id']}"))
    app.state.hub = hub
    app.state.pollers = pollers
    yield
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
