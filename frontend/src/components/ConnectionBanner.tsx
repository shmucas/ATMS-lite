import type { StreamState } from '../lib/stream'

export function ConnectionBanner({ state }: { state: StreamState }) {
  if (!state.wsConnected) {
    return (
      <div className="bg-red-600/90 px-4 py-2 text-center text-sm font-semibold text-white">
        Backend link lost. Reconnecting...
      </div>
    )
  }
  const down = state.intersections.filter((i) => i.connection === 'disconnected')
  const shaky = state.intersections.filter((i) => i.connection === 'degraded')
  if (down.length > 0) {
    return (
      <div className="bg-red-600/90 px-4 py-2 text-center text-sm font-semibold text-white">
        Controller disconnected: {down.map((i) => i.name).join(', ')}. Retrying in the background.
      </div>
    )
  }
  if (shaky.length > 0) {
    return (
      <div className="bg-amber-500/90 px-4 py-2 text-center text-sm font-semibold text-slate-950">
        Degraded link: {shaky.map((i) => i.name).join(', ')}. Some polls are timing out.
      </div>
    )
  }
  return null
}
