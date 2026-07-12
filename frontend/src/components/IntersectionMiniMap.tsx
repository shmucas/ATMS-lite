import 'leaflet/dist/leaflet.css'
import { divIcon } from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { movementColor, movementIconHtml } from '../lib/movements'
import type { Movement, Snapshot } from '../types'

/* Satellite imagery, not the street basemap used on the overview map: lane
   arrows need to be lined up against real pavement, which street tiles
   don't render at any zoom. Esri World Imagery is free and keyless. */
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS community'

/* This map mounts inside a drawer panel that's still being laid out on the
   same tick Leaflet measures its container, so it can init at zero size
   and never draw a tile. Re-measuring one frame later fixes it. */
function InvalidateOnMount() {
  const map = useMap()
  useEffect(() => {
    const id = requestAnimationFrame(() => map.invalidateSize())
    return () => cancelAnimationFrame(id)
  }, [map])
  return null
}

const ICON_BOX = 92

/* Own component (not inlined in a .map()) so useMemo can keep the same
   divIcon instance across re-renders. The snapshot streams at ~5Hz, and
   react-leaflet calls marker.setIcon() whenever the icon prop is a new
   object - which tears down and rebuilds Leaflet's drag handler. Doing
   that while the user has the marker mid-drag corrupts the handler and
   crashes the app (Leaflet's finishDrag touching a detached node). Only
   rebuild the icon when something it actually renders has changed. */
function MovementMarker({
  movement,
  color,
  editable,
  onDrag,
}: {
  movement: Movement
  color: string
  editable: boolean
  onDrag?: (movementId: string, lat: number, lon: number) => void
}) {
  const icon = useMemo(
    () =>
      divIcon({
        className: '',
        iconSize: [ICON_BOX, ICON_BOX],
        iconAnchor: [ICON_BOX / 2, ICON_BOX / 2],
        html: movementIconHtml(movement, color, editable),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movement.lanes.join(','), movement.heading, color, editable],
  )

  return (
    <Marker
      position={[movement.lat, movement.lon]}
      draggable={editable}
      icon={icon}
      eventHandlers={
        editable
          ? {
              dragend: (e) => {
                const pos = e.target.getLatLng()
                onDrag?.(movement.id, pos.lat, pos.lng)
              },
            }
          : {}
      }
    />
  )
}

export function IntersectionMiniMap(props: {
  lat: number
  lon: number
  movements: Movement[]
  snapshot?: Snapshot
  editable?: boolean
  onDragMovement?: (movementId: string, lat: number, lon: number) => void
}) {
  const { lat, lon, movements, snapshot, editable, onDragMovement } = props

  return (
    <div className="h-56 w-full overflow-hidden rounded-lg border border-[var(--color-line)]">
      <MapContainer
        key={`${lat},${lon}`}
        center={[lat, lon]}
        zoom={19}
        minZoom={15}
        maxZoom={21}
        zoomControl
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        {/* Esri's own tile layer defaults to maxZoom 18, one below our
            initial zoom of 19 - GridLayer silently draws nothing past its
            maxZoom, so this must be set here too, not just on the map. */}
        <TileLayer
          attribution={SATELLITE_ATTRIBUTION}
          url={SATELLITE_URL}
          maxZoom={21}
          maxNativeZoom={19}
        />
        <InvalidateOnMount />
        {movements.map((m) => (
          <MovementMarker
            key={m.id}
            movement={m}
            color={movementColor(snapshot, m.phase)}
            editable={!!editable}
            onDrag={onDragMovement}
          />
        ))}
      </MapContainer>
    </div>
  )
}
