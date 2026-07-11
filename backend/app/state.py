"""In-process hub: latest snapshots, event ring buffers, pub/sub fan-out.

The message schema published here is the same one that later rides a broker
between containers at M8. Transport changes; schema does not.
"""

import asyncio
import collections


class Hub:
    def __init__(self):
        self.latest = {}    # intersection id -> last good snapshot
        self.static = {}    # intersection id -> static controller info
        self.control = {}   # intersection id -> control/arm status
        self.events = collections.defaultdict(
            lambda: collections.deque(maxlen=200))
        self._subscribers = set()

    def subscribe(self):
        queue = asyncio.Queue(maxsize=500)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue):
        self._subscribers.discard(queue)

    def publish_snapshot(self, snapshot):
        self.latest[snapshot['intersection_id']] = snapshot
        self._fanout({'type': 'snapshot', 'data': snapshot})

    def publish_event(self, event):
        self.events[event['intersection_id']].append(event)
        self._fanout({'type': 'event', 'data': event})

    def publish_control(self, intersection_id, status):
        self._fanout({'type': 'control',
                      'data': {'intersection_id': intersection_id, **status}})

    def _fanout(self, message):
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Slow consumer: drop this message for that consumer rather
                # than stall every other subscriber.
                pass
