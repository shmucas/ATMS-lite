import { useState } from 'react'
import { ConnectionBanner } from './components/ConnectionBanner'
import { Detectors } from './components/Detectors'
import { Health } from './components/Health'
import { IntersectionCard } from './components/IntersectionCard'
import { MapView } from './components/MapView'
import { Card, TabButton } from './components/ui'
import { useAtmsStream } from './lib/stream'

type Tab = 'overview' | 'map' | 'detectors' | 'health'

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
          <TabButton
            active={tab === 'detectors'}
            onClick={() => setTab('detectors')}
          >
            Detectors
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
            {stream.intersections.map((ix) => (
              <IntersectionCard
                key={ix.id}
                info={ix}
                snapshot={stream.snapshots[ix.id]}
                control={stream.control[ix.id]}
              />
            ))}
          </>
        )}
        {tab === 'map' && <MapView stream={stream} />}
        {tab === 'detectors' && <Detectors stream={stream} />}
        {tab === 'health' && <Health stream={stream} />}
      </main>
    </div>
  )
}
