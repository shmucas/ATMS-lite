import type { HiresEvent } from './intersections'
import type { Phase } from '../types'
import { reconstructIntervals, type PhaseInterval } from './timespace'

/* Purdue Coordination Diagram: detector arrivals plotted against the
   coordinated phase's green/yellow/red band, one column per cycle. Cycle
   boundaries are the same green-onset-to-green-onset definition Split
   Monitor uses (see splitMonitor.ts), so a "cycle" here starts at a green
   onset and runs to the next green onset of the same phase.

   Detector on (81) marks an arrival; detector off (82) is ignored for this
   report - PCD plots arrival ticks, not occupancy durations. Termination
   cause and any notion of "programmed offset" are deliberately absent: they
   need controller events (4/5/6) and coord config this poll-derived stream
   does not carry, same discipline as splitMonitor.ts. */

const GREEN = 1
const DETECTOR_ON = 81

export interface PcdActuation {
  ts: number // epoch ms
  channel: number
  offset: number // seconds into the cycle (0 = the cycle's green onset)
  signal: Phase['signal'] | null // band the arrival landed in; null if no band covers it
}

export interface PcdCycle {
  cycleStart: number // epoch ms of the green onset that starts this cycle
  cycleEnd: number | null // epoch ms of the next green onset; null for the open trailing cycle
  length: number // seconds, cycleEnd (or window end) - cycleStart
  bands: PhaseInterval[] // green/yellow/red intervals, clipped to this cycle
  actuations: PcdActuation[]
}

function greenOnsets(events: HiresEvent[], phase: number): number[] {
  return events
    .filter((e) => e.event_param === phase && e.event_code === GREEN)
    .map((e) => new Date(e.ts).getTime())
    .sort((a, b) => a - b)
}

function signalAt(bands: PhaseInterval[], t: number): Phase['signal'] | null {
  const band = bands.find((b) => t >= b.start && t < b.end)
  return band ? band.signal : null
}

/* Which detector channels have at least one arrival (81) in the window,
   ascending - drives the channel picker. */
export function detectorChannels(events: HiresEvent[]): number[] {
  const channels = new Set<number>()
  for (const e of events) {
    if (e.event_code === DETECTOR_ON && e.event_param != null) channels.add(e.event_param)
  }
  return [...channels].sort((a, b) => a - b)
}

/* Percent arrivals on green: the PCD's headline number. Arrivals whose
   band is unknown (no interval covers them) are excluded from the
   denominator rather than counted as not-green. Null when no arrival
   landed in a known band. */
export function arrivalsOnGreenPct(cycles: PcdCycle[]): number | null {
  let green = 0
  let known = 0
  for (const c of cycles) {
    for (const a of c.actuations) {
      if (a.signal == null) continue
      known++
      if (a.signal === 'green') green++
    }
  }
  return known > 0 ? (100 * green) / known : null
}

export function computeCycles(
  events: HiresEvent[],
  phase: number,
  channel: number,
  windowStart: number,
  windowEnd: number,
): PcdCycle[] {
  const bands = reconstructIntervals(events, phase, windowStart, windowEnd)
  // Cycle boundaries are green onsets inside the window. An arrival before
  // the first green onset has no complete cycle to anchor to and is
  // dropped, same "no clipped edges" discipline as computeSplits.
  const starts = greenOnsets(events, phase).filter((t) => t >= windowStart && t < windowEnd)

  const actuationTimes = events
    .filter((e) => e.event_code === DETECTOR_ON && e.event_param === channel)
    .map((e) => new Date(e.ts).getTime())
    .filter((t) => t >= windowStart && t < windowEnd)
    .sort((a, b) => a - b)

  const cycles: PcdCycle[] = []
  for (let k = 0; k < starts.length; k++) {
    const cycleStart = starts[k]
    const isLast = k + 1 >= starts.length
    const cycleEnd = isLast ? windowEnd : starts[k + 1]
    if (cycleEnd <= cycleStart) continue

    const cycleBands = bands
      .filter((b) => b.start < cycleEnd && b.end > cycleStart)
      .map((b) => ({
        start: Math.max(b.start, cycleStart),
        end: Math.min(b.end, cycleEnd),
        signal: b.signal,
      }))

    const actuations: PcdActuation[] = actuationTimes
      .filter((t) => t >= cycleStart && t < cycleEnd)
      .map((t) => ({
        ts: t,
        channel,
        offset: (t - cycleStart) / 1000,
        signal: signalAt(cycleBands, t),
      }))

    cycles.push({
      cycleStart,
      cycleEnd: isLast ? null : cycleEnd,
      length: (cycleEnd - cycleStart) / 1000,
      bands: cycleBands,
      actuations,
    })
  }
  return cycles
}
