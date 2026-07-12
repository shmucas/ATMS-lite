"""Minimal SNMP v1 agent: GET, GETNEXT, SET over UDP.

Serves the NTCIP object subset the ATMS backend polls, backed by a live
SignalEngine. Hand-rolled BER because the whole point is a small, dependency-
light emulator that drops into a container. Only SNMP v1 (version 0) is
implemented, matching the real MaxTime agent.
"""

import asyncio
import time

from signal_engine import SignalEngine

ASC = (1, 3, 6, 1, 4, 1, 1206, 4, 2, 1)

# ---- BER helpers ----

INTEGER = 0x02
OCTET_STRING = 0x04
NULL = 0x05
OID = 0x06
SEQUENCE = 0x30
GET = 0xA0
GETNEXT = 0xA1
RESPONSE = 0xA2
SET = 0xA3

NO_SUCH_NAME = 2


def enc_len(n):
    if n < 0x80:
        return bytes([n])
    out = b''
    while n:
        out = bytes([n & 0xFF]) + out
        n >>= 8
    return bytes([0x80 | len(out)]) + out


def tlv(tag, body):
    return bytes([tag]) + enc_len(len(body)) + body


def enc_int(value):
    if value == 0:
        return tlv(INTEGER, b'\x00')
    v = value
    body = b''
    negative = v < 0
    if negative:
        v = -v - 1
    while v:
        body = bytes([v & 0xFF]) + body
        v >>= 8
    if negative:
        body = bytes([b ^ 0xFF for b in body]) or b'\xff'
        if not (body[0] & 0x80):
            body = b'\xff' + body
    elif body and (body[0] & 0x80):
        body = b'\x00' + body
    return tlv(INTEGER, body or b'\x00')


def enc_timeticks(value):
    return tlv(0x43, enc_int(value)[2:])  # Application 3, same content as int


def enc_oid(parts):
    first = 40 * parts[0] + parts[1]
    body = bytes([first])
    for sub in parts[2:]:
        if sub < 0x80:
            body += bytes([sub])
        else:
            stack = [sub & 0x7F]
            sub >>= 7
            while sub:
                stack.append((sub & 0x7F) | 0x80)
                sub >>= 7
            body += bytes(reversed(stack))
    return tlv(OID, body)


def enc_str(s):
    return tlv(OCTET_STRING, s.encode() if isinstance(s, str) else s)


# ---- BER parsing ----

def parse_tlv(data, i):
    tag = data[i]
    i += 1
    length = data[i]
    i += 1
    if length & 0x80:
        num = length & 0x7F
        length = int.from_bytes(data[i:i + num], 'big')
        i += num
    return tag, data[i:i + length], i + length


def parse_int(body):
    return int.from_bytes(body, 'big', signed=True)


