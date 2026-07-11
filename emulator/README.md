# Virtual NTCIP controller

A standalone emulator that speaks the same SNMP v1 / NTCIP 1202 dialect as the
bench MaxTime 2070, driven by a real dual-ring, eight-phase actuated signal
engine. The ATMS backend cannot tell it apart from hardware, which is what lets
us scale to many intersections without many controllers.

## What it models

- Ring 1 (phases 1-4) and Ring 2 (phases 5-8) with barriers `{1,2,5,6}` and
  `{3,4,7,8}`, matching the bench unit.
- Per-phase min/max green, actuated extension, yellow change, red clearance,
  and ped walk / clearance timing.
- Coordinated phases 2 and 6 rest in green under no demand.
- Vehicle and ped calls placed over SNMP SET actually change what serves, so
  the ATMS control path can be exercised end to end.

## OIDs served

The subset the backend polls: system group, `maxPhases` / `maxPhaseGroups`,
`phaseRing` / `phaseConcurrency`, the `phaseStatusGroup` bitmask columns, the
`phaseControlGroup` veh/ped call columns (writable), unit status, coordination
objects, and the detector volume/occupancy table.

## Run it

Locally on a high port (161 needs root):

```
EMU_SNMP_PORT=1161 python main.py
snmpget -v1 -c public localhost:1161 1.3.6.1.2.1.1.1.0
```

In Docker:

```
docker build -t atms-emulator .
docker run --rm -p 1161:161/udp atms-emulator
```

Then add it to `backend/intersections.json` as another intersection. No backend
code changes: the emulator is just another SNMP endpoint.

## Config (environment)

| Var | Default | Meaning |
|---|---|---|
| `EMU_SNMP_PORT` | 161 | UDP port to listen on |
| `EMU_SYS_NAME` | VirtualASC | sysName the agent reports |
| `EMU_TICK_HZ` | 10 | signal engine tick rate |
