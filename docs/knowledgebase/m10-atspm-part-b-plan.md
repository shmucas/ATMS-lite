# M10 Part B: wire the real ATSPM v5 app (researched, deferred)

Status: researched and phased 2026-07-13, not started. Deferred in favor of
the corridor time-space diagram work. Preserved here so the research isn't
lost; pick this back up when M10 part B resumes.

## Context

M10 part A (complete, merged 2026-07-13) derives Indiana-enumeration hi-res
events from the poller and lands them in a Postgres `hires_events` table
(`backend/app/hires.py`), served at `GET /api/intersections/{id}/hires`. The
M10 decision (2026-07-12) was to run the real open-source UDOT ATSPM
reporting app against our data rather than reimplementing ATSPM's metrics
(purdue split-fail, arrivals on green, etc.) ourselves - fidelity to
upstream over a lighter homegrown reimplementation.

Part B wires that real app in. Research against
`github.com/OpenSourceTransportation/Atspm` confirms:

- The stack is heavy: `postgres` + `database-installer` (one-shot EF Core
  migrations) + `configapi`/`dataapi`/`reportapi`/`identityapi` + `webui` +
  `nginx` (TLS termination, self-signed dev certs) + `watchdog` +
  `eventlogutility`. Four separate Postgres databases (Config, Aggregation,
  EventLogs, Identity) on one `postgres:16` instance. JWT auth via
  identityapi, admin user seeded by `database-installer`.
- Images (`ghcr.io/opensourcetransportation/atspm/*`, tag `v5.3.0`) are
  amd64-only - will run under Rosetta/QEMU emulation on this M-series Mac.
- Event storage's default/primary path is table `CompressedEvents`:
  composite-keyed rows (`LocationIdentifier, DeviceId, DataType, Start,
  End`) with a `bytea Data` column holding GZip-compressed Newtonsoft JSON
  of a `List<IndianaEvent>` (`{Timestamp, EventCode, EventParam}` triples,
  `$type` discriminator injected by a custom serialization binder). This is
  precisely traceable in source but not yet verified against a real
  emitted sample - Newtonsoft's exact `$type`/array quirks are easy to get
  subtly wrong, and the repo's own `DatabaseInstaller translate` command
  hints the compressed format has changed across versions before.
- A legacy flat table also exists and is live-mapped (`Controller_Event_Log`
  - `locationId, Timestamp, EventCode, EventParam`, trivial plain SQL) but
  is `[Obsolete]`-tagged in their C# source; whether current report-query
  code paths still read from it is unverified.
- ConfigApi exposes real OData REST endpoints for `Location`/`Approach`/
  `Detector` (versioned Location rows, `LocationIdentifier` ties to the
  event-log key). Our `movements` records (`backend/app/config.py`
  `normalize_movements`, approach/lanes/phase/lat/lon/heading) map
  reasonably onto `Approach.ProtectedPhaseNumber`/`PermissivePhaseNumber`/
  `DirectionTypeId`, but there's no existing detector-channel or timezone
  data - likely fine to leave detectors unmapped initially since
  phase-termination metrics key off approach/phase, not detectors.
- No documented HTTP ingestion/webhook extension point exists; the intended
  default path is file-drop polling (FTP/SFTP + a downloader/decoder
  pipeline that is largely stubbed/commented-out in the current `main`
  branch). Direct-to-Postgres writes are the only practical integration
  point, corroborated by their own `DatabaseInstaller` CLI supporting direct
  DB-to-DB commands (`copy-sql`, `transfer-config`, `setup-test` seeding
  from a `devices.json`).

Decisions made (2026-07-13):
- Ingestion strategy: spike and verify empirically before committing to an
  approach - stand up ATSPM, get one real ground-truth `CompressedEvents`
  row and confirm what the flat table actually renders in reports, then
  pick whichever path is real. Do not build the full adapter on an
  unverified assumption.
- Frontend surface: embed the ATSPM webui in an in-app drawer via iframe,
  following the existing `ActivityDrawer` pattern
  (`frontend/src/App.tsx` + `frontend/src/components/TopBar.tsx`
  boolean-toggle-drawer convention) rather than a new-tab link.
- Compose footprint: a separate, opt-in `docker-compose.atspm.yml` (not
  started by the normal `docker compose up`) - keeps the day-to-day bench
  dev loop light given the stack's weight and amd64-emulation overhead.

## B.1 - Stand up the ATSPM stack (infra only, no data)

- New `docker-compose.atspm.yml` at repo root, reproducing ATSPM's own
  compose topology (`postgres`, `database-installer`, `configapi`, `dataapi`,
  `reportapi`, `identityapi`, `webui`, `nginx`, `watchdog`,
  `eventlogutility`) with ATSPM's own images pinned to `v5.3.0`. Runs on its
  own Postgres container (separate from our `postgres` / `atms` hires DB on
  host port 5455) to avoid any collision - pick a distinct host port block,
  e.g. `54xx`.
