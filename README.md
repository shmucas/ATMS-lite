# ATMS-lite

A locally hosted Advanced Traffic Management System (ATMS) that talks NTCIP 1202 over SNMP to a physical Q-Free MaxTime 2070 traffic controller. FastAPI backend, React dashboard, Docker-based multi-intersection scaling.

## Architecture

- Backend: FastAPI (Python) with an asynchronous SNMP poller
- Frontend: React + Vite + Tailwind CSS + shadcn/ui, live updates over WebSocket
- Protocol: NTCIP 1202 objects over SNMP v1 on UDP port 161. The MaxTime agent silently ignores v2c, so everything speaks v1.
- Physical layer: direct Ethernet from the laptop to the 2070
- Scale-out: one lightweight virtual controller container per simulated intersection. The physical 2070 is intersection #1.

## Repo layout

```
backend/    FastAPI service                 (code starts at M2)
frontend/   React app                       (code starts at M3)
emulator/   virtual NTCIP controller        (code starts at M7)
tools/      bench utilities and discovery   (starts at M1)
docs/       runbooks, milestone plan, OID inventory
```

## Bench quick check

Network bring-up and its gotchas live in [docs/network-setup.md](docs/network-setup.md). Once cabled:

```
./tools/check_link.sh
```

## Milestones

Development is gated: no code for milestone N until milestone N-1 is tested and functional. The full ladder with exit tests is in [docs/milestones.md](docs/milestones.md). Status: M0 complete, M1 (OID discovery) is next.

## Safety

Development happens against a standalone bench controller. All SNMP writes will sit behind an arm/disarm interlock, auto-clear on disconnect, and an audit log. Control features must never be pointed at field equipment.
