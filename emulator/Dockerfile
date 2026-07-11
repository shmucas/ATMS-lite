# Virtual NTCIP controller. No third-party deps: the SNMP agent is hand-rolled,
# so this stays a tiny slim-python image.
FROM python:3.12-slim

WORKDIR /app
COPY signal_engine.py snmp_agent.py main.py ./

# SNMP over UDP.
EXPOSE 161/udp

ENV EMU_SNMP_PORT=161 \
    EMU_SYS_NAME=VirtualASC \
    EMU_TICK_HZ=10

CMD ["python", "main.py"]
