"""Configuration: .env plus intersections.json.

Secrets (community strings) come from .env or process env, never from
intersections.json, which is committed to a public repo.
"""

import json
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent


def _load_env_file(path):
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


ENV = {**_load_env_file(ROOT / '.env'), **os.environ}

POLL_HZ = float(ENV.get('ATMS_POLL_HZ', '5'))
CORS_ORIGINS = ENV.get('ATMS_CORS_ORIGINS', 'http://localhost:5173').split(',')


def load_intersections():
    path = pathlib.Path(ENV.get('ATMS_INTERSECTIONS',
                                ROOT / 'backend' / 'intersections.json'))
    items = json.loads(path.read_text())
    out = []
    for item in items:
        out.append({
            'id': item['id'],
            'name': item.get('name', item['id']),
            'host': item['host'],
            'port': int(item.get('port', 161)),
            'read_community': item.get(
                'read_community', ENV.get('ATMS_SNMP_READ_COMMUNITY', 'public')),
            'write_community': item.get(
                'write_community',
                ENV.get('ATMS_SNMP_WRITE_COMMUNITY', 'public')),
            'lat': item.get('lat'),
            'lon': item.get('lon'),
            # How many 8-phase status groups to poll each cycle. MaxTime
            # reports 5 groups (40 phases) but a typical intersection uses
            # phases 1-8, so 2 groups is plenty and keeps the PDU small.
            'poll_groups': int(item.get('poll_groups', 2)),
        })
    return out
