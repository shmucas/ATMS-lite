import 'leaflet/dist/leaflet.css'
import { divIcon } from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { StreamState } from '../lib/stream'
import type { Connection, IntersectionInfo, Snapshot } from '../types'

const STATUS: Record<Connection, string> = {
  connected: 'var(--color-online)',
  degraded: 'var(--color-degraded)',
  disconnected: 'var(--color-offline)',
  unsupported: 'var(--color-ink-3)',
  starting: 'var(--color-ink-3)',
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

interface MenuState {
  x: number
  y: number
  lat: number
  lon: number
}

interface MarkerMenuState {
  x: number
  y: number
  id: string
  name: string
}

function MapContextMenu({
  onCreateAt,
  disabled,
  onInteraction,
}: {
  onCreateAt: (lat: number, lon: number) => void
  disabled?: boolean
  onInteraction: () => void
}) {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const map = useMapEvents({
    contextmenu(e) {
      onInteraction()
      if (disabled) return
      const point = map.latLngToContainerPoint(e.latlng)
      setMenu({ x: point.x, y: point.y, lat: e.latlng.lat, lon: e.latlng.lng })
    },
    click() {
      setMenu(null)
      onInteraction()
    },
    movestart() {
      setMenu(null)
      onInteraction()
    },
    zoomstart() {
      setMenu(null)
      onInteraction()
    },
  })

  if (!menu) return null

  return (
    <div
      className="absolute z-[900] min-w-[180px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-sm shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="block w-full px-3.5 py-2 text-left text-[var(--color-ink)] hover:bg-[var(--color-panel-2)]"
        onMouseDown={(e) => {
          // Leaflet's own "click" listener sits on the map container between
          // this button and the document root, so it fires (and closes the
          // menu) before a React onClick handler here ever runs. Stopping
          // propagation on mousedown keeps the event from reaching it.
          e.stopPropagation()
          e.preventDefault()
          onCreateAt(menu.lat, menu.lon)
          setMenu(null)
        }}
      >
        Create intersection here
      </button>
    </div>
  )
}

function MarkerContextMenu({
  menu,
  onClose,
  onDelete,
}: {
  menu: MarkerMenuState
  onClose: () => void
  onDelete: (id: string, name: string) => void
}) {
  return (
    <div
      className="absolute z-[900] min-w-[180px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-sm shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="block w-full px-3.5 py-2 text-left text-[var(--color-offline)] hover:bg-[var(--color-panel-2)]"
        onMouseDown={(e) => {
          // Same propagation issue as MapContextMenu: stop the click from
          // reaching Leaflet's map click listener before it closes the menu.
          e.stopPropagation()
          e.preventDefault()
          onDelete(menu.id, menu.name)
          onClose()
        }}
      >
        Delete intersection
      </button>
    </div>
  )
}

const DROP_PIN_ICON = divIcon({
  className: '',
  iconSize: [36, 42],
  iconAnchor: [18, 40],
  html: `
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C7.6 2 4 5.6 4 10c0 5.6 6.8 11.2 7.1 11.4a1.5 1.5 0 0 0 1.8 0C13.2 21.2 20 15.6 20 10c0-4.4-3.6-8-8-8Z"
        fill="var(--color-accent)"
        stroke="#0d141e"
        stroke-width="1.5"
      />
      <circle cx="12" cy="10" r="3" fill="#0d141e" />
    </svg>`,
})

/* Drop a pin: as soon as pick mode starts, a ghost pin tracks the cursor
   over the map. Clicking drops it as a real marker at that spot, which the
   user can then drag to fine-tune before confirming. */
function DropPin({
  onConfirm,
  onCancel,
}: {
  onConfirm: (lat: number, lon: number) => void
  onCancel: () => void
}) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [placed, setPlaced] = useState<{ lat: number; lng: number } | null>(null)

  useMapEvents({
    mousemove(e) {
      if (placed) return
      const point = e.containerPoint
      setHover({ x: point.x, y: point.y })
    },
    mouseout() {
      setHover(null)
    },
    click(e) {
      if (placed) return
      setPlaced({ lat: e.latlng.lat, lng: e.latlng.lng })
      setHover(null)
    },
  })

  return (
    <>
      {!placed && hover && (
        <div
          className="pointer-events-none absolute z-[850]"
          style={{ left: hover.x, top: hover.y, transform: 'translate(-18px, -40px)' }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" opacity={0.85}>
            <path
              d="M12 2C7.6 2 4 5.6 4 10c0 5.6 6.8 11.2 7.1 11.4a1.5 1.5 0 0 0 1.8 0C13.2 21.2 20 15.6 20 10c0-4.4-3.6-8-8-8Z"
              fill="var(--color-accent)"
              stroke="#0d141e"
              strokeWidth="1.5"
            />
            <circle cx="12" cy="10" r="3" fill="#0d141e" />
          </svg>
        </div>
      )}
      {placed && (
        <Marker
          position={placed}
          icon={DROP_PIN_ICON}
          draggable
          eventHandlers={{
            dragend: (e) => setPlaced(e.target.getLatLng()),
          }}
        />
      )}
      <div className="absolute inset-x-0 top-3 z-[900] flex justify-center">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-3 py-2 text-xs shadow-xl">
          <span className="text-[var(--color-ink-2)]">
            {placed ? 'Drag the pin to fine-tune it' : 'Click the map to drop the pin'}
          </span>
          {placed && (
            <button
              type="button"
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-semibold text-black hover:brightness-110"
              onClick={() => onConfirm(placed.lat, placed.lng)}
            >
              Place pin here
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-[var(--color-line-strong)] px-3 py-1.5 font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

/* Own component so useMemo can keep the same divIcon instance between
   snapshots. Snapshots stream several times a second per intersection, and
   react-leaflet calls marker.setIcon() (a full DOM teardown/rebuild of the
   marker) whenever the icon prop is a new object. Same fix and reasoning as
   MovementMarker in IntersectionMiniMap: only rebuild the icon when
   something it actually renders has changed. */
function SignalMarker({
  info,
  snap,
  selected,
  pickMode,
  onSelect,
  onMenu,
}: {
  info: IntersectionInfo
  snap: Snapshot | undefined
  selected: boolean
  pickMode: boolean
  onSelect: (id: string) => void
  onMenu: (menu: MarkerMenuState) => void
}) {
  /* Everything markerHtml draws from the snapshot: the 8 lamp dots and the
     green-phase list under the name. */
  const signals = snap?.phases.map((p) => p.signal).join() ?? ''
  const icon = useMemo(
    () =>
      divIcon({
        className: '',
        iconSize: [120, 64],
        iconAnchor: [60, 32],
        html: markerHtml(info, snap, selected),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info.name, info.connection, selected, signals],
  )

  return (
    <Marker
      position={[info.lat!, info.lon!]}
      icon={icon}
      eventHandlers={{
        click: () => (pickMode ? undefined : onSelect(info.id)),
        contextmenu: (e) => {
          if (pickMode) return
          e.originalEvent.preventDefault()
          e.originalEvent.stopPropagation()
          onMenu({
            x: e.containerPoint.x,
            y: e.containerPoint.y,
            id: info.id,
            name: info.name,
          })
        },
      }}
    />
  )
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
  onCreateAt: (lat: number, lon: number) => void
  onDeleteIntersection: (id: string, name: string) => void
  pickMode?: boolean
  onPick?: (lat: number, lon: number) => void
  onCancelPick?: () => void
}) {
  const {
    stream,
    selected,
    onSelect,
    onCreateAt,
    onDeleteIntersection,
    pickMode,
    onPick,
    onCancelPick,
  } = props
  const located = stream.intersections.filter(
    (i) => i.lat != null && i.lon != null,
  )
  const points = located.map((i) => [i.lat!, i.lon!] as [number, number])
  const center: [number, number] = points[0] ?? [40.75, -73.99]
  const [markerMenu, setMarkerMenu] = useState<MarkerMenuState | null>(null)

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
      <MapContextMenu
        onCreateAt={onCreateAt}
        disabled={pickMode}
        onInteraction={() => setMarkerMenu(null)}
      />
      {markerMenu && (
        <MarkerContextMenu
          menu={markerMenu}
          onClose={() => setMarkerMenu(null)}
          onDelete={onDeleteIntersection}
        />
      )}
      {pickMode && onPick && (
        <DropPin onConfirm={onPick} onCancel={() => onCancelPick?.()} />
      )}
      {located.map((ix) => (
        <SignalMarker
          key={ix.id}
          info={ix}
          snap={stream.snapshots[ix.id]}
          selected={selected === ix.id}
          pickMode={!!pickMode}
          onSelect={onSelect}
          onMenu={setMarkerMenu}
        />
      ))}
    </MapContainer>
  )
}
