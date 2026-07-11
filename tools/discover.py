#!/usr/bin/env python3
"""M1 OID discovery tool.

Walks the controller's SNMP tree with v1 GETNEXTs, annotates every OID
against the NTCIP name map, and writes docs/oid-inventory.json plus a human
summary in docs/oid-inventory.md.

Usage:
    .venv/bin/python tools/discover.py                 # full walk from 1.3.6.1
    .venv/bin/python tools/discover.py --base 1.3.6.1.4.1.1206
    .venv/bin/python tools/discover.py --max-oids 50 --base 1.3.6.1.2.1.1
"""

import argparse
import asyncio
import datetime
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ntcip_names import lookup  # noqa: E402

from pysnmp.hlapi.v3arch.asyncio import (  # noqa: E402
    CommunityData,
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    get_cmd,
    next_cmd,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_env(path=ROOT / '.env'):
    env = {}
    try:
        text = pathlib.Path(path).read_text()
    except OSError:
        return env
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        env[key.strip()] = value.strip()
    return env


def oid_tuple(o):
    getter = getattr(o, 'get_oid', None) or getattr(o, 'getOid', None)
    if getter is not None:
        try:
            oid = getter()
            return tuple(oid.asTuple()) if hasattr(oid, 'asTuple') else tuple(oid)
        except Exception:
            pass
    if hasattr(o, 'asTuple'):
        return tuple(o.asTuple())
    return tuple(int(x) for x in str(o).split('.'))


def first_varbind(var_binds):
    vb = var_binds[0]
    if isinstance(vb, (list, tuple)) and len(vb) and not hasattr(vb, 'prettyPrint'):
        vb = vb[0]
    return vb


def render_value(value, secrets, limit=300):
    kind = value.__class__.__name__
    try:
        pretty = value.prettyPrint()
    except Exception:
        pretty = repr(value)
    for secret in secrets:
        if secret and secret in pretty:
            pretty = '<redacted>'
    if len(pretty) > limit:
        pretty = pretty[:limit] + f'... <truncated, {len(pretty)} chars>'
    return kind, pretty


async def make_target(host, port, timeout, retries):
    if hasattr(UdpTransportTarget, 'create'):
        return await UdpTransportTarget.create((host, port), timeout=timeout, retries=retries)
    return UdpTransportTarget((host, port), timeout=timeout, retries=retries)


async def hello(engine, auth, target, secrets):
    oids = ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.2.0',
            '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.5.0']
    var_binds = [ObjectType(ObjectIdentity(o)) for o in oids]
    err_ind, err_status, _, result = await get_cmd(
        engine, auth, target, ContextData(), *var_binds)
    if err_ind:
        raise RuntimeError(f'hello GET failed: {err_ind}')
    if err_status:
        raise RuntimeError(f'hello GET error-status: {err_status.prettyPrint()}')
    out = {}
    for vb in result:
        oid = '.'.join(map(str, oid_tuple(vb[0])))
        label, _ = lookup(oid)
        _, pretty = render_value(vb[1], secrets)
        out[label] = pretty
    return out


async def walk(engine, auth, target, base, max_oids, secrets, sleep_ms=0):
    base_t = tuple(int(x) for x in base.split('.'))
    cur = base
    prev_t = None
    rows = []
    reason = 'unknown'
    started = time.monotonic()
    while True:
        if len(rows) >= max_oids:
            reason = f'stopped at --max-oids cap ({max_oids})'
            break
        err_ind, err_status, _, var_binds = await next_cmd(
            engine, auth, target, ContextData(),
            ObjectType(ObjectIdentity(cur)))
        if err_ind:
            reason = f'transport error: {err_ind}'
            break
        if err_status:
            status = err_status.prettyPrint()
            reason = ('end of MIB (noSuchName)' if int(err_status) == 2
                      else f'agent error-status: {status}')
            break
        vb = first_varbind(var_binds)
        oid_t = oid_tuple(vb[0])
        if oid_t[:len(base_t)] != base_t:
            reason = 'left the base subtree'
            break
        if prev_t is not None and oid_t <= prev_t:
            reason = f'non-increasing OID from agent at {".".join(map(str, oid_t))}'
            break
        oid = '.'.join(map(str, oid_t))
        label, section = lookup(oid)
        kind, pretty = render_value(vb[1], secrets)
        rows.append({'oid': oid, 'name': label, 'section': section,
                     'type': kind, 'value': pretty})
        prev_t = oid_t
        cur = oid
        if len(rows) % 500 == 0:
            rate = len(rows) / max(time.monotonic() - started, 0.001)
            print(f'  ... {len(rows)} OIDs ({rate:.0f}/s), at {label}',
                  file=sys.stderr, flush=True)
        if sleep_ms:
            await asyncio.sleep(sleep_ms / 1000)
    return rows, reason


def decode_mask(rows, oid, width=8):
    for row in rows:
        if row['oid'] == oid:
            try:
                mask = int(row['value'])
            except ValueError:
                return None
            return [i + 1 for i in range(width) if mask >> i & 1]
    return None


