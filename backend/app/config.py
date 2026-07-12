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

# Token guarding the control (write) endpoints. When unset, control is open,
# which is fine for a bench on an isolated segment; set it before any
# deployment that is reachable by others. Reads and the stream stay open.
CONTROL_TOKEN = ENV.get('ATMS_CONTROL_TOKEN', '').strip()


INTERSECTIONS_PATH = pathlib.Path(ENV.get('ATMS_INTERSECTIONS',
                                          ROOT / 'backend' / 'intersections.json'))

# Device APIs the backend actually knows how to poll/control. Any other value
# can be stored (so the UI can save the intersection) but no poller starts.
SUPPORTED_DEVICE_TYPES = {'maxtime'}


def normalize_intersection(item):
    return {
        'id': item['id'],
        'name': item.get('name', item['id']),
        'host': item['host'],
        'port': int(item.get('port', 161)),
        'device_type': item.get('device_type', 'maxtime'),
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
    }


def load_intersections():
    items = json.loads(INTERSECTIONS_PATH.read_text())
    return [normalize_intersection(item) for item in items]


def read_raw_intersections():
    if not INTERSECTIONS_PATH.exists():
        return []
    return json.loads(INTERSECTIONS_PATH.read_text())


def write_raw_intersections(items):
    INTERSECTIONS_PATH.write_text(json.dumps(items, indent=2) + '\n')
