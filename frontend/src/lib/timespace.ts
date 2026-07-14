import type { HiresEvent } from './intersections'
import type { Phase } from '../types'

const GREEN = 1
const YELLOW = 8
const RED = 10

const CODE_SIGNAL: Record<number, Phase['signal']> = {
  [GREEN]: 'green',
  [YELLOW]: 'yellow',
  [RED]: 'red',
}

export interface PhaseInterval {
  start: number
  end: number
  signal: Phase['signal']
}

/* Hires events are onset-only (one row per color change, no explicit "end"
   event) - an interval for a phase runs from one onset to the next onset
   for that same phase. windowStart/windowEnd (epoch ms) clip the result so
   the diagram has a defined edge before the first onset and after the
   last one seen. */
export function reconstructIntervals(
  events: HiresEvent[],
  phase: number,
  windowStart: number,
  windowEnd: number,
): PhaseInterval[] {
  const onsets = events
    .filter((e) => e.event_param === phase && e.event_code in CODE_SIGNAL)
    .map((e) => ({ t: new Date(e.ts).getTime(), signal: CODE_SIGNAL[e.event_code] }))
    .sort((a, b) => a.t - b.t)

  const intervals: PhaseInterval[] = []
  for (let i = 0; i < onsets.length; i++) {
    const start = Math.max(onsets[i].t, windowStart)
    const end = i + 1 < onsets.length ? Math.min(onsets[i + 1].t, windowEnd) : windowEnd
    if (end <= start) continue
    intervals.push({ start, end, signal: onsets[i].signal })
  }
  return intervals
}

/* Progression-bandwidth overlay: a family of parallel lines through the
   time-position rectangle at a chosen travel speed, spaced by cycleLength
   seconds so they sweep every offset once per cycle. Pure geometry, no
   data dependency - the user picks a design speed and compares it against
   the real bars. */
export function progressionLines(
  windowStart: number,
  windowEnd: number,
  minPosition: number,
  maxPosition: number,
  speedMph: number,
  cycleLengthS: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  if (speedMph <= 0 || cycleLengthS <= 0) return []
  const speedMps = speedMph * 0.44704
  const spanM = maxPosition - minPosition
  if (spanM <= 0) return []
  const travelMs = (spanM / speedMps) * 1000
  const cycleMs = cycleLengthS * 1000

  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  // Start times cover the window plus one extra cycle of lead-in so lines
  // crossing the left/top edge are still drawn.
  for (let t0 = windowStart - travelMs; t0 < windowEnd; t0 += cycleMs) {
    lines.push({ x1: t0, y1: minPosition, x2: t0 + travelMs, y2: maxPosition })
  }
  return lines
}
