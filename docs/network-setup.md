# Bench network runbook

## Topology

MacBook (USB 10/100/1000 LAN adapter, macOS device `en7`) connected by one Ethernet cable directly to the MaxTime 2070. Link negotiates 100BASE-TX full duplex.

## Addresses

| Device     | IP            | Notes                                                        |
|------------|---------------|--------------------------------------------------------------|
| Controller | 10.42.0.2/24  | MAC 64:55:63:00:ea:6a, Q-Free MaxTime 2.12.0-57, sysName MaxTime |
| MacBook    | 10.42.0.3/24  | No gateway on this interface. Internet stays on Wi-Fi.       |

## Mac setup

```
networksetup -setmanual "USB 10/100/1000 LAN" 10.42.0.3 255.255.255.0
```

Worked without sudo on this machine. Leave the router field blank so the default route stays on Wi-Fi.

## Verify

```
./tools/check_link.sh
```

Or manually:

```
ping -c 2 10.42.0.2
curl -I http://10.42.0.2/maxtime/
snmpget -v1 -c public 10.42.0.2 sysDescr.0
```

## Gotchas learned the hard way

1. **Give the laptop .3, not .1.** With the Mac at 10.42.0.1 the controller answered ARP but silently dropped every IPv4 packet, and the ARP entry for the controller flapped between two MACs. Moving the Mac to 10.42.0.3 fixed everything instantly. The vendor convention (PC address = controller address with the last octet incremented) turns out to matter. Root cause on the controller side is unconfirmed; most likely an address collision with the controller's configured gateway or its second Ethernet port.
2. **The MaxTime SNMP agent is v1 only.** It silently ignores SNMP v2c requests, which looks exactly like a dead network. Always use `-v1` on the CLI and `mpModel=0` in pysnmp.
3. **Thunderbolt Bridge is never the right interface.** It exists for Mac-to-Mac connections only. The controller link appears as "USB 10/100/1000 LAN" (or another Ethernet adapter) and holds a self-assigned 169.254.x.x address until the static IP is set.
4. **Chrome may refuse plain-HTTP private addresses** (extensions or HTTPS-first mode). Safari works fine. Type the scheme explicitly: `http://10.42.0.2/maxtime/`.
5. **The web UI lives at `/maxtime/`.** The bare IP does not serve it, and `/maxtime` without the trailing slash answers with a 302 redirect.
6. **Health checks should key off SNMP responses, not ping.** Ping proves the IP stack. Only an SNMP reply proves the NTCIP service. The backend connection state machine (M2) treats SNMP as the source of truth.

## Useful one-liners

```
arp -an | grep 10.42.0.2                      # is the controller resolving on the link
snmpget -v1 -c public 10.42.0.2 sysUpTime.0   # agent alive and ticking
```
