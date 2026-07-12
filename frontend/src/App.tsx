import { useEffect, useState } from 'react'
import { DetailDrawer } from './components/DetailDrawer'
import { draftFromInfo, IntersectionEditor, type EditorTarget } from './components/IntersectionEditor'
import { SignalMap } from './components/SignalMap'
import { TopBar } from './components/TopBar'
import { useAtmsStream } from './lib/stream'

export function App() {
  const stream = useAtmsStream()
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [picking, setPicking] = useState(false)

  // Close the drawer if the selected intersection disappears from the stream.
  useEffect(() => {
    if (selected && !stream.intersections.some((i) => i.id === selected)) {
      setSelected(null)
    }
  }, [selected, stream.intersections])

  const backendDown = !stream.wsConnected

  return (
    <div className="flex h-full flex-col">
      <TopBar
        stream={stream}
        onAddIntersection={() => {
          setPicking(false)
          setEditor({
            mode: 'create',
            name: '',
            host: '',
            port: 161,
            device_type: 'maxtime',
            lat: null,
            lon: null,
          })
        }}
      />

      {backendDown && (
        <div className="z-[1000] bg-[var(--color-offline)] px-4 py-1.5 text-center text-xs font-semibold text-white">
          Backend link lost. Reconnecting...
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <SignalMap
            stream={stream}
            selected={selected}
            onSelect={setSelected}
            onCreateAt={(lat, lon) => {
              setSelected(null)
              setEditor({
                mode: 'create',
                name: '',
                host: '',
                port: 161,
                device_type: 'maxtime',
                lat,
                lon,
              })
            }}
            pickMode={picking}
            onPick={(lat, lon) => {
              setPicking(false)
              setEditor((e) => (e ? { ...e, lat, lon } : e))
            }}
            onCancelPick={() => setPicking(false)}
          />
          {stream.wsConnected && stream.intersections.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[var(--color-ink-3)]">
              No intersections yet. Right-click the map to add one.
            </div>
          )}

          {/* Map legend, bottom-center, so status reads without opening anything. */}
          {stream.intersections.length > 0 && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-[500] flex -translate-x-1/2 flex-col gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]/90 px-3 py-2 text-[11px] text-[var(--color-ink-2)] backdrop-blur">
              <Legend
                color="var(--color-online)"
                label="Online"
                count={
                  stream.intersections.filter(
                    (i) => i.connection === 'connected' || i.connection === 'degraded',
                  ).length
                }
              />
              <Legend
                color="var(--color-offline)"
                label="Offline"
                count={
                  stream.intersections.filter(
                    (i) => i.connection === 'disconnected' || i.connection === 'unsupported',
                  ).length
                }
              />
              <div className="mt-1 text-[10px] text-[var(--color-ink-3)]">
                Click a signal for detail
              </div>
            </div>
          )}
        </div>

        {editor ? (
          <div className="absolute inset-y-0 right-0 z-[600] sm:relative">
            <IntersectionEditor
              target={editor}
              onClose={() => {
                setPicking(false)
                setEditor(null)
              }}
              onSaved={() => {
                setPicking(false)
                setEditor(null)
              }}
              onPickLocation={() => setPicking(true)}
              picking={picking}
            />
          </div>
        ) : (
          selected && (
            <div className="absolute inset-y-0 right-0 z-[600] sm:relative">
              <DetailDrawer
                stream={stream}
                id={selected}
                onClose={() => setSelected(null)}
                onEdit={() => {
                  const info = stream.intersections.find((i) => i.id === selected)
                  if (info) setEditor(draftFromInfo(info))
                }}
              />
            </div>
          )
        )}
      </div>
    </div>
  )
}

function Legend({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span>
        {label} <span className="text-[var(--color-ink-3)]">({count})</span>
      </span>
    </div>
  )
}
