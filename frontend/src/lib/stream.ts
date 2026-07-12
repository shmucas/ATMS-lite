import { useEffect, useRef, useState } from 'react'
import { applyMessage, EMPTY, type StreamState } from './streamReducer'

export type { ControlState, StreamState } from './streamReducer'

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
        setState((s) => applyMessage(s, m))
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
