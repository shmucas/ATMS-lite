import { describe, expect, it } from 'vitest'
import { reconstructIntervals } from './timespace'
import type { HiresEvent } from './intersections'

describe('reconstructIntervals', () => {
  it('turns onset-only events into color intervals clipped to the window', () => {
    const events: HiresEvent[] = [
      { ts: '2026-07-13T00:00:30.000Z', event_code: 1, event_param: 2 },
      { ts: '2026-07-13T00:01:00.000Z', event_code: 8, event_param: 2 },
      { ts: '2026-07-13T00:01:03.000Z', event_code: 10, event_param: 2 },
      // A different phase's events must be ignored.
      { ts: '2026-07-13T00:00:45.000Z', event_code: 1, event_param: 6 },
    ]
    const windowStart = Date.parse('2026-07-13T00:00:00.000Z')
    const windowEnd = Date.parse('2026-07-13T00:02:00.000Z')

    const intervals = reconstructIntervals(events, 2, windowStart, windowEnd)

    expect(intervals).toEqual([
      { start: Date.parse('2026-07-13T00:00:30.000Z'), end: Date.parse('2026-07-13T00:01:00.000Z'), signal: 'green' },
      { start: Date.parse('2026-07-13T00:01:00.000Z'), end: Date.parse('2026-07-13T00:01:03.000Z'), signal: 'yellow' },
      { start: Date.parse('2026-07-13T00:01:03.000Z'), end: windowEnd, signal: 'red' },
    ])
  })

  it('clips an onset that starts before the window to the window edge', () => {
    const events: HiresEvent[] = [
      { ts: '2026-07-12T23:59:00.000Z', event_code: 1, event_param: 2 },
      { ts: '2026-07-13T00:00:30.000Z', event_code: 8, event_param: 2 },
    ]
    const windowStart = Date.parse('2026-07-13T00:00:00.000Z')
    const windowEnd = Date.parse('2026-07-13T00:01:00.000Z')

    const intervals = reconstructIntervals(events, 2, windowStart, windowEnd)

    expect(intervals).toEqual([
      { start: windowStart, end: Date.parse('2026-07-13T00:00:30.000Z'), signal: 'green' },
      { start: Date.parse('2026-07-13T00:00:30.000Z'), end: windowEnd, signal: 'yellow' },
    ])
  })

  it('returns nothing for a phase with no events', () => {
    const events: HiresEvent[] = [
      { ts: '2026-07-13T00:00:30.000Z', event_code: 1, event_param: 6 },
    ]
    expect(reconstructIntervals(events, 2, 0, 1000)).toEqual([])
  })
})
