import { describe, expect, it } from 'vitest'
import { oppositeApproach, progressionLines, reconstructIntervals, resolveCorridorPhase } from './timespace'
import type { HiresEvent } from './intersections'
import type { Movement } from '../types'

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

describe('oppositeApproach', () => {
  it('flips along each compass axis', () => {
    expect(oppositeApproach('NB')).toBe('SB')
    expect(oppositeApproach('SB')).toBe('NB')
    expect(oppositeApproach('EB')).toBe('WB')
    expect(oppositeApproach('WB')).toBe('EB')
  })
})

describe('resolveCorridorPhase', () => {
  const movements: Movement[] = [
    { id: 'nb-left', approach: 'NB', lanes: ['left'], phase: 5, lat: 0, lon: 0, heading: 0 },
    { id: 'nb-through', approach: 'NB', lanes: ['through'], phase: 2, lat: 0, lon: 0, heading: 0 },
    { id: 'sb-through', approach: 'SB', lanes: ['through'], phase: 6, lat: 0, lon: 0, heading: 180 },
  ]

  it('picks the through movement on the requested approach', () => {
    expect(resolveCorridorPhase(movements, 'NB', 1)).toBe(2)
    expect(resolveCorridorPhase(movements, 'SB', 1)).toBe(6)
  })

  it('falls back to the manual phase when the approach has no mapped movement', () => {
    expect(resolveCorridorPhase(movements, 'EB', 4)).toBe(4)
  })

  it('falls back to the manual phase when movements is undefined', () => {
    expect(resolveCorridorPhase(undefined, 'NB', 4)).toBe(4)
  })
})

describe('progressionLines reversed', () => {
  it('mirrors the slope for the opposite travel direction', () => {
    const forward = progressionLines(0, 10000, 0, 100, 25, 90)
    const reverse = progressionLines(0, 10000, 0, 100, 25, 90, true)
    expect(forward[0].y1).toBe(0)
    expect(forward[0].y2).toBe(100)
    expect(reverse[0].y1).toBe(100)
    expect(reverse[0].y2).toBe(0)
  })
})
