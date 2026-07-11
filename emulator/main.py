"""Run the virtual controller: signal engine plus SNMP v1 agent.

Environment:
  EMU_SNMP_PORT   UDP port to listen on (default 161)
  EMU_SYS_NAME    sysName the agent reports (default VirtualASC)
  EMU_TICK_HZ     engine tick rate (default 10)
"""

import asyncio
import logging
import os

from signal_engine import SignalEngine
from snmp_agent import Agent, serve

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s emulator %(message)s')
log = logging.getLogger('emulator')


async def run():
    port = int(os.environ.get('EMU_SNMP_PORT', '161'))
    sys_name = os.environ.get('EMU_SYS_NAME', 'VirtualASC')
    tick_hz = float(os.environ.get('EMU_TICK_HZ', '10'))

    engine = SignalEngine()
    agent = Agent(engine, sys_name=sys_name)
    await serve(agent, port=port)
    log.info('virtual controller %s listening on udp/%s', sys_name, port)

    interval = 1.0 / tick_hz
    while True:
        engine.tick()
        await asyncio.sleep(interval)


if __name__ == '__main__':
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
