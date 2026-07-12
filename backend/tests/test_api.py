"""REST API validation and registry lifecycle via TestClient.

Uses device_type 'econolite' (stored but unsupported) so no SNMP poller
ever starts; everything here is process-local.
"""

import pytest
from fastapi.testclient import TestClient

from app import config
from app import main as main_mod


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'INTERSECTIONS_PATH',
                        tmp_path / 'intersections.json')
    monkeypatch.setattr(main_mod, 'AUDIT_LOG_PATH', tmp_path / 'audit.jsonl')
    with TestClient(main_mod.app) as test_client:
        yield test_client


UNSUPPORTED = {'name': 'Main & 3rd', 'host': '10.0.0.9',
               'device_type': 'econolite'}


def test_create_rejects_bad_types(client):
    assert client.post('/api/intersections',
                       json={**UNSUPPORTED, 'lat': 'not-a-number'}
                       ).status_code == 422
    assert client.post('/api/intersections',
                       json={**UNSUPPORTED, 'port': 'abc'}).status_code == 422
    assert client.post('/api/intersections',
                       json={**UNSUPPORTED, 'port': True}).status_code == 422
    assert client.post('/api/intersections',
                       json={'host': '10.0.0.9'}).status_code == 422  # no name
    assert client.post('/api/intersections',
                       json={'name': '  ', 'host': 'h'}).status_code == 422


def test_create_slugifies_client_supplied_id(client):
    res = client.post('/api/intersections',
                      json={**UNSUPPORTED, 'id': 'Weird / ID!'})
    assert res.status_code == 200
    assert res.json()['id'] == 'weird-id'


def test_create_update_delete_lifecycle(client):
    created = client.post('/api/intersections', json=UNSUPPORTED).json()
    iid = created['id']
    assert created['connection'] == 'unsupported'

    movements = [{'id': 'm1', 'approach': 'NB', 'lanes': ['through'],
                  'phase': 2, 'lat': 33.8, 'lon': -84.3, 'heading': 10}]
    res = client.put(f'/api/intersections/{iid}', json={'movements': movements})
    assert res.status_code == 200
    assert res.json()['movements'][0]['phase'] == 2

    # Malformed movements are dropped, not fatal.
    res = client.put(f'/api/intersections/{iid}',
                     json={'movements': [{'approach': 'XX'}]})
    assert res.status_code == 200
    assert res.json()['movements'] == []

    assert client.delete(f'/api/intersections/{iid}').json()['deleted'] is True
    assert client.delete(f'/api/intersections/{iid}').status_code == 404


def test_duplicate_names_get_unique_ids(client):
    first = client.post('/api/intersections', json=UNSUPPORTED).json()
    second = client.post('/api/intersections', json=UNSUPPORTED).json()
    assert first['id'] != second['id']


def test_call_rejects_boolean_phase(client):
    created = client.post('/api/intersections', json=UNSUPPORTED).json()
    iid = created['id']
    res = client.post(f'/api/intersections/{iid}/call',
                      json={'kind': 'veh', 'phase': True})
    assert res.status_code == 422
    res = client.post(f'/api/intersections/{iid}/call',
                      json={'kind': 'veh', 'phase': 0})
    assert res.status_code == 422
    res = client.post(f'/api/intersections/{iid}/call',
                      json={'kind': 'bogus', 'phase': 1})
    assert res.status_code == 422


def test_control_endpoints_404_unknown_intersection(client):
    assert client.post('/api/intersections/nope/arm').status_code == 404
    assert client.post('/api/intersections/nope/call',
                       json={'phase': 1}).status_code == 404


def test_update_nonexistent_404(client):
    assert client.put('/api/intersections/nope',
                      json={'name': 'x'}).status_code == 404
