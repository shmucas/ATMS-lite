# ATMS-lite

A locally hosted Advanced Traffic Management System that talks NTCIP 1202 over
SNMP to a physical Q-Free MaxTime 2070 traffic controller, scales to many
intersections through lightweight virtual controllers, and drives a live React
dashboard.

Built and verified end to end against real hardware.

## What it does

- **Live signal monitoring.** Polls phase status (red/yellow/green), ped
  states, and vehicle/ped calls at ~5 Hz over SNMP v1, streamed to the browser
  over WebSocket.
- **Interactive ring-and-barrier diagram.** Built from the controller's own
  ring and concurrency configuration, not a template. Click a phase to place a
  call.
- **Control path with safety interlocks.** Vehicle and ped calls are written to
  the controller only when an intersection is explicitly armed. Calls auto-clear
  on disarm, disconnect, and shutdown. Every write is audited. Control endpoints
  can require a token.
- **Coordination monitor.** Pattern and a cycle length measured from the signal
  stream itself (the controller runs actuated, so the cycle varies).
- **Detector and MOE stats.** Detector volume/occupancy plus per-phase green
  utilization computed from the signal stream.
- **Map and weather.** OpenStreetMap via Leaflet, pins colored by connection
  state, live weather from Open-Meteo (no API key).
- **Multi-intersection.** A gateway backend polls many controllers at once; each
  virtual intersection runs in its own container. One going offline degrades
  only its own tile.
- **Graceful hardware handling.** Connection state machine (connected → degraded
  → disconnected) with non-blocking background reconnect. Health is judged by
  SNMP responses, since the controller drops ICMP.

## Stack

- Backend: FastAPI, asyncio SNMP v1 poller (pysnmp), WebSocket stream
- Frontend: React 19 + Vite + Tailwind v4, Leaflet
- Emulator: hand-rolled SNMP v1 agent + dual-ring actuated signal engine, no
  third-party deps
- Deploy: Docker Compose (backend + frontend + N emulator containers)

## Run it

Point `backend/intersections.json` at your controller, then:

```
python -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000

npm install --prefix frontend
npm run dev --prefix frontend      # http://localhost:5173
```

A virtual controller for testing without hardware:

```
EMU_SNMP_PORT=1161 .venv/bin/python emulator/main.py
```

The full containerized multi-intersection stack is in
[docs/docker.md](docs/docker.md).

## Layout

```
backend/    FastAPI poller, control path, REST + WebSocket
frontend/   React dashboard
emulator/   virtual NTCIP controller (SNMP agent + signal engine)
tools/      SNMP discovery CLI and bench utilities
docs/       network runbook, OID reference, milestone log, docker guide
```

## Docs

- [docs/network-setup.md](docs/network-setup.md) - bench bring-up and the
  hard-won gotchas
- [docs/ntcip-oids.md](docs/ntcip-oids.md) - the OIDs read and written, decoded
  against the real unit
- [docs/milestones.md](docs/milestones.md) - the gated build log, M0-M9
- [docs/docker.md](docs/docker.md) - the containerized stack

## Safety

Developed against a standalone bench controller. Control writes sit behind a
server-side arm/disarm interlock, auto-clear on any loss of visibility, and are
audited. Do not point the control path at field equipment.