- `.env.atspm.example` documenting the four `ConnectionStrings__*` DSNs,
  `Jwt__Key`/`Issuer`/`ExpireDays`, and `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
  `SEED_ADMIN` vars for the one-shot `database-installer` admin seed -
  mirroring how `.env.example` documents `ATMS_DB_DSN` etc. at repo root.
- Dev-cert generation documented as a runbook step (their README's OpenSSL
  recipe for `nginx/certs/aspnetapp.{key,crt,pfx}`) - add a short note on
  the one-time browser trust step needed later for the iframe embed (B.5).
- Exit test: `docker compose -f docker-compose.atspm.yml up`, all services
  healthy, `https://localhost:<nginx-port>` reaches ATSPM's login screen,
  seeded admin credentials log in successfully.

## B.2 - Seed one intersection's config via ConfigApi

- Small one-off Python script (e.g. `scripts/atspm_seed_config.py`) that:
  fetches a JWT from identityapi's token endpoint using the seeded admin
  creds, then POSTs a `Location` (from `bench-2070`'s name/lat/lon) and one
  `Approach` per NB/SB/EB/WB direction present in its `movements`, setting
  `ProtectedPhaseNumber`/`PermissivePhaseNumber` from the phase numbers
  already in `normalize_movements()` output. `LocationIdentifier` is set to
  our intersection id string (`bench-2070`) so it lines up with whatever
  `location_id`/`LocationIdentifier` key the event adapter writes in
  B.3/B.4.
- Exit test: the Location and its Approaches are visible in ATSPM webui's
  config admin screens.

## B.3 - Ingestion spike (research task, not a feature)

- With ATSPM up and bench-2070 configured, get one real ground-truth
  sample: either trigger ATSPM's own file-drop path with a hand-crafted log
  (if fast enough to wire) or insert directly and inspect, to capture an
  actual `CompressedEvents.Data` byte value for a known small event list.
  Write a Python GZip+JSON encoder for the same event list and diff against
  it - confirm exact match (`$type` marker placement, field order, GZip
  parameters) or characterize the mismatch precisely.
- In parallel, insert a handful of rows directly into `Controller_Event_Log`
  for bench-2070 and check whether ReportApi/webui renders anything from
  them (a phase-termination / purdue-style chart) - this settles whether
  the `[Obsolete]` flat table is actually a dead end for reporting or a
  valid shortcut.
- Exit test: a short written finding stating which path is viable, with the
  verified format details. This determines B.4's design.

## B.4 - Real event adapter

- New backend module (e.g. `backend/app/atspm_export.py`), structured like
  `HiresStore` (`backend/app/hires.py`): a background task gated by its own
  env var (`ATSPM_DB_DSN`, off by default so it's inert unless the ATSPM
  stack is actually running), reading new `hires_events` rows past a
  high-water mark and writing them into ATSPM's event-log Postgres in
  whichever format B.3 validated.
- High-water mark tracked per `location_id` in a small state table (e.g.
  `atspm_export_state(location_id, last_exported_ts)`) so re-runs don't
  duplicate exports - same idea as `HiresStore`'s buffered-flush design but
  reading instead of writing our own table.
- Exit test: run a real phase cycle on the bench 2070 controller, confirm
  the resulting `hires_events` rows show up as ATSPM report data (a real
  chart reflecting the bench signal, not synthetic data).

## B.5 - Frontend embed

- "ATSPM Reports" toggle button in `frontend/src/components/TopBar.tsx`,
  mirroring the existing `activityOpen` pattern in `frontend/src/App.tsx`
  (state -> prop -> conditionally-rendered absolutely-positioned panel).
- New drawer/panel component containing an `<iframe>` pointed at the ATSPM
  webui URL (configurable via a Vite env var, e.g. `VITE_ATSPM_URL`,
  defaulting to the nginx HTTPS URL from B.1).
- Document the one-time step where the user must visit the ATSPM URL
  directly once to accept the self-signed dev cert - browsers won't
  silently load an iframe to an untrusted-cert origin - as a short runbook
  note, consistent with how the bench network notes in `CLAUDE.md`
  document non-obvious local setup gotchas.
- Exit test: from the running dashboard, click "ATSPM Reports"; after the
  one-time cert-trust step, the iframe loads ATSPM's login screen, admin
  login succeeds, and a report renders showing real bench-2070 data -
  closing the loop end-to-end.

## Verification approach

Each sub-step is bench-tested against the real controller/stack before the
next starts (per the milestone-gated workflow), and gets its own commit.
B.1/B.2 are pure infra/config verified by browser inspection of ATSPM's own
UI; B.3 is a research spike verified by direct SQL/byte comparison; B.4 is
verified by driving a real signal cycle and checking ATSPM's report output;
B.5 is verified by a full click-through in the actual dashboard UI. No
unit/API test suite exists for the ATSPM stack itself (it's vendored), so
verification here is functional/manual rather than automated.
