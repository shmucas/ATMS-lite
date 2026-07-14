import { useEffect, useMemo, useState } from 'react'
import { intersectionsApi, type HiresEvent } from '../lib/intersections'
import { SIGNAL_FILL } from '../lib/phaseColors'
import {
  computeSplits,
  phasesWithSplits,
  summarize,
  type PhaseSplit,
} from '../lib/splitMonitor'
import type { StreamState } from '../lib/stream'

const REFRESH_MS = 5000
const MARGIN = { top: 16, right: 20, bottom: 30, left: 40 }
const PLOT_HEIGHT = 240
const BAR_SLOT = 30 // px of horizontal room per cycle
const BAR_WIDTH = 16

function fmt(n: number, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : '-'
}

function Tile(props: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">
        {props.label}
      </div>
      <div className="text-lg font-semibold tabular text-[var(--color-ink)]">
        {props.value}
        {props.unit && (
          <span className="ml-1 text-xs font-normal text-[var(--color-ink-3)]">{props.unit}</span>
        )}
      </div>
    </div>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-2)]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

function SplitChart({ phase, splits }: { phase: number; splits: PhaseSplit[] }) {
  const [hover, setHover] = useState<number | null>(null)

  const cycleVals = splits.map((s) => s.cycle).filter((c): c is number => c != null)
  const yMax = Math.max(
    10,
    ...splits.map((s) => s.green + s.yellow),
    ...cycleVals,
  )
  const yTop = Math.ceil((yMax * 1.1) / 10) * 10

  const plotWidth = Math.max(splits.length * BAR_SLOT, 560)
  const width = plotWidth + MARGIN.left + MARGIN.right
  const height = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom

  const xOf = (i: number) => MARGIN.left + i * BAR_SLOT + BAR_SLOT / 2
  const yOf = (s: number) => MARGIN.top + PLOT_HEIGHT - (s / yTop) * PLOT_HEIGHT

  const yTicks = Array.from({ length: 5 }, (_, i) => (yTop / 4) * i)

  // Cycle-length polyline over the activations that have a measured cycle.
  const cyclePts = splits
    .map((s, i) => (s.cycle != null ? `${xOf(i)},${yOf(s.cycle)}` : null))
    .filter((p): p is string => p != null)
    .join(' ')

  return (
    <div className="relative">
      <div className="scroll-thin overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-2">
        <svg width={width} height={height}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={MARGIN.left}
                y1={yOf(v)}
                x2={MARGIN.left + plotWidth}
                y2={yOf(v)}
                stroke="var(--color-line)"
              />
              <text
                x={MARGIN.left - 6}
                y={yOf(v) + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--color-ink-3)"
              >
                {v}
              </text>
            </g>
          ))}

          {splits.map((s, i) => {
            const x = xOf(i) - BAR_WIDTH / 2
            const gTop = yOf(s.green)
            const gBottom = yOf(0)
            const yTopPx = yOf(s.green + s.yellow)
            const active = hover === i
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                {/* Yellow clearance, stacked on top with a 2px surface gap. */}
                {s.yellow > 0 && (
                  <rect
                    x={x}
                    y={yTopPx}
                    width={BAR_WIDTH}
                    height={Math.max(gTop - yTopPx - 2, 0)}
                    rx={3}
                    fill={SIGNAL_FILL.yellow}
                    opacity={active ? 1 : 0.9}
                  />
                )}
                {/* Green, anchored to the baseline. */}
                <rect
                  x={x}
                  y={gTop}
                  width={BAR_WIDTH}
                  height={Math.max(gBottom - gTop, 0)}
                  rx={3}
                  fill={SIGNAL_FILL.green}
                  opacity={active ? 1 : 0.9}
                />
                {/* Invisible full-height hit target for easy hover. */}
                <rect
                  x={xOf(i) - BAR_SLOT / 2}
                  y={MARGIN.top}
                  width={BAR_SLOT}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
              </g>
            )
          })}

          {/* Cycle length trace, one shared seconds axis with the splits. */}
          <polyline
            points={cyclePts}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
          />
          {splits.map((s, i) =>
            s.cycle != null ? (
              <circle
                key={i}
                cx={xOf(i)}
                cy={yOf(s.cycle)}
                r={hover === i ? 4 : 2.5}
                fill="var(--color-accent)"
                stroke="var(--color-panel-2)"
                strokeWidth={1.5}
              />
            ) : null,
          )}
        </svg>
      </div>

      {hover != null && splits[hover] && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] shadow-lg">
          <div className="mb-0.5 font-semibold text-[var(--color-ink)]">
            {new Date(splits[hover].greenStart).toLocaleTimeString([], {
              hour12: false,
            })}
          </div>
          <div className="tabular text-[var(--color-ink-2)]">
            Green {fmt(splits[hover].green)}s · Yellow {fmt(splits[hover].yellow)}s
          </div>
          <div className="tabular text-[var(--color-ink-3)]">
            Cycle {splits[hover].cycle != null ? `${fmt(splits[hover].cycle)}s` : '-'}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-4 px-1">
        <LegendKey color={SIGNAL_FILL.green} label="Green" />
        <LegendKey color={SIGNAL_FILL.yellow} label="Yellow" />
        <LegendKey color="var(--color-accent)" label="Cycle length" />
        <span className="ml-auto text-[10px] text-[var(--color-ink-3)]">
          Phase {phase} · seconds
        </span>
      </div>
    </div>
  )
}

