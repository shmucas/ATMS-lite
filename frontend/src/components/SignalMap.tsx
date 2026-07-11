import 'leaflet/dist/leaflet.css'
import { divIcon } from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import type { StreamState } from '../lib/stream'
import type { Connection, Snapshot } from '../types'

const STATUS: Record<Connection, string> = {
  connected: 'var(--color-online)',
  degraded: 'var(--color-degraded)',
  disconnected: 'var(--color-offline)',
}

const SIGNAL_HEX: Record<string, string> = {
  green: '#10d982',
  yellow: '#f5c518',
  red: '#ff5a5a',
  dark: '#3a4a5f',
}

/* A control-room map marker: a status ring around a compact readout of what the
   intersection is serving. Identity never rests on color alone - offline
   markers carry a slash, and the panel names the state in words. */
function markerHtml(
  info: { name: string; connection: Connection },
  snap: Snapshot | undefined,
  selected: boolean,
) {
  const color = STATUS[info.connection]
  const online = info.connection !== 'disconnected'
  const greens = snap ? snap.phases.filter((p) => p.signal === 'green') : []

  const lamps = snap
    ? snap.phases
        .slice(0, 8)
        .map((p) => {
          const on = p.signal !== 'dark' && p.signal !== 'red'
          const c = on ? SIGNAL_HEX[p.signal] : '#28374a'
          return `<span style="width:5px;height:5px;border-radius:9999px;background:${c};display:block"></span>`
        })
        .join('')
    : ''

  const pulse = online
    ? `<span style="position:absolute;inset:-3px;border-radius:9999px;border:2px solid ${color};animation:pulse-ring 2.4s ease-out infinite"></span>`
    : ''

  const slash = !online
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${color};font-size:16px;font-weight:700">/</span>`
    : ''

  return `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
      <div style="position:relative;width:${selected ? 46 : 40}px;height:${selected ? 46 : 40}px;
        border-radius:9999px;background:#0d141e;border:2px solid ${color};
        box-shadow:0 4px 14px rgba(0,0,0,.5)${selected ? `,0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)` : ''};
        display:flex;align-items:center;justify-content:center">
        ${pulse}
        ${slash}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:2px;padding:4px">${lamps}</div>
      </div>
      <div style="margin-top:4px;padding:1px 6px;border-radius:5px;background:#0d141e;
        border:1px solid var(--color-line);color:var(--color-ink-2);font-size:10px;
        font-weight:600;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis">
        ${info.name}${greens.length ? ` · ${greens.map((p) => p.phase).join(',')}` : ''}
      </div>
    </div>`
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 15)
    } else {
      map.fitBounds(points, { padding: [80, 80], maxZoom: 16 })
    }
    // Only refit when the set of points changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length])
  return null
}

export function SignalMap(props: {
  stream: StreamState
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { stream, selected, onSelect } = props
  const located = stream.intersections.filter(
    (i) => i.lat != null && i.lon != null,
  )
  const points = located.map((i) => [i.lat!, i.lon!] as [number, number])
  const center: [number, number] = points[0] ?? [40.75, -73.99]

  return (
    <MapContainer
      center={center}
      zoom={14}
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {located.map((ix) => {
        const snap = stream.snapshots[ix.id]
        return (
          <Marker
            key={ix.id}
            position={[ix.lat!, ix.lon!]}
            icon={divIcon({
              className: '',
              iconSize: [120, 64],
              iconAnchor: [60, 32],
              html: markerHtml(ix, snap, selected === ix.id),
            })}
            eventHandlers={{ click: () => onSelect(ix.id) }}
          />
        )
      })}
    </MapContainer>
  )
}
