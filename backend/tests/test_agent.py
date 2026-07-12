"""SNMP conformance: the hand-rolled emulator agent served over UDP and
queried with the production pysnmp client, plus direct BER edge cases."""

import asyncio

from app import ntcip
from app.control import control_oid
from app.snmp import SnmpClient, SnmpError
from signal_engine import SignalEngine
from snmp_agent import Agent, serve

PORT = 40161


def run_against_agent(coro_factory):
    async def scenario():
        engine = SignalEngine()
        agent = Agent(engine)
        transport = await serve(agent, host='127.0.0.1', port=PORT)
        try:
            client = SnmpClient('127.0.0.1', PORT, 'public',
                                timeout=2.0, retries=1)
            return await coro_factory(engine, agent, client)
        finally:
            transport.close()

    return asyncio.run(scenario())


def test_get_system_and_status_columns():
    async def check(engine, agent, client):
        oids = [ntcip.SYS_DESCR, ntcip.MAX_PHASES,
                ntcip.status_oid(ntcip.STATUS_COLS['reds'], 1)]
        values = await client.get(oids)
        assert 'Virtual' in str(values[ntcip.SYS_DESCR])
        assert int(values[ntcip.MAX_PHASES]) == 8
        assert int(values[ntcip.status_oid(ntcip.STATUS_COLS['reds'], 1)]) \
            == engine.status_masks()['reds'] & 0xFF

    run_against_agent(check)


def test_set_control_columns_reach_the_engine():
    async def check(engine, agent, client):
        for column, attr in ((6, 'veh_call'), (4, 'hold'),
                             (2, 'omit'), (5, 'force_off')):
            echoed = await client.set_int(control_oid(column, 1), 0b100)
            assert echoed == 0b100
            assert getattr(engine.phases[3], attr) is True
            await client.set_int(control_oid(column, 1), 0)
            assert getattr(engine.phases[3], attr) is False

    run_against_agent(check)


def test_set_on_read_only_oid_is_refused():
    async def check(engine, agent, client):
        try:
            await client.set_int(ntcip.MAX_PHASES, 4)
        except SnmpError:
            pass
        else:
            raise AssertionError('SET on a read-only OID must error')
        # And the value is unchanged.
        values = await client.get([ntcip.MAX_PHASES])
        assert int(values[ntcip.MAX_PHASES]) == 8

    run_against_agent(check)


def test_wrong_community_is_dropped():
    """A wrong community must be silently ignored (timeout), like the real
    MaxTime agent, not answered with an error."""
    async def check(engine, agent, client):
        bad = SnmpClient('127.0.0.1', PORT, 'wrong', timeout=0.5, retries=0)
        try:
            await bad.get([ntcip.SYS_DESCR])
        except SnmpError:
            return
        raise AssertionError('wrong community must not be answered')

    run_against_agent(check)


def test_getnext_walk_visits_sorted_oids():
    engine = SignalEngine()
    agent = Agent(engine)
    # Walk via the agent's own table ordering: every OID's successor is the
    # next sorted entry, and the last returns None.
    oids = agent._sorted_oids
    for current, expected in zip(oids, oids[1:]):
        assert agent._next_oid(current) == expected
    assert agent._next_oid(oids[-1]) is None


def test_ber_int_encoding_round_trip():
    from snmp_agent import enc_int, parse_int, parse_tlv
    for value in (0, 1, 127, 128, 255, 256, 65535, 2**31 - 1):
        tag, body, _ = parse_tlv(enc_int(value), 0)
        assert parse_int(body) == value, value
