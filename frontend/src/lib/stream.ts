import { useEffect, useRef, useState } from 'react'
import type { AtmsEvent, Connection, IntersectionInfo, Snapshot } from '../types'

export interface StreamState {
  wsConnected: boolean
  intersections: IntersectionInfo[]
  snapshots: Record<string, Snapshot>
  events: AtmsEvent[]
  latencyHistory: Record<string, number[]>
}

const EMPTY: StreamState = {
  wsConnected: false,
  intersections: [],
  snapshots: {},
  events: [],
  latencyHistory: {},
}

const CONNECTION_EVENTS: Record<string, Connection> = {
  connected: 'connected',
  reconnected: 'connected',
  degraded: 'degraded',
  disconnected: 'disconnected',
}

export function useAtmsStream(): StreamState {
  const [state, setState] = useState<StreamState>(EMPTY)
  const retries = useRef(0)

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let timer: number | undefined

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)

      ws.onopen = () => {
        retries.current = 0
        setState((s) => ({ ...s, wsConnected: true }))
      }

      ws.onmessage = (msg) => {
        const m = JSON.parse(msg.data)
        if (m.type === 'hello') {
          setState((s) => ({
            ...s,
            intersections: m.intersections,
            snapshots: { ...s.snapshots, ...m.snapshots },
            events: m.events ?? s.events,
          }))
        } else if (m.type === 'snapshot') {
          const snap: Snapshot = m.data
          setState((s) => {
            const history = s.latencyHistory[snap.intersection_id] ?? []
            return {
              ...s,
              snapshots: { ...s.snapshots, [snap.intersection_id]: snap },
              intersections: s.intersections.map((i) =>
                i.id === snap.intersection_id
                  ? { ...i, connection: 'connected' }
                  : i,
              ),
              latencyHistory: {
                ...s.latencyHistory,
                [snap.intersection_id]: [
                  ...history.slice(-119),
                  snap.poll_latency_ms,
                ],
              },
            }
          })
        } else if (m.type === 'event') {
          const ev: AtmsEvent = m.data
          const conn = CONNECTION_EVENTS[ev.kind]
          setState((s) => ({
            ...s,
            events: [...s.events.slice(-199), ev],
            intersections: conn
              ? s.intersections.map((i) =>
                  i.id === ev.intersection_id ? { ...i, connection: conn } : i,
                )
              : s.intersections,
          }))
        }
      }

      ws.onclose = () => {
        setState((s) => ({ ...s, wsConnected: false }))
        if (!closed) {
          const delay = Math.min(500 * 2 ** retries.current, 8000)
          retries.current += 1
          timer = window.setTimeout(connect, delay)
        }
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed = true
      if (timer) window.clearTimeout(timer)
      ws?.close()
    }
  }, [])

  return state
}
