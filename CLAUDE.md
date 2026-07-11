# ATMS bench network notes

Mac lab interface is the USB 10/100/1000 LAN adapter, device `en7`. Working static IP for the Mac is `10.42.0.3/24`, not `.1`: `.1` produced a flapping/vanishing ARP entry for the controller and all IPv4 services (SNMP, HTTP) timed out, even though ARP and ICMPv6 worked. Switching the Mac to `.3` fixed it instantly (clean ping, web UI responded). If the link goes flaky again, suspect the Mac's own IP choice on this segment before the cable or the controller.

Controller: MaxTime 2070, MAC `64:55:63:00:ea:6a`, IP `10.42.0.2`.

Web UI confirmed live at `http://10.42.0.2/maxtime/` (redirects from `/maxtime`, HTTP 200, nginx).

SNMP works from `10.42.0.3` on standard port 161, but the agent is v1 only: it silently ignores v2c requests. Always use `-v1` (pysnmp `mpModel=0`). Read community is `public`. sysDescr: `Q-Free MaxTime 2.12.0-57-g3e627e0a1 Linux`, sysName `MaxTime`. Multi-OID GETs in one PDU work. Write community: known and stored in the local .env (gitignored). Never put the actual string in this file or anything committed; the repo is public.

Thunderbolt Bridge (`bridge0`) is Mac-to-Mac only and is never the right interface for this link.
