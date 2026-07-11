# Milestone plan

Rule: no code for milestone N until milestone N-1 is fully tested and functional. Every milestone ends with a visible exit test and a commit to main.

| #  | Scope                                                                 | Exit test                                                                    | Status   |
|----|-----------------------------------------------------------------------|------------------------------------------------------------------------------|----------|
| M0 | Repo scaffold, network runbook, physical link                         | Ping and web UI reachable from the Mac; scaffold pushed                       | Complete (2026-07-10) |
| M1 | SNMP hello + OID discovery CLI                                        | sysDescr returned; annotated walk of the 1.3.6.1.4.1.1206 tree saved to docs/ | Next     |
| M2 | Async poller, connection state machine, REST status API               | Live phase colors via curl; cable pull degrades and recovers cleanly          | Pending  |
| M3 | WebSocket stream + React shell + system health panel + map/weather tab | Phase tiles update live; cable pull flips the banner with no refresh          | Pending  |
| M4 | Ring-and-barrier widget (read-only) + coordination monitor            | Widget matches the controller front panel through full cycles                 | Pending  |
| M5 | Control path: veh/ped calls, click-on-diagram, arm/disarm interlock, audit log | Click a phase in the UI; the call registers on the controller and the phase serves | Pending  |
| M6 | Alarm/event scraping + timeline UI + detector/MOE stats               | A provoked controller event shows in the timeline with a correct timestamp    | Pending  |
| M7 | Virtual controller emulator (Python NTCIP agent), containerized       | Backend polls the emulator with a config change only, zero code changes       | Pending  |
| M8 | Multi-intersection: compose N virtual + 1 real, dashboard grid/map    | All intersections on one dashboard; killing a container degrades only its tile | Pending  |
| M9 | Hardening: auth, persistence, chaos pass, docs                        | Cable pulls, controller reboots, container kills all recover clean            | Pending  |

Notes:

- Dashboard extras agreed at kickoff: coordination monitor, OpenStreetMap overview, detector/MOE stats, system health panel, weather via Open-Meteo (free, no API key).
- M5: the SNMP write community lives in the local .env. The pre-SET database backup was waived by the project owner on 2026-07-10. The community gets verified at M5 with a harmless SET that rewrites a current value onto itself.
- Docker Desktop on the dev Mac is outdated (23.0.1) and must be updated before M7.
- The MaxTime agent is SNMP v1 only. All tooling and backend code must speak v1.
