import { useEffect, useState } from 'react'
import { intersectionsApi, type HiresEvent } from './intersections'

const REFRESH_MS = 5000

/* Fetch the hi-res event window for one intersection and keep it fresh on a
   timer. Shared by every ATSPM report so the polling/error handling lives in
   one place. */
export function useHiresEvents(id: string, start: string, end: string, minutes: number) {
  const [events, setEvents] = useState<HiresEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        const rows = await intersectionsApi.hires(id, {
          start,
          end,
          limit: Math.min(10000, minutes * 200),
        })
        if (stopped) return
        setEvents(rows)
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
  }, [id, start, end, minutes])

  return { events, error }
}