def parse_oid(body):
    first = body[0]
    parts = [first // 40, first % 40]
    val = 0
    for b in body[1:]:
        val = (val << 7) | (b & 0x7F)
        if not (b & 0x80):
            parts.append(val)
            val = 0
    return tuple(parts)


class Agent:
    def __init__(self, engine: SignalEngine, community=b'public',
                 sys_descr='ATMS-lite Virtual Controller 1.0 Linux',
                 sys_name='VirtualASC'):
        self.engine = engine
        self.community = community
        self.sys_descr = sys_descr
        self.sys_name = sys_name
        self.start = time.monotonic()
        self._table = self._build_table()
        self._sorted_oids = sorted(self._table)

    # Status column -> mask key, matching the real controller's layout.
    STATUS_COLS = {
        2: 'reds', 3: 'yellows', 4: 'greens', 5: 'dont_walks',
        6: 'ped_clears', 7: 'walks', 8: 'veh_calls', 9: 'ped_calls',
        10: 'phase_ons', 11: 'phase_nexts',
    }

    def _build_table(self):
        """Map OID tuple -> callable returning an encoded varbind value.
        Dynamic values are callables so each GET reflects current engine state.
        """
        t = {}

        # System group.
        t[(1, 3, 6, 1, 2, 1, 1, 1, 0)] = lambda: enc_str(self.sys_descr)
        t[(1, 3, 6, 1, 2, 1, 1, 3, 0)] = lambda: enc_timeticks(
            int((time.monotonic() - self.start) * 100))
        t[(1, 3, 6, 1, 2, 1, 1, 5, 0)] = lambda: enc_str(self.sys_name)

        # Phase config.
        t[ASC + (1, 1, 0)] = lambda: enc_int(8)      # maxPhases
        t[ASC + (1, 3, 0)] = lambda: enc_int(1)      # maxPhaseGroups
        for p in range(1, 9):
            ring = 1 if p <= 4 else 2
            conc = [5, 6] if p in (1, 2) else [7, 8] if p in (3, 4) \
                else [1, 2] if p in (5, 6) else [3, 4]
            t[ASC + (1, 2, 1, 22, p)] = (lambda r=ring: enc_int(r))
            t[ASC + (1, 2, 1, 23, p)] = (
                lambda c=conc: enc_str(bytes(c)))

        # Phase status group table (group 1).
        for col, key in self.STATUS_COLS.items():
            t[ASC + (1, 4, 1, col, 1)] = (
                lambda k=key: enc_int(self.engine.status_masks()[k] & 0xFF))

        # Phase control group table (group 1) - SET targets, readable too.
        # Columns mirror the real controller: 2 omit, 4 hold, 5 force-off,
        # 6 veh call, 7 ped call.
        self._control = {kind: 0 for kind in self.CONTROL_COLS.values()}
        for col, kind in self.CONTROL_COLS.items():
            t[ASC + (1, 5, 1, col, 1)] = (
                lambda k=kind: enc_int(self._control[k]))

        # Unit status.
        t[ASC + (3, 5, 0)] = lambda: enc_int(6)   # control status (running)
        t[ASC + (3, 6, 0)] = lambda: enc_int(2)   # flash status (not flashing)

        # Coordination.
        t[ASC + (4, 10, 0)] = lambda: enc_int(1)  # pattern
        t[ASC + (4, 11, 0)] = lambda: enc_int(1)
        t[ASC + (4, 12, 0)] = lambda: enc_int(
            int(time.monotonic() - self.start) % 120)
        t[ASC + (4, 13, 0)] = lambda: enc_int(0)

        # Detector volume/occupancy table (8 detectors).
        for d in range(1, 9):
            t[ASC + (2, 4, 1, 2, d)] = lambda: enc_int(0)     # volume
            t[ASC + (2, 4, 1, 3, d)] = lambda: enc_int(255)   # occupancy no-data
        return t

    # phaseControlGroupTable column -> engine mask kind.
    CONTROL_COLS = {2: 'omit', 4: 'hold', 5: 'forceoff', 6: 'veh', 7: 'ped'}

    def _control_set(self, oid, value):
        for col, kind in self.CONTROL_COLS.items():
            if oid == ASC + (1, 5, 1, col, 1):
                self._control[kind] = value & 0xFF
                self.engine.set_group_mask(kind, 1, value & 0xFF)
                return True
        return False

    def _varbind(self, oid, value_bytes):
        return tlv(SEQUENCE, enc_oid(oid) + value_bytes)

    def _lookup(self, oid):
        fn = self._table.get(oid)
        return fn() if fn else None

    def _next_oid(self, oid):
        for candidate in self._sorted_oids:
            if candidate > oid:
                return candidate
        return None

    def handle(self, data):
        try:
            return self._handle(data)
        except Exception:
            return None  # drop malformed packets, like a real agent

    def _handle(self, data):
        _, msg, _ = parse_tlv(data, 0)
        i = 0
        _, ver_b, i = parse_tlv(msg, i)      # version
        version = parse_int(ver_b)
        _, comm, i = parse_tlv(msg, i)       # community
        if version != 0 or comm != self.community:
            return None
        pdu_tag, pdu, _ = parse_tlv(msg, i)

        j = 0
        _, reqid_b, j = parse_tlv(pdu, j)
        _, _err, j = parse_tlv(pdu, j)
        _, _erri, j = parse_tlv(pdu, j)
        _, vblist, j = parse_tlv(pdu, j)

        # Parse the varbind list.
        oids = []
        sets = []
        k = 0
        while k < len(vblist):
            _, vb, k = parse_tlv(vblist, k)
            m = 0
            _, oid_b, m = parse_tlv(vb, m)
            val_tag, val_b, m = parse_tlv(vb, m)
            oid = parse_oid(oid_b)
            oids.append(oid)
            if val_tag == INTEGER:
                sets.append((oid, parse_int(val_b)))
            else:
                sets.append((oid, None))

        err_status = 0
        err_index = 0
        out_vbs = []

        if pdu_tag == SET:
            for idx, (oid, value) in enumerate(sets, 1):
                if value is not None and self._control_set(oid, value):
                    out_vbs.append(self._varbind(oid, enc_int(value)))
                else:
                    err_status, err_index = NO_SUCH_NAME, idx
                    out_vbs = [self._varbind(o, tlv(NULL, b'')) for o in oids]
                    break
        elif pdu_tag == GETNEXT:
            for idx, oid in enumerate(oids, 1):
                nxt = self._next_oid(oid)
                if nxt is None:
                    err_status, err_index = NO_SUCH_NAME, idx
                    out_vbs.append(self._varbind(oid, tlv(NULL, b'')))
                else:
                    out_vbs.append(self._varbind(nxt, self._lookup(nxt)))
        else:  # GET
            for idx, oid in enumerate(oids, 1):
                val = self._lookup(oid)
                if val is None:
                    err_status, err_index = NO_SUCH_NAME, idx
                    out_vbs = [self._varbind(o, tlv(NULL, b'')) for o in oids]
                    break
                out_vbs.append(self._varbind(oid, val))

        resp_pdu = tlv(RESPONSE,
                       tlv(INTEGER, reqid_b)
                       + enc_int(err_status) + enc_int(err_index)
                       + tlv(SEQUENCE, b''.join(out_vbs)))
        return tlv(SEQUENCE,
                   enc_int(0) + enc_str(self.community) + resp_pdu)


class _Protocol(asyncio.DatagramProtocol):
    def __init__(self, agent):
        self.agent = agent

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        reply = self.agent.handle(data)
        if reply is not None:
            self.transport.sendto(reply, addr)


async def serve(agent, host='0.0.0.0', port=161):
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: _Protocol(agent), local_addr=(host, port))
    return transport
