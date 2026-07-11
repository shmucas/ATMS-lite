"""NTCIP 1202 OID constants and decoders used by the poller."""

ASC = '1.3.6.1.4.1.1206.4.2.1'

SYS_DESCR = '1.3.6.1.2.1.1.1.0'
SYS_UPTIME = '1.3.6.1.2.1.1.3.0'
MAX_PHASES = f'{ASC}.1.1.0'
MAX_PHASE_GROUPS = f'{ASC}.1.3.0'

# phaseStatusGroupTable columns. Each row g covers phases (g-1)*8+1 .. g*8
# as a bitmask, LSB = lowest phase of the group.
STATUS_COLS = {
    'reds': 2,
    'yellows': 3,
    'greens': 4,
    'dont_walks': 5,
    'ped_clears': 6,
    'walks': 7,
    'veh_calls': 8,
    'ped_calls': 9,
    'phase_ons': 10,
    'phase_nexts': 11,
}


def status_oid(column, group):
    return f'{ASC}.1.4.1.{column}.{group}'


def status_oids(groups):
    oids = []
    for group in range(1, groups + 1):
        for column in STATUS_COLS.values():
            oids.append(status_oid(column, group))
    return oids


def decode_groups(values, groups):
    """values: dict oid -> int. Returns dict key -> combined bitmask across
    groups, where bit i (0-based) means phase i+1."""
    masks = {}
    for key, column in STATUS_COLS.items():
        combined = 0
        for group in range(1, groups + 1):
            raw = values.get(status_oid(column, group), 0)
            combined |= (int(raw) & 0xFF) << ((group - 1) * 8)
        masks[key] = combined
    return masks


def phase_list(masks, max_phases):
    phases = []
    for i in range(max_phases):
        bit = 1 << i
        if masks['greens'] & bit:
            signal = 'green'
        elif masks['yellows'] & bit:
            signal = 'yellow'
        elif masks['reds'] & bit:
            signal = 'red'
        else:
            signal = 'dark'
        if masks['walks'] & bit:
            ped = 'walk'
        elif masks['ped_clears'] & bit:
            ped = 'ped_clear'
        elif masks['dont_walks'] & bit:
            ped = 'dont_walk'
        else:
            ped = 'dark'
        phases.append({
            'phase': i + 1,
            'signal': signal,
            'ped': ped,
            'veh_call': bool(masks['veh_calls'] & bit),
            'ped_call': bool(masks['ped_calls'] & bit),
            'on': bool(masks['phase_ons'] & bit),
            'next': bool(masks['phase_nexts'] & bit),
        })
    return phases
