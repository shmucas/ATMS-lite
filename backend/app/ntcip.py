"""NTCIP 1202 OID constants and decoders used by the poller."""

ASC = '1.3.6.1.4.1.1206.4.2.1'

SYS_DESCR = '1.3.6.1.2.1.1.1.0'
SYS_UPTIME = '1.3.6.1.2.1.1.3.0'
MAX_PHASES = f'{ASC}.1.1.0'
MAX_PHASE_GROUPS = f'{ASC}.1.3.0'

# phaseTable columns, read once at startup to learn the intersection's real
# ring structure instead of assuming the textbook 8-phase layout.
PHASE_RING = f'{ASC}.1.2.1.22'          # .phase -> ring number
PHASE_CONCURRENCY = f'{ASC}.1.2.1.23'   # .phase -> octets, one per concurrent phase

# Coordination status. Verified on the bench unit: 4.12 counts up once per
# second and wraps at the cycle length, so it is the cycle timer.
COORD_PATTERN = f'{ASC}.4.10.0'
COORD_CYCLE = f'{ASC}.4.11.0'
COORD_SYNC = f'{ASC}.4.12.0'
COORD_LOCAL_FREE = f'{ASC}.4.13.0'

COORD_OIDS = [COORD_PATTERN, COORD_CYCLE, COORD_SYNC, COORD_LOCAL_FREE]

# Unit status. Values change with controller mode; we emit an event on change
# rather than assigning meaning to each code we cannot verify without the MIB.
UNIT_CONTROL_STATUS = f'{ASC}.3.5.0'
UNIT_FLASH_STATUS = f'{ASC}.3.6.0'
UNIT_OIDS = [UNIT_CONTROL_STATUS, UNIT_FLASH_STATUS]

# vehicleDetectorVolumeOccupancyTable, asc.2.4.1. col 2 = volume, col 3 =
# occupancy. Occupancy 255 is the NTCIP "no data" sentinel.
DET_VOLUME_COL = 2
DET_OCCUPANCY_COL = 3
DET_NO_DATA = 255


def detector_oids(count):
    oids = []
    for d in range(1, count + 1):
        oids.append(f'{ASC}.2.4.1.{DET_VOLUME_COL}.{d}')
        oids.append(f'{ASC}.2.4.1.{DET_OCCUPANCY_COL}.{d}')
    return oids


def decode_detectors(values, count):
    dets = []
    for d in range(1, count + 1):
        vol = values.get(f'{ASC}.2.4.1.{DET_VOLUME_COL}.{d}')
        occ = values.get(f'{ASC}.2.4.1.{DET_OCCUPANCY_COL}.{d}')
        try:
            vol = int(vol)
        except (TypeError, ValueError):
            vol = None
        try:
            occ = int(occ)
        except (TypeError, ValueError):
            occ = None
        dets.append({
            'detector': d,
            'volume': vol,
            'occupancy': None if occ == DET_NO_DATA else occ,
            'reporting': occ != DET_NO_DATA,
        })
    return dets

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


def parse_concurrency(value):
    """phaseConcurrency is an octet string, one octet per concurrent phase.

    The bench controller renders it as '05 06 ' via net-snmp, meaning phases 5
    and 6 may run alongside this one. pysnmp hands us the raw octets.
    """
    if value is None:
        return []
    try:
        raw = bytes(value)
    except TypeError:
        return []
    return sorted({b for b in raw if b})


def build_rings(ring_by_phase, concurrency_by_phase):
    """Turn the controller's own ring and concurrency config into the ring and
    barrier layout the UI draws.

    A barrier is a set of phases that may run together. Two phases sit in the
    same barrier group when they are concurrent with each other, so we group
    phases by their concurrency set. This reads the truth off the controller
    rather than assuming the textbook 1-8 layout.
    """
    # Ring 0 means the phase is not assigned to a ring: the controller
    # advertises 40 phases but only the configured ones are real. Drop the rest
    # so the diagram shows the actual intersection.
    active = {p for p, r in ring_by_phase.items() if r > 0}

    rings = {}
    for phase, ring in sorted(ring_by_phase.items()):
        if phase in active:
            rings.setdefault(ring, []).append(phase)

    # Group phases into barriers: phases that share a concurrency set belong to
    # the same barrier. Key on the frozenset of (self + concurrent phases).
    groups = {}
    for phase in sorted(concurrency_by_phase):
        if phase not in active:
            continue
        members = frozenset(
            [phase, *(c for c in concurrency_by_phase[phase] if c in active)])
        groups.setdefault(members, set()).add(phase)

    merged = []
    for members in groups:
        placed = False
        for barrier in merged:
            if barrier & members:
                barrier |= members
                placed = True
                break
        if not placed:
            merged.append(set(members))

    barriers = [sorted(b) for b in merged]
    barriers.sort(key=lambda b: b[0] if b else 0)
    return (
        [{'ring': r, 'phases': p} for r, p in sorted(rings.items())],
        barriers,
    )


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
