"""Best-effort NTCIP OID name map for annotating discovery walks.

Section roots (asc.phase, asc.coord, ...) follow the NTCIP 1202 structure and
are reliable. Deep column names inside tables are best-effort from the
standard's layout and get verified against official MIB text as the project
matures. The discovery output records the numeric OID either way, so a wrong
label here can never corrupt data, only mislabel it.
"""

ASC = '1.3.6.1.4.1.1206.4.2.1'

OID_NAMES = {
    # MIB-2
    '1.3.6.1.2.1': 'mib-2',
    '1.3.6.1.2.1.1': 'system',
    '1.3.6.1.2.1.1.1': 'sysDescr',
    '1.3.6.1.2.1.1.2': 'sysObjectID',
    '1.3.6.1.2.1.1.3': 'sysUpTime',
    '1.3.6.1.2.1.1.4': 'sysContact',
    '1.3.6.1.2.1.1.5': 'sysName',
    '1.3.6.1.2.1.1.6': 'sysLocation',
    '1.3.6.1.2.1.1.7': 'sysServices',
    '1.3.6.1.2.1.2': 'interfaces',
    '1.3.6.1.2.1.4': 'ip',
    '1.3.6.1.2.1.5': 'icmp',
    '1.3.6.1.2.1.6': 'tcp',
    '1.3.6.1.2.1.7': 'udp',
    '1.3.6.1.2.1.11': 'snmp',
    '1.3.6.1.6.3': 'snmpModules',

    # NEMA / NTCIP
    '1.3.6.1.4.1': 'enterprises',
    '1.3.6.1.4.1.1206': 'nema',
    '1.3.6.1.4.1.1206.3': 'nema.deviceSpecific',
    '1.3.6.1.4.1.1206.4': 'nema.transportation',
    '1.3.6.1.4.1.1206.4.1': 'transportation.profiles',
    '1.3.6.1.4.1.1206.4.2': 'transportation.devices',
    '1.3.6.1.4.1.1206.4.2.6': 'global (NTCIP 1201)',

    # NTCIP 1202 actuated signal controller
    ASC: 'asc',
    ASC + '.1': 'asc.phase',
    ASC + '.1.1': 'maxPhases',
    ASC + '.1.2': 'phaseTable',
    ASC + '.1.3': 'maxPhaseGroups',
    ASC + '.1.4': 'phaseStatusGroupTable',
    ASC + '.1.5': 'phaseControlGroupTable',
    ASC + '.2': 'asc.vehicleDetector',
    ASC + '.2.1': 'maxVehicleDetectors',
    ASC + '.2.2': 'vehicleDetectorTable',
    ASC + '.3': 'asc.unit',
    ASC + '.4': 'asc.coord',
    ASC + '.5': 'asc.timebaseAsc',
    ASC + '.6': 'asc.preempt',
    ASC + '.7': 'asc.ring',
    ASC + '.8': 'asc.channel',
    ASC + '.9': 'asc.overlap',
    ASC + '.10': 'asc.ts2port1',
}

_PHASE_TABLE_COLS = {
    1: 'phaseNumber', 2: 'phaseWalk', 3: 'phasePedestrianClear',
    4: 'phaseMinimumGreen', 5: 'phasePassage', 6: 'phaseMaximum1',
    7: 'phaseMaximum2', 8: 'phaseYellowChange', 9: 'phaseRedClear',
    10: 'phaseRedRevert', 11: 'phaseAddedInitial', 12: 'phaseMaximumInitial',
    13: 'phaseTimeBeforeReduction', 14: 'phaseCarsBeforeReduction',
    15: 'phaseTimeToReduce', 16: 'phaseReduceBy', 17: 'phaseMinimumGap',
    18: 'phaseDynamicMaxLimit', 19: 'phaseDynamicMaxStep',
    20: 'phaseStartup', 21: 'phaseOptions', 22: 'phaseRing',
    23: 'phaseConcurrency',
}
for col, name in _PHASE_TABLE_COLS.items():
    OID_NAMES[f'{ASC}.1.2.1.{col}'] = name

_PHASE_STATUS_COLS = {
    1: 'phaseStatusGroupNumber', 2: 'phaseStatusGroupReds',
    3: 'phaseStatusGroupYellows', 4: 'phaseStatusGroupGreens',
    5: 'phaseStatusGroupDontWalks', 6: 'phaseStatusGroupPedClears',
    7: 'phaseStatusGroupWalks', 8: 'phaseStatusGroupVehCalls',
    9: 'phaseStatusGroupPedCalls', 10: 'phaseStatusGroupPhaseOns',
    11: 'phaseStatusGroupPhaseNexts',
}
for col, name in _PHASE_STATUS_COLS.items():
    OID_NAMES[f'{ASC}.1.4.1.{col}'] = name

_PHASE_CONTROL_COLS = {
    1: 'phaseControlGroupNumber', 2: 'phaseControlGroupPhaseOmit',
    3: 'phaseControlGroupPedOmit', 4: 'phaseControlGroupHold',
    5: 'phaseControlGroupForceOff', 6: 'phaseControlGroupVehCall',
    7: 'phaseControlGroupPedCall',
}
for col, name in _PHASE_CONTROL_COLS.items():
    OID_NAMES[f'{ASC}.1.5.1.{col}'] = name


def lookup(oid: str):
    """Longest-prefix match. Returns (label, section).

    label: best name plus the remaining instance suffix, or the numeric OID
    when nothing matches. section: the shallowest asc.* or top-level name the
    OID falls under, for grouping.
    """
    parts = oid.split('.')
    label = oid
    section = 'unknown'
    for i in range(len(parts), 0, -1):
        prefix = '.'.join(parts[:i])
        name = OID_NAMES.get(prefix)
        if name:
            rest = '.'.join(parts[i:])
            label = f'{name}.{rest}' if rest else name
            break
    for i in range(min(len(parts), 9), 0, -1):
        prefix = '.'.join(parts[:i])
        name = OID_NAMES.get(prefix)
        if name and (name.startswith('asc') or i <= 7):
            section = name
            break
    return label, section
