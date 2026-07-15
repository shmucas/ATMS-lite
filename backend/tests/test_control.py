"""Controller interlock, bitmask, and arm-expiry behavior against a fake
SNMP client. No network involved."""

import asyncio

import pytest

from app import control as control_mod
from app.control import AuditLog, Controller, ControlError, control_oid


class FakeClient:
    def __init__(self):
        self.sets = []  # (oid, value)

    async def set_int(self, oid, value):
        self.sets.append((oid, value))
        return value


class FakeHub:
    def __init__(self, polled_phases=8):
        self.static = {'x': {
            'polled_phases': polled_phases,
            'rings': [{'ring': 1, 'phases': [1, 2, 3, 4]},
                      {'ring': 2, 'phases': [5, 6, 7, 8]}],
            'concurrency': {
                1: [5, 6], 2: [5, 6], 5: [1, 2], 6: [1, 2],
                3: [7, 8], 4: [7, 8], 7: [3, 4], 8: [3, 4],
            },
        }}
        self.control = {}
        self.published = []

    def publish_control(self, iid, status):
        self.published.append((iid, status))


def make_controller(tmp_path):
    client = FakeClient()
    hub = FakeHub()
    audit = AuditLog(tmp_path / 'audit.jsonl')
    return Controller({'id': 'x'}, client, hub, audit), client, hub


def test_call_refused_unless_armed(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        with pytest.raises(ControlError):
            await controller.place_call('veh', 3)
        assert client.sets == []
        await controller.arm()
        await controller.place_call('veh', 3)
        assert client.sets == [(control_oid(control_mod.VEH_CALL_COL, 1), 4)]
        await controller.disarm()

    asyncio.run(scenario())


def test_call_bitmask_accumulates_and_clears(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.place_call('veh', 1)
        await controller.place_call('veh', 3)
        assert client.sets[-1] == (control_oid(control_mod.VEH_CALL_COL, 1), 0b101)
        await controller.place_call('veh', 1, on=False)
        assert client.sets[-1] == (control_oid(control_mod.VEH_CALL_COL, 1), 0b100)
        await controller.disarm()
        # Disarm zeroes the remaining mask on the controller.
        assert (control_oid(control_mod.VEH_CALL_COL, 1), 0) in client.sets
        assert controller.status()['veh_calls'] == {}

    asyncio.run(scenario())


def test_phase_out_of_range(tmp_path):
    controller, _, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        with pytest.raises(ControlError):
            await controller.place_call('veh', 9)
        with pytest.raises(ControlError):
            await controller.place_call('veh', 0)
        await controller.disarm()

    asyncio.run(scenario())


def test_force_omits_ring_companions_and_release_restores(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.force_phase(3, on=True)
        status = controller.status()
        assert status['forced_phase'] == 3
        # Ring 1 companions 1, 2, 4 omitted: bits 0, 1, 3.
        assert status['omits'] == {1: 0b1011}
        assert status['veh_calls'] == {1: 0b100}
        with pytest.raises(ControlError):
            await controller.force_phase(5, on=True)
        await controller.force_phase(3, on=False)
        assert controller.status()['omits'] == {1: 0}
        assert (control_oid(control_mod.OMIT_COL, 1), 0) in client.sets
        await controller.disarm()

    asyncio.run(scenario())


def test_hold_group_single_phase(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.hold_group([3])
        assert controller.status()['holds'] == {1: 0b100}
        await controller.hold_group([3], on=False)
        assert controller.status()['holds'] == {1: 0}
        await controller.disarm()

    asyncio.run(scenario())


def test_hold_group_concurrent_pair_writes_once_per_group(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.hold_group([2, 6])
        assert controller.status()['holds'] == {1: (1 << 1) | (1 << 5)}
        writes = [s for s in client.sets if s[0] == control_oid(control_mod.HOLD_COL, 1)]
        # Phase 2 -> group 1 bit 1, phase 6 -> group 1 bit 5: one write, combined mask.
        assert writes[-1] == (control_oid(control_mod.HOLD_COL, 1), (1 << 1) | (1 << 5))
        await controller.disarm()

    asyncio.run(scenario())


def test_hold_group_rejects_non_concurrent_phases(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        with pytest.raises(ControlError):
            await controller.hold_group([1, 3])  # same ring, never concurrent
        assert client.sets == []
        await controller.disarm()

    asyncio.run(scenario())


def test_force_off_group_writes_force_off_column(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.force_off_group([2, 6])
        assert controller.status()['force_offs'] == {1: (1 << 1) | (1 << 5)}
        assert (control_oid(control_mod.FORCE_OFF_COL, 1), (1 << 1) | (1 << 5)) in client.sets
        await controller.force_off_group([2, 6], on=False)
        assert controller.status()['force_offs'] == {1: 0}
        await controller.disarm()

    asyncio.run(scenario())


def test_disarm_clears_force_off(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.force_off_group([3])
        await controller.disarm()
        assert (control_oid(control_mod.FORCE_OFF_COL, 1), 0) in client.sets
        assert controller.status()['force_offs'] == {}

    asyncio.run(scenario())


def test_arm_expiry_auto_disarms_and_clears(tmp_path, monkeypatch):
    monkeypatch.setattr(control_mod, 'ARM_TIMEOUT_S', 0.05)
    controller, client, hub = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.place_call('veh', 3)
        assert controller.armed is True
        await asyncio.sleep(0.4)
        assert controller.armed is False
        assert controller.status()['veh_calls'] == {}
        # The clearing write reached the controller.
        assert client.sets[-1] == (control_oid(control_mod.VEH_CALL_COL, 1), 0)
        # And the UI was told.
        assert hub.published[-1][1]['armed'] is False

    asyncio.run(scenario())


def test_rearm_extends_the_window(tmp_path, monkeypatch):
    monkeypatch.setattr(control_mod, 'ARM_TIMEOUT_S', 0.2)
    controller, _, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await asyncio.sleep(0.12)
        await controller.arm()  # re-arm resets the clock
        await asyncio.sleep(0.12)
        assert controller.armed is True  # old timer must not have fired
        await asyncio.sleep(0.2)
        assert controller.armed is False
        await controller.disarm()

    asyncio.run(scenario())


def test_disconnect_drops_state_without_writes(tmp_path):
    controller, client, _ = make_controller(tmp_path)

    async def scenario():
        await controller.arm()
        await controller.place_call('veh', 2)
        writes_before = len(client.sets)
        await controller.on_disconnect()
        # A dead link cannot be written; desired state just goes to zero.
        assert len(client.sets) == writes_before
        assert controller.armed is False
        assert controller.status()['veh_calls'] == {}

    asyncio.run(scenario())
