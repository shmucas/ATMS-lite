import { useEffect, useState } from 'react'
import { intersectionsApi, type HiresEvent } from '../lib/intersections'
import { SIGNAL_FILL } from '../lib/phaseColors'
import { progressionLines, reconstructIntervals } from '../lib/timespace'
import type { StreamState } from '../lib/stream'
import type { IntersectionInfo } from '../types'

const REFRESH_MS = 5000
const MARGIN = { top: 24, right: 24, bottom: 32, left: 270 }
const ROW_HEIGHT = 64
const BAR_HEIGHT = 20
const CHART_WIDTH = 760

interface CorridorMember {
  info: IntersectionInfo
  positionM: number
  phase: number
}

function groupCorridors(intersections: IntersectionInfo[]) {
  const groups = new Map<string, CorridorMember[]>()
  for (const info of intersections) {
    const c = info.corridor
    if (!c) continue
    const list = groups.get(c.name) ?? []
    list.push({ info, positionM: c.position_m, phase: c.phase })
    groups.set(c.name, list)
  }
  for (const list of groups.values()) list.sort((a, b) => a.positionM - b.positionM)
  return groups
}

function CorridorChart(props: {
  name: string
  members: CorridorMember[]
  minutes: number
  speedMph: number
  cycleLengthS: number
}) {
  const { name, members, minutes, speedMph, cycleLengthS } = props
  const [events, setEvents] = useState<Record<string, HiresEvent[]>>({})
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const pairs = await Promise.all(
          members.map(async (m) => [m.info.id, await intersectionsApi.hires(m.info.id, { minutes })] as const),
        )
        if (stopped) return
        setEvents(Object.fromEntries(pairs))
        setNow(Date.now())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.map((m) => m.info.id).join(','), minutes])

  const windowEnd = now
  const windowStart = windowEnd - minutes * 60000
  const positions = members.map((m) => m.positionM)
  const minPos = Math.min(...positions)
  const maxPos = Math.max(...positions)
  const plotHeight = Math.max(members.length - 1, 1) * ROW_HEIGHT
  const plotWidth = CHART_WIDTH
  const width = plotWidth + MARGIN.left + MARGIN.right
  const height = plotHeight + MARGIN.top + MARGIN.bottom

  const xScale = (t: number) =>
    MARGIN.left + ((t - windowStart) / (windowEnd - windowStart)) * plotWidth
  const yScale = (pos: number) =>
    MARGIN.top +
    (maxPos > minPos ? ((pos - minPos) / (maxPos - minPos)) * plotHeight : plotHeight / 2)

  const lines = progressionLines(windowStart, windowEnd, minPos, maxPos, speedMph, cycleLengthS)

  const tickCount = Math.min(minutes, 10)
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => windowStart + (i * (windowEnd - windowStart)) / tickCount)

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        Corridor: {name}
      </h3>
      {error && (
        <div className="rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-xs text-[var(--color-offline)]">
          {error}
        </div>
      )}
      <div className="scroll-thin overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-2">
        <svg width={width} height={height}>
          <clipPath id={`plot-${name}`}>
            <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={plotHeight} />
          </clipPath>

          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={xScale(t)}
                y1={MARGIN.top}
                x2={xScale(t)}
                y2={MARGIN.top + plotHeight}
                stroke="var(--color-line)"
              />
              <text
                x={xScale(t)}
                y={MARGIN.top + plotHeight + 16}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-ink-3)"
              >
                {new Date(t).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
              </text>
            </g>
          ))}

          <g clipPath={`url(#plot-${name})`}>
            {lines.map((l, i) => (
              <line
                key={i}
                x1={xScale(l.x1)}
                y1={yScale(l.y1)}
                x2={xScale(l.x2)}
                y2={yScale(l.y2)}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.55}
              />
            ))}
          </g>

          {members.map((m) => {
            const y = yScale(m.positionM)
            const intervals = reconstructIntervals(events[m.info.id] ?? [], m.phase, windowStart, windowEnd)
            return (
              <g key={m.info.id}>
                <text
                  x={MARGIN.left - 10}
                  y={y - 6}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--color-ink)"
                >
                  {m.info.name}
                </text>
                <text
                  x={MARGIN.left - 10}
                  y={y + 8}
                  textAnchor="end"
                  fontSize={9}
                  fill="var(--color-ink-3)"
                >
                  {m.positionM.toFixed(0)} m · phase {m.phase}
                </text>
                <line
                  x1={MARGIN.left}
                  y1={y}
                  x2={MARGIN.left + plotWidth}
                  y2={y}
                  stroke="var(--color-line)"
                />
                {intervals.map((iv, i) => (
                  <rect
                    key={i}
                    x={xScale(iv.start)}
                    y={y - BAR_HEIGHT / 2}
                    width={Math.max(xScale(iv.end) - xScale(iv.start), 1)}
                    height={BAR_HEIGHT}
                    fill={SIGNAL_FILL[iv.signal]}
                  />
                ))}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export function TimeSpaceDiagram(props: { stream: StreamState; onClose: () => void }) {
  const { stream, onClose } = props
  const [minutes, setMinutes] = useState(5)
  const [speedMph, setSpeedMph] = useState(25)
  const [cycleLengthS, setCycleLengthS] = useState(90)

  const corridors = groupCorridors(stream.intersections)

  return (
    <div className="flex h-full w-full flex-col border-t border-[var(--color-line)] bg-[var(--color-panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="text-base font-bold text-[var(--color-ink)]">Time-space diagram</h2>
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
          Window
          <input
            type="number"
            min={1}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)))}
            className="w-14 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
          min
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Design speed
          <input
            type="number"
            min={0}
            value={speedMph}
            onChange={(e) => setSpeedMph(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-14 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
          mph
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Band spacing
          <input
            type="number"
            min={1}
            value={cycleLengthS}
            onChange={(e) => setCycleLengthS(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
          s
        </label>
      </div>

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-4">
        {corridors.size === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
            No intersections are assigned to a corridor yet.
          </div>
        ) : (
          Array.from(corridors.entries()).map(([name, members]) => (
            <CorridorChart
              key={name}
              name={name}
              members={members}
              minutes={minutes}
              speedMph={speedMph}
              cycleLengthS={cycleLengthS}
            />
          ))
        )}
      </div>
    </div>
  )
}
