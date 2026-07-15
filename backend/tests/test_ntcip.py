"""Pure-logic tests for the NTCIP decoders and ring/barrier builder."""

from app import ntcip


def test_decode_groups_combines_group_bitmasks():
    values = {
        ntcip.status_oid(ntcip.STATUS_COLS['greens'], 1): 0b0000_0010,   # phase 2
        ntcip.status_oid(ntcip.STATUS_COLS['greens'], 2): 0b0000_0001,   # phase 9
        ntcip.status_oid(ntcip.STATUS_COLS['reds'], 1): 0b1111_1101,
        ntcip.status_oid(ntcip.STATUS_COLS['reds'], 2): 0b1111_1110,
    }
    masks = ntcip.decode_groups(values, groups=2)
    assert masks['greens'] == (1 << 1) | (1 << 8)
    assert masks['reds'] & (1 << 1) == 0
    # Missing columns decode to zero rather than raising.
    assert masks['walks'] == 0


def test_phase_list_signal_and_ped_precedence():
    masks = {key: 0 for key in ntcip.STATUS_COLS}
    masks['greens'] = 0b01
    masks['yellows'] = 0b10
    masks['reds'] = 0b010          # phase 2 both yellow and red: yellow wins
    masks['walks'] = 0b01
    masks['dont_walks'] = 0b11     # phase 1 walk and dont_walk: walk wins
    masks['veh_calls'] = 0b10
    phases = ntcip.phase_list(masks, max_phases=3)
    assert [p['signal'] for p in phases] == ['green', 'yellow', 'dark']
    assert phases[0]['ped'] == 'walk'
    assert phases[1]['ped'] == 'dont_walk'
    assert phases[1]['veh_call'] is True
    assert phases[2]['ped'] == 'dark'


def test_parse_concurrency_octets():
    assert ntcip.parse_concurrency(bytes([5, 6])) == [5, 6]
    assert ntcip.parse_concurrency(bytes([6, 5, 0])) == [5, 6]
    assert ntcip.parse_concurrency(None) == []
    assert ntcip.parse_concurrency(object()) == []


def test_build_rings_standard_dual_ring():
    ring_by_phase = {p: (1 if p <= 4 else 2) for p in range(1, 9)}
    conc = {
        1: [5, 6], 2: [5, 6], 5: [1, 2], 6: [1, 2],
        3: [7, 8], 4: [7, 8], 7: [3, 4], 8: [3, 4],
    }
    rings, barriers, concurrency = ntcip.build_rings(ring_by_phase, conc)
    assert rings == [{'ring': 1, 'phases': [1, 2, 3, 4]},
                     {'ring': 2, 'phases': [5, 6, 7, 8]}]
    assert barriers == [[1, 2, 5, 6], [3, 4, 7, 8]]
    assert concurrency[1] == [5, 6]
    assert concurrency[7] == [3, 4]


def test_build_rings_drops_unassigned_phases():
    ring_by_phase = {1: 1, 2: 1, 3: 0, 4: 0}
    conc = {1: [2], 2: [1], 3: [], 4: []}
    rings, barriers, concurrency = ntcip.build_rings(ring_by_phase, conc)
    assert rings == [{'ring': 1, 'phases': [1, 2]}]
    assert barriers == [[1, 2]]
    assert concurrency == {1: [2], 2: [1]}


def test_build_rings_merges_bridging_groups():
    """Regression: a group seen later can bridge two earlier barriers.
    Phases 1 and 2 look disjoint until phase 3's concurrency links both."""
    ring_by_phase = {1: 1, 2: 1, 3: 2}
    conc = {1: [], 2: [], 3: [1, 2]}
    rings, barriers, concurrency = ntcip.build_rings(ring_by_phase, conc)
    assert barriers == [[1, 2, 3]]
    assert concurrency[3] == [1, 2]
