import { useState } from 'react'
import { ConnectionBanner } from './components/ConnectionBanner'
import { CoordMonitor } from './components/CoordMonitor'
import { Health } from './components/Health'
import { MapView } from './components/MapView'
import { RingDiagram } from './components/RingDiagram'
import { Card, CardHeader, ConnectionBadge, TabButton } from './components/ui'
import { useAtmsStream } from './lib/stream'

type Tab = 'overview' | 'map' | 'health'

function uptimeText(ticks?: number) {
  if (ticks == null) return '--'
  const s = Math.floor(ticks / 100)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export function App() {
  const stream = useAtmsStream()
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="min-h-screen">
      <ConnectionBanner state={stream} />
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight text-slate-100">
            ATMS<span className="text-sky-400">-lite</span>
          </h1>
          <span className="text-xs text-slate-500">
            NTCIP traffic management
          </span>
        </div>
        <nav className="flex gap-1">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
            Overview
          </TabButton>
          <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
            Map
          </TabButton>
          <TabButton active={tab === 'health'} onClick={() => setTab('health')}>
            Health
          </TabButton>
        </nav>
        <span
          className={
            stream.wsConnected
              ? 'flex items-center gap-2 text-xs text-emerald-400'
              : 'flex items-center gap-2 text-xs text-red-400'
          }
        >
          <span
            className={
              stream.wsConnected
                ? 'h-2 w-2 rounded-full bg-emerald-400'
                : 'h-2 w-2 animate-pulse rounded-full bg-red-400'
            }
          />
          {stream.wsConnected ? 'live' : 'offline'}
        </span>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-5 py-5">
        {tab === 'overview' && (
          <>
            {stream.intersections.length === 0 && (
              <Card className="p-8 text-center text-slate-500">
                Waiting for the backend stream...
              </Card>
            )}
            {stream.intersections.map((ix) => {
              const snap = stream.snapshots[ix.id]
              return (
                <Card key={ix.id}>
                  <CardHeader>
                    <div className="flex items-baseline gap-3">
                      <h2 className="font-semibold text-slate-100">{ix.name}</h2>
                      <span className="text-xs text-slate-500">
                        {ix.static?.sys_descr}
                      </span>
                    </div>
                    <ConnectionBadge state={ix.connection} />
                  </CardHeader>
                  <div className="space-y-4 px-4 py-4">
                    {snap ? (
                      <>
                        <RingDiagram snapshot={snap} info={ix} />
                        <CoordMonitor snapshot={snap} />
                        <div className="tabular flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                          <span>seq {snap.seq}</span>
                          <span>poll {snap.poll_latency_ms} ms</span>
                          <span>uptime {uptimeText(snap.uptime_ticks)}</span>
                          <span>
                            {ix.static?.polled_phases ?? 8} of{' '}
                            {ix.static?.controller_max_phases ?? '?'} phases polled
                          </span>
                          <span>{snap.ts}</span>
                        </div>
                      </>
                    ) : (
                      <div className="py-6 text-center text-sm text-slate-500">
                        No data yet from this controller.
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </>
        )}
        {tab === 'map' && <MapView stream={stream} />}
        {tab === 'health' && <Health stream={stream} />}
      </main>
    </div>
  )
}
