# NTCIP OIDs in use

The OIDs this project actually reads and writes, confirmed against the bench
MaxTime 2070. The full machine-readable walk is regenerable:

```
.venv/bin/python tools/discover.py --base 1.3.6.1.4.1.1206.4
```

`asc` below is `1.3.6.1.4.1.1206.4.2.1` (NTCIP 1202 actuated signal controller).

## Device identity

| OID | Name | Observed on the bench unit |
|---|---|---|
| `1.3.6.1.2.1.1.1.0` | sysDescr | `Q-Free MaxTime 2.12.0-57-g3e627e0a1 Linux` |
| `1.3.6.1.2.1.1.3.0` | sysUpTime | TimeTicks, hundredths of a second |
| `1.3.6.1.2.1.1.5.0` | sysName | `MaxTime` |

sysUpTime doubles as our reboot detector: if it goes backwards between polls,
the controller restarted and the poller reloads its static configuration.

## Phase configuration

| OID | Name | Bench value |
|---|---|---|
| `asc.1.1.0` | maxPhases | 40 |
| `asc.1.3.0` | maxPhaseGroups | 5 |

Groups are blocks of 8 phases. The controller advertises 40 phases, but a real
intersection uses 8, so the poller reads 2 groups (16 phases) by default. That
is `poll_groups` in `backend/intersections.json`.

## Phase status (the poll loop) - phaseStatusGroupTable, `asc.1.4.1.C.G`

Column `C`, group row `G`. Each value is an 8-bit mask where bit 0 is the lowest
phase in the group: for group 1, bit 0 is phase 1; for group 2, bit 0 is phase 9.

| Column | Name | Meaning |
|---|---|---|
| 2 | phaseStatusGroupReds | phase showing red |
| 3 | phaseStatusGroupYellows | phase showing yellow |
| 4 | phaseStatusGroupGreens | phase showing green |
| 5 | phaseStatusGroupDontWalks | ped DONT WALK |
| 6 | phaseStatusGroupPedClears | ped clearance (flashing DONT WALK) |
| 7 | phaseStatusGroupWalks | ped WALK |
| 8 | phaseStatusGroupVehCalls | vehicle call registered |
| 9 | phaseStatusGroupPedCalls | ped call registered |
| 10 | phaseStatusGroupPhaseOns | phase is on (serving) |
| 11 | phaseStatusGroupPhaseNexts | phase is next |

Example: `asc.1.4.1.4.1 = 34` decodes to binary `00100010`, bits 1 and 5, so
phases **2 and 6 are green** - the coordinated mainline pair.

One GET PDU carries sysUpTime plus all 10 columns for both groups (21 varbinds)
and returns in 15-45 ms on the bench link.

## Phase control (writes, M5) - phaseControlGroupTable, `asc.1.5.1.C.G`

Same bitmask layout. These are SET targets and require the write community.

| Column | Name |
|---|---|
| 2 | phaseControlGroupPhaseOmit |
| 3 | phaseControlGroupPedOmit |
| 4 | phaseControlGroupHold |
| 5 | phaseControlGroupForceOff |
| 6 | phaseControlGroupVehCall |
| 7 | phaseControlGroupPedCall |

## Other subtrees seen on the walk

| Prefix | Notes |
|---|---|
| `asc.2` | vehicleDetectorTable - detector volume and occupancy, for M6 |
| `asc.4` | coord - pattern, cycle, offset, splits, for the M4 coordination monitor |
| `asc.7` | ring - ring and concurrency configuration, drives the M4 ring diagram |
| `1.3.6.1.4.1.1206.3.36` | Q-Free vendor tree, tens of thousands of objects, unnamed by the standard MIBs. Worth mining for richer event and detector data. |

## Protocol notes

- The agent is **SNMP v1 only**. It silently ignores v2c requests, which looks
  exactly like a dead network. Use `-v1` on the CLI and `mpModel=0` in pysnmp.
- Read community: `public`. The write community lives in the local `.env`.
- The controller does not answer ICMP reliably, so connection health is judged
  by SNMP responses, never by ping.
