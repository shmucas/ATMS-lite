# Milestone plan

Rule: no code for milestone N until milestone N-1 is fully tested and functional. Every milestone ends with a visible exit test and a commit to main.

| #  | Scope                                                                 | Exit test                                                                    | Status   |
|----|-----------------------------------------------------------------------|------------------------------------------------------------------------------|----------|
| M0 | Repo scaffold, network runbook, physical link                         | Ping and web UI reachable from the Mac; scaffold pushed                       | Complete (2026-07-10) |
| M1 | SNMP hello + OID discovery CLI                                        | sysDescr returned; annotated walk of the 1.3.6.1.4.1.1206 tree saved to docs/ | Complete |
| M2 | Async poller, connection state machine, REST status API               | Live phase colors via curl; cable pull degrades and recovers cleanly          | Complete |
| M3 | WebSocket stream + React shell + system health panel + map/weather tab | Phase tiles update live; cable pull flips the banner with no refresh          | Complete |
| M4 | Ring-and-barrier widget (read-only) + coordination monitor            | Widget matches the controller front panel through full cycles                 | Complete |
| M5 | Control path: veh/ped calls, click-on-diagram, arm/disarm interlock, audit log | Click a phase in the UI; the call registers on the controller and the phase serves | Complete |
| M6 | Alarm/event scraping + timeline UI + detector/MOE stats               | A provoked controller event shows in the timeline with a correct timestamp    | Complete |
| M7 | Virtual controller emulator (Python NTCIP agent), containerized       | Backend polls the emulator with a config change only, zero code changes       | Complete |
| M8 | Multi-intersection: compose N virtual + 1 real, dashboard grid/map    | All intersections on one dashboard; killing a container degrades only its tile | Complete (compose written; verified with local emulator processes, container run needs Docker update) |
| M9 | Hardening: auth, persistence, chaos pass, docs                        | Cable pulls, controller reboots, container kills all recover clean            | Complete (2026-07-11, see note) |
| M10 | ATSPM reports menu: high-res event capture from existing polling, Postgres store, real UDOT ATSPM reporting app wired in via compose | User opens "ATSPM Reports" menu, pulls real-time and aggregate reports rendered by the actual ATSPM app | In progress (part A complete 2026-07-13; see note) |

Notes:

- Dashboard extras agreed at kickoff: coordination monitor, OpenStreetMap overview, detector/MOE stats, system health panel, weather via Open-Meteo (free, no API key).
- M5: the SNMP write community lives in the local .env. The pre-SET database backup was waived by the project owner on 2026-07-10. The community gets verified at M5 with a harmless SET that rewrites a current value onto itself.
- Docker Desktop on the dev Mac is outdated (23.0.1) and must be updated before M7.
- The MaxTime agent is SNMP v1 only. All tooling and backend code must speak v1.
- M10 (ATSPM reports) decided 2026-07-12: derive high-res events from existing poller data (no separate NTCIP high-res log object assumed available), store in a new Postgres service added to docker-compose, and run the real open-source UDOT ATSPM reporting app against it rather than reimplementing its metrics. Work does not start until M9 is tested and marked Complete.
- M10 part A landed 2026-07-13: the poller derives Indiana-enumeration hi-res events (phase color onsets 1/8/10, ped 21/22/23, phase calls 43/44/45, pattern change 131) from snapshot transitions at poll resolution, batches them into a compose Postgres service (`hires_events` table, host port 5455), and serves them at `GET /api/intersections/{id}/hires`. Verified on the bench 2070: full green/yellow/red progressions with correct yellow (~3s) and walk (~5s) intervals. Capture is off unless ATMS_DB_DSN is set.
- M10 part B (pending): wire the real ATSPM v5 app (repo OpenSourceTransportation/Atspm). Findings from recon: images publish to ghcr.io/opensourcetransportation/atspm/{atspm-webui,-config-api,-data-api,-identity-api,-report-api,-watchdog,-eventlogutil}, latest v5.3.0, linux/amd64 only (emulated on this Mac). Its EventLogContext stores events as compressed per-location/per-day EF Core blobs (`CompressedEventLogs<IndianaEvent>`), so part B needs an ingestion adapter from `hires_events` into that schema (or their legacy flat `ControllerEventLog` table) plus config-database setup (locations/approaches) through its ConfigApi.
- M9 status note (2026-07-12): control-endpoint token auth, perf verification, and doc refresh landed in `838654a`. Chaos scenarios (cable pull, controller reboot, container kill) were verified in earlier milestones (M2/M3/M8), not re-run against the two commits that landed after `838654a` (intersection registry UI, map-first redesign). Persistence covers intersection config and the control audit log; the in-memory alarm/event timeline (`Hub.events` in `backend/app/state.py`) does not survive a backend restart - accepted as a known gap, not blocking M9 closure.
