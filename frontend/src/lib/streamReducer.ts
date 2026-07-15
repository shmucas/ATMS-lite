import type { AtmsEvent, Connection, IntersectionInfo, Snapshot } from '../types'

export interface ControlState {
  armed: boolean
  armed_until: string | null
  veh_calls: Record<string, number>
  ped_calls: Record<string, number>
  holds: Record<string, number>
  omits: Record<string, number>
  force_offs: Record<string, number>
  forced_phase: number | null
}

export interface StreamState {
  wsConnected: boolean
  intersections: IntersectionInfo[]
  snapshots: Record<string, Snapshot>
  events: AtmsEvent[]
  latencyHistory: Record<string, number[]>
  control: Record<string, ControlState>
}

export const EMPTY: StreamState = {
  wsConnected: false,
  intersections: [],
  snapshots: {},
  events: [],
  latencyHistory: {},
  control: {},
}

const CONNECTION_EVENTS: Record<string, Connection> = {
  connected: 'connected',
  reconnected: 'connected',
  degraded: 'degraded',
  disconnected: 'disconnected',
}

const LATENCY_WINDOW = 120
const EVENT_WINDOW = 200

export interface StreamMessage {
  type: string
  data?: unknown
  intersections?: IntersectionInfo[]
  snapshots?: Record<string, Snapshot>
  events?: AtmsEvent[]
  control?: Record<string, ControlState>
}

/* Pure state transition for one WebSocket message. Kept out of the hook so
   it can be unit-tested without a socket or React. */
export function applyMessage(s: StreamState, m: StreamMessage): StreamState {
  switch (m.type) {
    case 'hello':
      return {
        ...s,
        intersections: m.intersections ?? [],
        snapshots: { ...s.snapshots, ...m.snapshots },
        events: m.events ?? s.events,
        control: { ...s.control, ...(m.control ?? {}) },
      }
    case 'snapshot': {
      const snap = m.data as Snapshot
      const history = s.latencyHistory[snap.intersection_id] ?? []
      return {
        ...s,
        snapshots: { ...s.snapshots, [snap.intersection_id]: snap },
        intersections: s.intersections.map((i) =>
          i.id === snap.intersection_id ? { ...i, connection: 'connected' } : i,
        ),
        latencyHistory: {
          ...s.latencyHistory,
          [snap.intersection_id]: [
            ...history.slice(-(LATENCY_WINDOW - 1)),
            snap.poll_latency_ms,
          ],
        },
      }
    }
    case 'control': {
      const { intersection_id, ...rest } = m.data as ControlState & {
        intersection_id: string
      }
      return {
        ...s,
        control: { ...s.control, [intersection_id]: rest as ControlState },
      }
    }
    case 'intersection_added': {
      const info = m.data as IntersectionInfo
      return {
        ...s,
        intersections: s.intersections.some((i) => i.id === info.id)
          ? s.intersections.map((i) => (i.id === info.id ? info : i))
          : [...s.intersections, info],
      }
    }
    case 'intersection_updated': {
      const info = m.data as IntersectionInfo
      return {
        ...s,
        intersections: s.intersections.map((i) => (i.id === info.id ? info : i)),
      }
    }
    case 'intersection_removed': {
      const { id } = m.data as { id: string }
      return {
        ...s,
        intersections: s.intersections.filter((i) => i.id !== id),
      }
    }
    case 'event': {
      const ev = m.data as AtmsEvent
      const conn = CONNECTION_EVENTS[ev.kind]
      return {
        ...s,
        events: [...s.events.slice(-(EVENT_WINDOW - 1)), ev],
        intersections: conn
          ? s.intersections.map((i) =>
              i.id === ev.intersection_id ? { ...i, connection: conn } : i,
            )
          : s.intersections,
      }
    }
    default:
      return s
  }
}
