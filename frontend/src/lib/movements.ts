import type { Approach, LaneKind, Movement, Signal, Snapshot } from '../types'

export const APPROACH_LABEL: Record<Approach, string> = {
  NB: 'Northbound',
  SB: 'Southbound',
  EB: 'Eastbound',
  WB: 'Westbound',
}

export const LANE_LABEL: Record<LaneKind, string> = {
  left: 'Left',
  through: 'Through',
  right: 'Right',
}

/* Direction of travel through the intersection, compass degrees (0 = N). */
const APPROACH_HEADING: Record<Approach, number> = { NB: 0, EB: 90, SB: 180, WB: 270 }

/* Where an approach's arrows sit relative to the intersection center, i.e.
   upstream of the stop bar - the opposite side from the heading. */
const APPROACH_PLACEMENT_BEARING: Record<Approach, number> = { NB: 180, SB: 0, EB: 270, WB: 90 }

/* Standard NEMA 8-phase ring-and-barrier assignment: 1/2/5/6 on one barrier
   pair (SB left/NB through/NB left/SB through), 3/4/7/8 on the other
   (WB left/EB through/EB left/WB through). Right turns run permissively
   with the through phase unless a movement is left-turn-only. */
const APPROACH_PHASE: Record<Approach, { left: number; through: number }> = {
  NB: { left: 5, through: 2 },
  SB: { left: 1, through: 6 },
  EB: { left: 7, through: 4 },
  WB: { left: 3, through: 8 },
}

const M_PER_DEG_LAT = 111320

function offset(lat: number, lon: number, bearingDeg: number, meters: number) {
  const b = (bearingDeg * Math.PI) / 180
  const dLat = (meters * Math.cos(b)) / M_PER_DEG_LAT
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
  const dLon = (meters * Math.sin(b)) / mPerDegLon
  return { lat: lat + dLat, lon: lon + dLon }
}

function isLeftOnly(lanes: LaneKind[]) {
  return lanes.includes('left') && !lanes.includes('through') && !lanes.includes('right')
}

export function suggestPhase(approach: Approach, lanes: LaneKind[]): number {
  const table = APPROACH_PHASE[approach]
  return isLeftOnly(lanes) ? table.left : table.through
}

/* Places a new movement's arrow ~30m upstream of the intersection on its
   approach leg, nudged toward the driver's left (left-turn lanes) or right
   (through/right lanes) so the two don't overlap. Purely a starting point -
   the user drags it from there. */
export function defaultMovementPosition(
  baseLat: number,
  baseLon: number,
  approach: Approach,
  lanes: LaneKind[],
) {
  const heading = APPROACH_HEADING[approach]
  const approachPoint = offset(baseLat, baseLon, APPROACH_PLACEMENT_BEARING[approach], 30)
  const lateralBearing = (heading + (isLeftOnly(lanes) ? -90 : 90) + 360) % 360
  const placed = offset(approachPoint.lat, approachPoint.lon, lateralBearing, 3.5)
  return { lat: placed.lat, lon: placed.lon, heading }
}

export function defaultHeading(approach: Approach): number {
  return APPROACH_HEADING[approach]
}

export function newMovementId(existing: Movement[]): string {
  const ids = new Set(existing.map((m) => m.id))
  let n = existing.length + 1
  while (ids.has(`movement-${n}`)) n++
  return `movement-${n}`
}

const SIGNAL_HEX: Record<Signal, string> = {
  green: '#10d982',
  yellow: '#f5c518',
  red: '#ff5a5a',
  dark: '#3a4a5f',
}

const UNKNOWN_COLOR = '#5a6b82'

export function movementColor(snapshot: Snapshot | undefined, phase: number): string {
  const p = snapshot?.phases.find((ph) => ph.phase === phase)
  return p ? SIGNAL_HEX[p.signal] : UNKNOWN_COLOR
}

/* Arrow glyphs: a stroked shaft plus a filled arrowhead, drawn pointing
   "up" (north) in a 24x34 box. The whole marker is rotated by the
   movement's heading, so turn glyphs stay correct relative to travel
   direction (left bends toward -x, i.e. the driver's left). */
const LANE_GEOM: Record<LaneKind, { shaft: string; head: string }> = {
  through: { shaft: 'M12,32 L12,12', head: '12,3 6,13 18,13' },
  left: { shaft: 'M15,32 L15,18 C15,10 10,7 5,7', head: '1,7 9,2 9,13' },
  right: { shaft: 'M9,32 L9,18 C9,10 14,7 19,7', head: '23,7 15,2 15,13' },
}

function laneSvg(kind: LaneKind, color: string): string {
  const { shaft, head } = LANE_GEOM[kind]
  return `<svg viewBox="0 0 24 34" width="26" height="37" style="display:block">
    <path d="${shaft}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    <polygon points="${head}" fill="${color}" />
  </svg>`
}

/* Must match IntersectionMiniMap's ICON_BOX, which sizes the Leaflet
   marker (iconSize/iconAnchor) that wraps this html. */
const ICON_BOX = 92

export function movementIconHtml(movement: Movement, color: string, selected?: boolean): string {
  const lanes = movement.lanes.map((k) => laneSvg(k, color)).join('')
  return `
    <div style="width:${ICON_BOX}px;height:${ICON_BOX}px;display:flex;align-items:center;justify-content:center">
      <div style="transform:rotate(${movement.heading}deg);display:flex;align-items:flex-end;gap:3px;
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.9)) drop-shadow(0 0 5px ${color}88);
        ${selected ? `padding:4px;outline:2px dashed #fff;outline-offset:2px;border-radius:6px;` : ''}">
        ${lanes}
      </div>
    </div>`
}
