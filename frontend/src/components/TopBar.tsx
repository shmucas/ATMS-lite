import { useEffect, useState } from 'react'
import type { StreamState } from '../lib/stream'

interface Weather {
  temp: number
  code: number
}

const WEATHER_TEXT: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 73: 'Snow',
  75: 'Snow', 80: 'Showers', 81: 'Showers', 82: 'Showers', 95: 'Storm',
}

function useWeather(lat?: number, lon?: number) {
  const [w, setW] = useState<Weather | null>(null)
  useEffect(() => {
    if (lat == null || lon == null) return
    let stop = false
    const load = () =>
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`,
      )
        .then((r) => r.json())
        .then((d) => {
          if (!stop && d.current)
            setW({ temp: d.current.temperature_2m, code: d.current.weather_code })
        })
        .catch(() => undefined)
    load()
    const t = window.setInterval(load, 600000)
    return () => {
      stop = true
      window.clearInterval(t)
    }
  }, [lat, lon])
  return w
}

function Stat(props: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: props.color }}
      />
      <span className="text-sm font-semibold text-[var(--color-ink)]">
        {props.value}
      </span>
      <span className="text-xs text-[var(--color-ink-3)]">{props.label}</span>
    </div>
  )
}

export function TopBar({
  stream,
  onAddIntersection,
}: {
  stream: StreamState
  onAddIntersection: () => void
}) {
  const ix = stream.intersections
  const online = ix.filter((i) => i.connection === 'connected').length
  const degraded = ix.filter((i) => i.connection === 'degraded').length
  const offline = ix.filter((i) => i.connection === 'disconnected').length
  const first = ix.find((i) => i.lat != null)
  const weather = useWeather(first?.lat ?? undefined, first?.lon ?? undefined)

  return (
    <header className="z-[1000] flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-panel)] px-5 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="8" y="2" width="8" height="20" rx="2" />
            <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-[var(--color-ink)]">
            ATMS<span className="text-[var(--color-accent)]">-lite</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">
            Traffic operations
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <Stat value={online} label="online" color="var(--color-online)" />
        {degraded > 0 && (
          <Stat value={degraded} label="degraded" color="var(--color-degraded)" />
        )}
        <Stat value={offline} label="offline" color="var(--color-offline)" />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onAddIntersection}
          className="rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
        >
          + Add intersection
        </button>
        {weather && (
          <span className="text-xs text-[var(--color-ink-2)]">
            {WEATHER_TEXT[weather.code] ?? ''} · {Math.round(weather.temp)}
            {'°'}C
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: stream.wsConnected
                ? 'var(--color-online)'
                : 'var(--color-offline)',
            }}
          />
          <span className="text-xs text-[var(--color-ink-2)]">
            {stream.wsConnected ? 'Live' : 'Offline'}
          </span>
        </span>
      </div>
    </header>
  )
}
