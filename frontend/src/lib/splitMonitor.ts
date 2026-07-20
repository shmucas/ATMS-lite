import type { HiresEvent } from './intersections'

/* ATSPM Split Monitor, computed from the same onset-only hi-res stream the
   time-space diagram uses. Each time a phase goes green we have a served
   activation: green begin (1) -> yellow begin (8) -> red begin (10). Polling
   cannot separate red clearance from the phase simply being off (see
   backend/app/hires.py), so a phase's measurable split is green + yellow;
   the cycle length is green-onset to the next green-onset of the same phase.

   Termination cause (gap-out / max-out / force-off) and the programmed split
   are deliberately absent: they need controller events (4/5/6) and coord
   config this poll-derived stream does not carry. Reported honestly rather
   than guessed. */

const GREEN = 1
const YELLOW = 8
const RED = 10

export interface PhaseSplit {
  greenStart: number // epoch ms of the green onset
  green: number // seconds of green
  yellow: number // seconds of yellow clearance
  cycle: number | null // seconds, green-to-green; null for the last activation
}

export interface PhaseSplitSeries {
  phase: number
  splits: PhaseSplit[]
  avgGreen: number
  minGreen: number
  maxGreen: number
  avgCycle: number | null
}

interface Onset {
  t: number
  code: number
}

function onsetsFor(events: HiresEvent[], phase: number): Onset[] {
  return events
    .filter(
      (e) =>
        e.event_param === phase &&
        (e.event_code === GREEN || e.event_code === YELLOW || e.event_code === RED),
    )
    .map((e) => ({ t: new Date(e.ts).getTime(), code: e.event_code }))
    .sort((a, b) => a.t - b.t)
}

export function computeSplits(events: HiresEvent[], phase: number): PhaseSplit[] {
  const onsets = onsetsFor(events, phase)
  const greens = onsets.filter((o) => o.code === GREEN).map((o) => o.t)
  const splits: PhaseSplit[] = []

  for (let k = 0; k < greens.length; k++) {
    const gStart = greens[k]
    const nextGreen = k + 1 < greens.length ? greens[k + 1] : null
    const before = (t: number) => nextGreen === null || t < nextGreen

    const yellow = onsets.find((o) => o.code === YELLOW && o.t > gStart && before(o.t))
    // An activation with no yellow onset is a clipped edge (green still running
    // at the window edge, or a skipped phase). Drop it so the chart shows only
    // complete green->yellow splits.
    if (!yellow) continue
    const red = onsets.find((o) => o.code === RED && o.t > yellow.t && before(o.t))

    splits.push({
      greenStart: gStart,
      green: (yellow.t - gStart) / 1000,
      yellow: red ? (red.t - yellow.t) / 1000 : 0,
      cycle: nextGreen !== null ? (nextGreen - gStart) / 1000 : null,
    })
  }
  return splits
}

/* Which phases actually served at least one complete split in the window,
   ascending - drives the phase picker so empty phases never show. */
export function phasesWithSplits(events: HiresEvent[]): number[] {
  const phases = new Set<number>()
  for (const e of events) if (e.event_param != null) phases.add(e.event_param)
  return [...phases]
    .filter((p) => p > 0 && p <= 16 && computeSplits(events, p).length > 0)
    .sort((a, b) => a - b)
}

/* Every phase with any signal onset in the window, ascending. The picker
   shows these all, disabling the ones without a complete split, so "phase 4
   never served" and "the tool doesn't cover phase 4" stay distinguishable. */
export function phasesSeen(events: HiresEvent[]): number[] {
  const phases = new Set<number>()
  for (const e of events) {
    if (
      (e.event_code === GREEN || e.event_code === YELLOW || e.event_code === RED) &&
      e.event_param != null &&
      e.event_param > 0 &&
      e.event_param <= 16
    ) {
      phases.add(e.event_param)
    }
  }
  return [...phases].sort((a, b) => a - b)
}

const PED_WALK = 21
const PED_CLEAR = 22
const PED_DONT_WALK = 23

export interface PedService {
  services: number // complete walk -> clearance -> dont-walk sequences
  avgWalk: number // seconds of walk
  avgClearance: number // seconds of flashing dont-walk
}

/* Ped service per phase from the walk (21) / clearance (22) / solid
   dont-walk (23) onsets. Only complete walk->clearance->dont-walk
   sequences count, same no-clipped-edges discipline as computeSplits.
   Null when the phase served no complete ped interval in the window. */
export function computePedService(events: HiresEvent[], phase: number): PedService | null {
  const onsets = events
    .filter(
      (e) =>
        e.event_param === phase &&
        (e.event_code === PED_WALK ||
          e.event_code === PED_CLEAR ||
          e.event_code === PED_DONT_WALK),
    )
    .map((e) => ({ t: new Date(e.ts).getTime(), code: e.event_code }))
    .sort((a, b) => a.t - b.t)

  const walks: number[] = []
  const clears: number[] = []
  for (let i = 0; i + 2 < onsets.length; i++) {
    if (
      onsets[i].code === PED_WALK &&
      onsets[i + 1].code === PED_CLEAR &&
      onsets[i + 2].code === PED_DONT_WALK
    ) {
      walks.push((onsets[i + 1].t - onsets[i].t) / 1000)
      clears.push((onsets[i + 2].t - onsets[i + 1].t) / 1000)
    }
  }
  if (walks.length === 0) return null
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return { services: walks.length, avgWalk: avg(walks), avgClearance: avg(clears) }
}

export function summarize(phase: number, splits: PhaseSplit[]): PhaseSplitSeries {
  const greens = splits.map((s) => s.green)
  const cycles = splits.map((s) => s.cycle).filter((c): c is number => c != null)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  return {
    phase,
    splits,
    avgGreen: avg(greens),
    minGreen: greens.length ? Math.min(...greens) : 0,
    maxGreen: greens.length ? Math.max(...greens) : 0,
    avgCycle: cycles.length ? avg(cycles) : null,
  }
}