function SplitMonitor(props: { id: string; minutes: number }) {
  const { id, minutes } = props
  const [events, setEvents] = useState<HiresEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<number | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const rows = await intersectionsApi.hires(id, {
          minutes,
          limit: Math.min(10000, minutes * 200),
        })
        if (stopped) return
        setEvents(rows)
        setError(null)
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const t = window.setInterval(load, REFRESH_MS)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  }, [id, minutes])

  const phases = useMemo(() => (events ? phasesWithSplits(events) : []), [events])

  // Keep a valid phase selected as data comes and goes.
  useEffect(() => {
    if (phases.length === 0) {
      if (phase !== null) setPhase(null)
    } else if (phase == null || !phases.includes(phase)) {
      setPhase(phases[0])
    }
  }, [phases, phase])

  const series = useMemo(
    () =>
      events && phase != null ? summarize(phase, computeSplits(events, phase)) : null,
    [events, phase],
  )

  if (error) {
    return (
      <div className="rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-sm text-[var(--color-offline)]">
        {error.includes('ATMS_DB_DSN')
          ? 'Hi-res capture is not enabled. Set ATMS_DB_DSN to record events for reports.'
          : error}
      </div>
    )
  }

  if (events == null) {
    return <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">Loading...</div>
  }

  if (phases.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[var(--color-ink-3)]">
        No complete phase splits in the last {minutes} min yet. Splits appear once a phase
        has run a full green-to-yellow cycle.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-[var(--color-ink-3)]">Phase</span>
        {phases.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPhase(p)}
            className={
              phase === p
                ? 'rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-accent)]'
                : 'rounded-md border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]'
            }
          >
            {p}
          </button>
        ))}
      </div>

      {series && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Avg green" value={fmt(series.avgGreen)} unit="s" />
            <Tile
              label="Green range"
              value={`${fmt(series.minGreen)}-${fmt(series.maxGreen)}`}
              unit="s"
            />
            <Tile
              label="Avg cycle"
              value={series.avgCycle != null ? fmt(series.avgCycle) : '-'}
              unit="s"
            />
            <Tile label="Cycles" value={String(series.splits.length)} />
          </div>
          <SplitChart phase={series.phase} splits={series.splits} />
        </>
      )}
    </div>
  )
}

export function AtspmReports(props: { stream: StreamState; onClose: () => void }) {
  const { stream, onClose } = props
  const ix = stream.intersections
  const [id, setId] = useState<string | null>(null)
  const [minutes, setMinutes] = useState(30)

  // Default to the first reachable intersection; keep the selection valid.
  useEffect(() => {
    if (ix.length === 0) {
      if (id !== null) setId(null)
      return
    }
    if (id == null || !ix.some((i) => i.id === id)) {
      const online = ix.find((i) => i.connection === 'connected' || i.connection === 'degraded')
      setId((online ?? ix[0]).id)
    }
  }, [ix, id])

  return (
    <div className="flex h-full w-full flex-col border-t border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-bold text-[var(--color-ink)]">ATSPM Reports</h2>
          <span className="text-xs text-[var(--color-ink-3)]">Split Monitor</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--color-ink-3)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Intersection
          <select
            value={id ?? ''}
            onChange={(e) => setId(e.target.value || null)}
            className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          >
            {ix.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Window
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) =>
              setMinutes(Math.max(1, Math.min(1440, parseInt(e.target.value, 10) || 1)))
            }
            className="w-16 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
          min
        </label>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {id == null ? (
          <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
            No intersections available.
          </div>
        ) : (
          <SplitMonitor id={id} minutes={minutes} />
        )}
      </div>
    </div>
  )
}
