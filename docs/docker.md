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
| emulator-1..4 | `./emulator` | started by default, one virtual NTCIP controller each, SNMP on udp/161 inside the network |
| emulator-5..10 | `./emulator` | same image, but behind the `extra` Compose profile so a plain `docker compose up` doesn't start them |
| backend | `./backend` | polls the registered intersections over the Docker network, serves REST + WebSocket |
| frontend | `./frontend` | nginx serving the React build, proxies /api and /ws to the backend |

Each emulator is a separate container, so the intersections are genuinely
isolated: killing one (`docker compose kill emulator-3`) degrades only its tile
on the dashboard, exactly as a real controller going offline would.

## Up to 10 virtual intersections

Only `emulator-1..4` start by default, matching `backend/intersections.docker.json`
(`virtual-1..4`). To use more of the 10 available slots:

```
docker compose --profile extra up -d emulator-5
```

or `tools/start_docker.sh --extra` to bring up all 10 at once. Starting the
container is not enough on its own though - it's just a new SNMP target on the
Docker network. Register it as an intersection from the dashboard's
"Add intersection" form, with host set to the service name (e.g. `emulator-5`)
and port `161`. This is the same create flow used for any other intersection;
there's no separate provisioning step.

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

Note this is a different config file than the containerized backend uses
(`backend/intersections.docker.json`, baked into the backend image). Running
`tools/start_backend.sh` on its own reads `backend/intersections.json`
directly and has no emulator entries unless you add them there yourself - if
the dashboard shows nothing at all, check which of the two files the running
backend actually loaded.

## Prerequisite

Docker Desktop on the dev Mac was at 23.0.1 (early 2023) and must be updated
before `docker compose up` will run. The compose and Dockerfiles are complete;
the multi-intersection behavior was verified by running the emulators as local
processes in the meantime.
