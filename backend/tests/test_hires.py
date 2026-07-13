"""Hi-res event derivation: pure snapshot-diff logic, no database."""

from app import hires


def phase(num, signal='red', ped='dont_walk', veh_call=False, ped_call=False):
    return {'phase': num, 'signal': signal, 'ped': ped,
            'veh_call': veh_call, 'ped_call': ped_call,
            'on': False, 'next': False}


def test_first_poll_emits_nothing():
    assert hires.derive_events(None, [phase(1, 'green')]) == []


def test_signal_transitions():
    prev = [phase(1, 'red'), phase(2, 'green'), phase(3, 'yellow')]
    cur = [phase(1, 'green'), phase(2, 'yellow'), phase(3, 'red')]
    events = hires.derive_events(prev, cur)
    assert (hires.PHASE_BEGIN_GREEN, 1) in events
    assert (hires.PHASE_BEGIN_YELLOW, 2) in events
    assert (hires.PHASE_BEGIN_RED, 3) in events
    assert len(events) == 3


def test_no_change_no_events():
    snap = [phase(1, 'green', 'walk'), phase(2)]
    assert hires.derive_events(snap, snap) == []


def test_ped_transitions():
    prev = [phase(2, 'green', 'walk')]
    cur = [phase(2, 'green', 'ped_clear')]
    assert hires.derive_events(prev, cur) == [(hires.PED_BEGIN_CLEARANCE, 2)]
    cur2 = [phase(2, 'green', 'dont_walk')]
    assert hires.derive_events(cur, cur2) == [(hires.PED_BEGIN_DONT_WALK, 2)]


def test_call_edges():
    prev = [phase(4, veh_call=False, ped_call=False)]
    cur = [phase(4, veh_call=True, ped_call=True)]
    events = hires.derive_events(prev, cur)
    assert (hires.PHASE_CALL_REGISTERED, 4) in events
    assert (hires.PED_CALL_REGISTERED, 4) in events
    # Dropping the veh call emits 44; ped has no drop code in the subset.
    events = hires.derive_events(cur, prev)
    assert events == [(hires.PHASE_CALL_DROPPED, 4)]


def test_dark_signal_emits_nothing():
    prev = [phase(1, 'green')]
    cur = [phase(1, 'dark')]
    assert hires.derive_events(prev, cur) == []


def test_pattern_change():
    snap = [phase(1)]
    assert hires.derive_events(snap, snap, 5, 5) == []
    assert hires.derive_events(snap, snap, 5, 12) == [
        (hires.COORD_PATTERN_CHANGE, 12)]
    # Unknown previous pattern (first poll after reconnect) stays silent.
    assert hires.derive_events(snap, snap, None, 12) == []


def test_new_phase_in_current_snapshot_is_ignored():
    prev = [phase(1)]
    cur = [phase(1), phase(2, 'green')]
    assert hires.derive_events(prev, cur) == []


def test_store_buffer_sheds_oldest():
    store = hires.HiresStore('postgresql://unused')
    store.add('x', 0, [(1, 1)] * hires.MAX_BUFFER)
    assert len(store._buffer) == hires.MAX_BUFFER
    store.add('x', 0, [(8, 2)])
    assert len(store._buffer) == hires.MAX_BUFFER
    assert store._buffer[-1][2:] == (8, 2)
