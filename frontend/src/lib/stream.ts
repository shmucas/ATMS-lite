import { useEffect, useRef, useState } from 'react'
import { applyMessage, EMPTY, type StreamMessage, type StreamState } from './streamReducer'

export type { ControlState, StreamState } from './streamReducer'

/* Messages arrive at N intersections x 5 Hz; rendering each one re-renders
   the whole app. Buffer them and apply the batch in one state update per
   window instead. */
const FLUSH_MS = 100

export function useAtmsStream(): StreamState {
  const [state, setState] = useState<StreamState>(EMPTY)
  const retries = useRef(0)

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let timer: number | undefined
    let flushTimer: number | undefined
    let pending: StreamMessage[] = []

    const flush = () => {
      flushTimer = undefined
      const batch = pending
      pending = []
      setState((s) => batch.reduce(applyMessage, s))
    }

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)

      ws.onopen = () => {
        retries.current = 0
        setState((s) => ({ ...s, wsConnected: true }))
      }

      ws.onmessage = (msg) => {
        pending.push(JSON.parse(msg.data))
        if (flushTimer === undefined) {
          flushTimer = window.setTimeout(flush, FLUSH_MS)
        }
      }

      ws.onclose = () => {
        if (flushTimer !== undefined) {
          window.clearTimeout(flushTimer)
          flush()
        }
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
      if (flushTimer !== undefined) window.clearTimeout(flushTimer)
      ws?.close()
    }
  }, [])

  return state
}
