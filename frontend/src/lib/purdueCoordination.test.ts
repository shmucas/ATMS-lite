import { describe, expect, it } from 'vitest'
import { computeCycles, detectorChannels } from './purdueCoordination'
import type { HiresEvent } from './intersections'

// Two full cycles of phase 2 (green -> yellow -> red, 60s apart), with
// detector 3 arrivals: one during green in cycle 1, one during red in
// cycle 1, and one during green in cycle 2. A detector-off (82) and an
// arrival on a different channel must never leak into the report.
const events: HiresEvent[] = [
  { ts: '2026-07-13T00:00:00.000Z', event_code: 1, event_param: 2 }, // green
  { ts: '2026-07-13T00:00:20.000Z', event_code: 8, event_param: 2 }, // yellow
  { ts: '2026-07-13T00:00:23.000Z', event_code: 10, event_param: 2 }, // red
  { ts: '2026-07-13T00:01:00.000Z', event_code: 1, event_param: 2 }, // green (cycle 2, length 60s)
  { ts: '2026-07-13T00:01:25.000Z', event_code: 8, event_param: 2 }, // yellow
  { ts: '2026-07-13T00:01:28.000Z', event_code: 10, event_param: 2 }, // red
  { ts: '2026-07-13T00:02:00.000Z', event_code: 1, event_param: 2 }, // green (opens trailing cycle)

  { ts: '2026-07-13T00:00:05.000Z', event_code: 81, event_param: 3 }, // arrival in green, cycle 1
  { ts: '2026-07-13T00:00:05.500Z', event_code: 82, event_param: 3 }, // detector off - ignored
  { ts: '2026-07-13T00:00:40.000Z', event_code: 81, event_param: 3 }, // arrival in red, cycle 1
  { ts: '2026-07-13T00:01:10.000Z', event_code: 81, event_param: 3 }, // arrival in green, cycle 2
  { ts: '2026-07-13T00:00:07.000Z', event_code: 81, event_param: 9 }, // different channel - excluded
]

const windowStart = Date.parse('2026-07-13T00:00:00.000Z')
const windowEnd = Date.parse('2026-07-13T00:02:30.000Z')

describe('computeCycles', () => {
  it('buckets arrivals into the cycle they fell in, with offset and band', () => {
    const cycles = computeCycles(events, 2, 3, windowStart, windowEnd)
    expect(cycles).toHaveLength(3)

    expect(cycles[0].cycleStart).toBe(Date.parse('2026-07-13T00:00:00.000Z'))
    expect(cycles[0].cycleEnd).toBe(Date.parse('2026-07-13T00:01:00.000Z'))
    expect(cycles[0].length).toBe(60)
    expect(cycles[0].actuations).toEqual([
      {
        ts: Date.parse('2026-07-13T00:00:05.000Z'),
        channel: 3,
        offset: 5,
        signal: 'green',
      },
      {
        ts: Date.parse('2026-07-13T00:00:40.000Z'),
        channel: 3,
        offset: 40,
        signal: 'red',
      },
    ])

    expect(cycles[1].actuations).toEqual([
      {
        ts: Date.parse('2026-07-13T00:01:10.000Z'),
        channel: 3,
        offset: 10,
        signal: 'green',
      },
    ])

    // Trailing cycle is open (no following green onset in the window).
    expect(cycles[2].cycleEnd).toBeNull()
    expect(cycles[2].actuations).toEqual([])
  })

  it('drops arrivals before the first green onset in the window', () => {
    const early: HiresEvent[] = [
      { ts: '2026-07-13T00:00:10.000Z', event_code: 81, event_param: 3 },
      { ts: '2026-07-13T00:00:30.000Z', event_code: 1, event_param: 2 },
    ]
    const cycles = computeCycles(early, 2, 3, windowStart, windowEnd)
    expect(cycles).toHaveLength(1)
    expect(cycles[0].actuations).toEqual([])
  })

  it('returns no cycles when the phase never went green in the window', () => {
    expect(computeCycles(events, 5, 3, windowStart, windowEnd)).toEqual([])
  })
})

describe('detectorChannels', () => {
  it('lists only channels with at least one arrival, ascending', () => {
    expect(detectorChannels(events)).toEqual([3, 9])
  })
})
