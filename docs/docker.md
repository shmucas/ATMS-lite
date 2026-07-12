# Running the containerized stack

The `docker-compose.yml` at the repo root brings up a multi-intersection ATMS:
four virtual controllers, the gateway backend that polls them, and the
dashboard.

```
docker compose up --build
```

Then open http://localhost:8080.

`tools/start_docker.sh` wraps this: it checks Docker is running, brings the
stack up in the background, waits for the backend to respond, then opens the
dashboard. Pass `--build` to force a rebuild first, or `--no-open` to skip
opening the browser.

## Services

| Service | Image | Role |
|---|---|---|
| emulator-1..4 | `./emulator` | one virtual NTCIP controller each, SNMP on udp/161 inside the network |
| backend | `./backend` | polls all four over the Docker network, serves REST + WebSocket |
| frontend | `./frontend` | nginx serving the React build, proxies /api and /ws to the backend |

Each emulator is a separate container, so the intersections are genuinely
isolated: killing one (`docker compose kill emulator-3`) degrades only its tile
on the dashboard, exactly as a real controller going offline would.

## The physical 2070

The bench MaxTime 2070 lives on the laptop's Ethernet segment (10.42.0.2), not
the Docker network. To include it, run the backend on the host instead of in a
container (it reaches both the bench segment and the emulator ports):

```
docker compose up emulator-1 emulator-2 emulator-3 emulator-4
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
npm run dev --prefix frontend
```

with the host `backend/intersections.json` listing the real controller plus the
emulator ports. This is exactly the setup used to verify M8: one real
controller plus four virtual, all on one dashboard.

## Prerequisite

Docker Desktop on the dev Mac was at 23.0.1 (early 2023) and must be updated
before `docker compose up` will run. The compose and Dockerfiles are complete;
the multi-intersection behavior was verified by running the emulators as local
processes in the meantime.