def write_outputs(prefix, meta, system, rows):
    json_path = pathlib.Path(f'{prefix}.json')
    md_path = pathlib.Path(f'{prefix}.md')
    json_path.parent.mkdir(parents=True, exist_ok=True)

    json_path.write_text(json.dumps(
        {'meta': meta, 'system': system, 'oids': rows}, indent=1) + '\n')

    sections = {}
    for row in rows:
        sections[row['section']] = sections.get(row['section'], 0) + 1

    unknown = {}
    for row in rows:
        if row['name'] == row['oid'] and row['oid'].startswith('1.3.6.1.4.1'):
            prefix8 = '.'.join(row['oid'].split('.')[:8])
            unknown[prefix8] = unknown.get(prefix8, 0) + 1

    asc = '1.3.6.1.4.1.1206.4.2.1'
    live = {
        'reds': decode_mask(rows, f'{asc}.1.4.1.2.1'),
        'yellows': decode_mask(rows, f'{asc}.1.4.1.3.1'),
        'greens': decode_mask(rows, f'{asc}.1.4.1.4.1'),
        'vehicle calls': decode_mask(rows, f'{asc}.1.4.1.8.1'),
        'phase nexts': decode_mask(rows, f'{asc}.1.4.1.11.1'),
    }
    max_phases = next((r['value'] for r in rows if r['oid'] == f'{asc}.1.1.0'), None)

    lines = ['# OID inventory', '',
             f'Generated by tools/discover.py on {meta["finished"]}.', '',
             '## Device', '']
    for key, value in system.items():
        lines.append(f'- {key}: `{value}`')
    lines += ['', '## Walk', '',
              f'- base: `{meta["base"]}`',
              f'- OIDs found: **{meta["count"]}**',
              f'- duration: {meta["duration_s"]}s',
              f'- ended because: {meta["end_reason"]}', '']
    if max_phases is not None:
        lines.append(f'- maxPhases reported by controller: **{max_phases}**')
        lines.append('')
    lines += ['## Live snapshot at walk time (phases 1-8, group 1)', '']
    for key, phases in live.items():
        if phases is None:
            lines.append(f'- {key}: not captured')
        else:
            lines.append(f'- {key}: {phases if phases else "none"}')
    lines += ['', '## OIDs per section', '', '| section | count |', '|---|---|']
    for name in sorted(sections, key=sections.get, reverse=True):
        lines.append(f'| {name} | {sections[name]} |')
    if unknown:
        lines += ['', '## Unnamed enterprise subtrees (candidates for vendor objects)',
                  '', '| prefix | count |', '|---|---|']
        for name in sorted(unknown, key=unknown.get, reverse=True)[:15]:
            lines.append(f'| {name} | {unknown[name]} |')
    lines += ['', '## Rerun', '',
              '```', '.venv/bin/python tools/discover.py', '```', '']
    md_path.write_text('\n'.join(lines))
    return json_path, md_path


async def run(args, secrets):
    engine = SnmpEngine()
    auth = CommunityData(args.community, mpModel=0)  # SNMP v1 only agent
    target = await make_target(args.host, args.port, args.timeout, args.retries)

    print(f'hello: GET system group from {args.host} ...', file=sys.stderr)
    system = await hello(engine, auth, target, secrets)
    for key, value in system.items():
        print(f'  {key} = {value}', file=sys.stderr)

    print(f'walking {args.base} (cap {args.max_oids}) ...', file=sys.stderr)
    started = datetime.datetime.now().isoformat(timespec='seconds')
    t0 = time.monotonic()
    rows, reason = await walk(engine, auth, target, args.base,
                              args.max_oids, secrets, args.sleep_ms)
    duration = round(time.monotonic() - t0, 1)

    meta = {'host': args.host, 'port': args.port, 'snmp_version': '1',
            'base': args.base, 'count': len(rows), 'duration_s': duration,
            'started': started,
            'finished': datetime.datetime.now().isoformat(timespec='seconds'),
            'end_reason': reason}
    json_path, md_path = write_outputs(args.out_prefix, meta, system, rows)
    print(f'done: {len(rows)} OIDs in {duration}s ({reason})', file=sys.stderr)
    print(f'wrote {json_path} and {md_path}', file=sys.stderr)


def main():
    env = load_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default=env.get('ATMS_CONTROLLER_HOST', '10.42.0.2'))
    parser.add_argument('--port', type=int,
                        default=int(env.get('ATMS_CONTROLLER_SNMP_PORT', '161')))
    parser.add_argument('--community',
                        default=env.get('ATMS_SNMP_READ_COMMUNITY', 'public'))
    parser.add_argument('--base', default='1.3.6.1')
    parser.add_argument('--max-oids', type=int, default=40000)
    parser.add_argument('--timeout', type=float, default=1.0)
    parser.add_argument('--retries', type=int, default=1)
    parser.add_argument('--sleep-ms', type=int, default=0,
                        help='pause between GETNEXTs, to go easy on the CPU')
    parser.add_argument('--out-prefix', default=str(ROOT / 'docs' / 'oid-inventory'))
    args = parser.parse_args()

    secrets = [value for key, value in env.items()
               if 'COMMUNITY' in key and value and value != 'public']
    asyncio.run(run(args, secrets))


if __name__ == '__main__':
    main()
