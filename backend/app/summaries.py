"""Intersection summary payloads shared by the REST API and the WS hello.

One shape for one concept: the REST list, the CRUD responses, and the
WebSocket hello all describe an intersection with the same fields, so
they must build the dict in the same place or they drift apart.
"""


def poller_summary(poller, hub):
    """Summary for a live (polled) intersection."""
    cfg = poller.cfg
    latest = hub.latest.get(cfg['id'])
    return {
        **_base(cfg),
        'connection': poller.state,
        'poll_latency_ms': poller.last_latency_ms,
        'last_seq': latest['seq'] if latest else None,
        'last_ts': latest['ts'] if latest else None,
        'static': hub.static.get(cfg['id']),
    }


def unsupported_summary(cfg):
    """Summary for a stored intersection with no pollable device type."""
    return {
        **_base(cfg),
        'connection': 'unsupported',
        'poll_latency_ms': None,
        'last_seq': None,
        'last_ts': None,
        'static': None,
    }


def intersection_summary(app, cfg):
    """Summary for CRUD responses: picks the live or unsupported shape."""
    poller = app.state.pollers.get(cfg['id'])
    if poller is None:
        return unsupported_summary(cfg)
    return poller_summary(poller, app.state.hub)


def _base(cfg):
    return {
        'id': cfg['id'],
        'name': cfg['name'],
        'host': cfg['host'],
        'port': cfg['port'],
        'device_type': cfg.get('device_type', 'maxtime'),
        'lat': cfg['lat'],
        'lon': cfg['lon'],
        'movements': cfg.get('movements', []),
        'corridor': cfg.get('corridor'),
    }
