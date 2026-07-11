"""Thin async SNMP v1 client on pysnmp 7. One instance per intersection."""

from pysnmp.hlapi.v3arch.asyncio import (
    CommunityData,
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    get_cmd,
)


class SnmpError(Exception):
    """Agent answered with an error-status."""


class SnmpTimeout(SnmpError):
    """No response (timeout or transport failure)."""


def _dotted(oid_obj):
    getter = getattr(oid_obj, 'get_oid', None) or getattr(oid_obj, 'getOid', None)
    if getter is not None:
        try:
            oid = getter()
            parts = oid.asTuple() if hasattr(oid, 'asTuple') else tuple(oid)
            return '.'.join(map(str, parts))
        except Exception:
            pass
    return str(oid_obj)


class SnmpClient:
    def __init__(self, host, port, community, timeout=0.5, retries=0):
        self.host = host
        self.port = port
        self._engine = SnmpEngine()
        self._auth = CommunityData(community, mpModel=0)  # v1 only agent
        self._timeout = timeout
        self._retries = retries
        self._target = None

    async def _get_target(self):
        if self._target is None:
            if hasattr(UdpTransportTarget, 'create'):
                self._target = await UdpTransportTarget.create(
                    (self.host, self.port),
                    timeout=self._timeout, retries=self._retries)
            else:
                self._target = UdpTransportTarget(
                    (self.host, self.port),
                    timeout=self._timeout, retries=self._retries)
        return self._target

    async def get(self, oids):
        """GET a list of OIDs in one PDU. Returns dict oid -> pyasn1 value."""
        target = await self._get_target()
        var_binds = [ObjectType(ObjectIdentity(o)) for o in oids]
        err_ind, err_status, _, result = await get_cmd(
            self._engine, self._auth, target, ContextData(), *var_binds)
        if err_ind:
            raise SnmpTimeout(str(err_ind))
        if err_status:
            raise SnmpError(err_status.prettyPrint())
        return {_dotted(vb[0]): vb[1] for vb in result}
