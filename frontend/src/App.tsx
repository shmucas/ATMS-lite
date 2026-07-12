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

          {/* Map legend, bottom-left, so status reads without opening anything. */}
          {stream.intersections.length > 0 && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-[500] flex flex-col gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]/90 px-3 py-2 text-[11px] text-[var(--color-ink-2)] backdrop-blur">
              <div className="mb-0.5 font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Comms
              </div>
              <Legend color="var(--color-online)" label="Online" />
              <Legend color="var(--color-degraded)" label="Degraded" />
              <Legend color="var(--color-offline)" label="Offline" />
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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  )
}
