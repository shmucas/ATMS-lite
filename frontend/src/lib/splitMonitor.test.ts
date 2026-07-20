import { describe, expect, it } from 'vitest'
import { computePedService, computeSplits, phasesWithSplits, summarize } from './splitMonitor'
import type { HiresEvent } from './intersections'

// Two full activations of phase 2, each green -> yellow -> red, with a
// second green onset 60s after the first so a cycle length is measurable.
const events: HiresEvent[] = [
  { ts: '2026-07-13T00:00:00.000Z', event_code: 1, event_param: 2 }, // green
  { ts: '2026-07-13T00:00:20.000Z', event_code: 8, event_param: 2 }, // yellow
  { ts: '2026-07-13T00:00:23.000Z', event_code: 10, event_param: 2 }, // red
  { ts: '2026-07-13T00:01:00.000Z', event_code: 1, event_param: 2 }, // green (cycle = 60s)
  { ts: '2026-07-13T00:01:25.000Z', event_code: 8, event_param: 2 }, // yellow
  { ts: '2026-07-13T00:01:28.000Z', event_code: 10, event_param: 2 }, // red
  // A different phase must never leak into phase 2's splits.
  { ts: '2026-07-13T00:00:10.000Z', event_code: 1, event_param: 6 },
]

describe('computeSplits', () => {
  it('derives green, yellow, and green-to-green cycle per activation', () => {
    const splits = computeSplits(events, 2)
    expect(splits).toEqual([
      {
        greenStart: Date.parse('2026-07-13T00:00:00.000Z'),
        green: 20,
        yellow: 3,
        cycle: 60,
      },
      {
        greenStart: Date.parse('2026-07-13T00:01:00.000Z'),
        green: 25,
        yellow: 3,
        cycle: null, // last activation has no following green
      },
    ])
  })

  it('drops an activation with no following yellow onset', () => {
    const partial: HiresEvent[] = [
      { ts: '2026-07-13T00:00:00.000Z', event_code: 1, event_param: 4 },
    ]
    expect(computeSplits(partial, 4)).toEqual([])
  })
})

describe('phasesWithSplits', () => {
  it('lists only phases that ran a complete split, ascending', () => {
    expect(phasesWithSplits(events)).toEqual([2])
  })
})

describe('summarize', () => {
  it('averages green and cycle over the activations', () => {
    const s = summarize(2, computeSplits(events, 2))
    expect(s.avgGreen).toBe(22.5)
    expect(s.minGreen).toBe(20)
    expect(s.maxGreen).toBe(25)
    expect(s.avgCycle).toBe(60)
    expect(s.splits).toHaveLength(2)
  })
})

describe('computePedService', () => {
  it('averages complete walk -> clearance -> dont-walk sequences', () => {
    const ped: HiresEvent[] = [
      { ts: '2026-07-13T00:00:00.000Z', event_code: 21, event_param: 2 },
      { ts: '2026-07-13T00:00:07.000Z', event_code: 22, event_param: 2 },
      { ts: '2026-07-13T00:00:22.000Z', event_code: 23, event_param: 2 },
      // Clipped second service: walk with no clearance after it.
      { ts: '2026-07-13T00:01:00.000Z', event_code: 21, event_param: 2 },
    ]
    expect(computePedService(ped, 2)).toEqual({
      services: 1,
      avgWalk: 7,
      avgClearance: 15,
    })
  })

  it('is null when the phase served no complete ped interval', () => {
    expect(computePedService([], 2)).toBeNull()
  })
})
