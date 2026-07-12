import { useEffect, useState } from 'react'
import { intersectionsApi } from '../lib/intersections'
import type { DeviceType, IntersectionInfo } from '../types'

const DEVICE_LABEL: Record<DeviceType, string> = {
  maxtime: 'Q-Free MaxTime (NTCIP/SNMP)',
  econolite: 'Econolite',
  siemens: 'Siemens',
}

export interface EditorTarget {
  mode: 'create' | 'edit'
  id?: string
  name: string
  host: string
  port: number
  device_type: DeviceType
  lat: number | null
  lon: number | null
}

export function IntersectionEditor(props: {
  target: EditorTarget
  onClose: () => void
  onSaved: () => void
  onPickLocation: () => void
  picking?: boolean
}) {
  const { target, onClose, onSaved, onPickLocation, picking } = props
  const [name, setName] = useState(target.name)
  const [host, setHost] = useState(target.host)
  const [port, setPort] = useState(String(target.port || 161))
  const [deviceType, setDeviceType] = useState<DeviceType>(target.device_type)
  const [lat, setLat] = useState(target.lat)
  const [lon, setLon] = useState(target.lon)
  const [supported, setSupported] = useState<DeviceType[]>(['maxtime'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    intersectionsApi
      .deviceTypes()
      .then((d) => setSupported(d.supported))
      .catch(() => undefined)
  }, [])

  // Picking a location on the map updates target.lat/lon without remounting
  // the editor, so sync it here instead of via the initial useState above.
  useEffect(() => {
    setLat(target.lat)
    setLon(target.lon)
  }, [target.lat, target.lon])

  const save = async () => {
    if (!name.trim() || !host.trim()) {
      setError('Name and host/IP are required.')
      return
    }
    setBusy(true)
    setError(null)
    const draft = {
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 161,
      device_type: deviceType,
      lat,
      lon,
    }
    try {
      if (target.mode === 'create') {
        await intersectionsApi.create(draft)
      } else {
        await intersectionsApi.update(target.id!, draft)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (target.mode !== 'edit' || !target.id) return
    if (!window.confirm(`Remove ${name} from the network?`)) return
    setBusy(true)
    setError(null)
    try {
      await intersectionsApi.remove(target.id)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-[var(--color-line)] bg-[var(--color-panel)] sm:w-[380px]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="text-base font-bold text-[var(--color-ink)]">
          {target.mode === 'create' ? 'Create intersection' : 'Edit intersection'}
        </h2>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 text-[var(--color-ink-3)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Main St & 3rd Ave"
          />
        </Field>

        <Field label="Location">
          {picking ? (
            <div className="text-xs text-[var(--color-accent)]">
              Drag the pin on the map to position it, then confirm.
            </div>
          ) : (
            <div className="space-y-2">
              {lat != null && lon != null && (
                <div className="flex items-center justify-between text-xs text-[var(--color-ink-2)]">
                  <span className="tabular">
                    {lat.toFixed(5)}, {lon.toFixed(5)}
                  </span>
                  <button
                    type="button"
                    className="text-[var(--color-accent)] hover:underline"
                    onClick={() => {
                      setLat(null)
                      setLon(null)
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={onPickLocation}
                className="w-full rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
              >
                {lat != null && lon != null ? 'Re-pin on map' : 'Pin on map'}
              </button>
              {lat == null && lon == null && (
                <div className="text-xs text-[var(--color-ink-3)]">
                  Not pinned. Pin on the map, or leave unpinned to add it
                  off-map for now.
                </div>
              )}
            </div>
          )}
        </Field>

        <Field label="IP address / host">
          <input
            className="input"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="10.42.0.2"
          />
        </Field>

        <Field label="Port">
          <input
            className="input"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="161"
            inputMode="numeric"
          />
        </Field>

        <Field label="Device API">
          <select
            className="input"
            value={deviceType}
            onChange={(e) => {
              const v = e.target.value
              if (v.startsWith('docker:')) {
                const n = v.slice('docker:'.length)
                setHost(`emulator-${n}`)
                setPort('161')
                setDeviceType('maxtime')
                return
              }
              setDeviceType(v as DeviceType)
            }}
          >
            {(['maxtime', 'econolite', 'siemens'] as DeviceType[]).map((dt) => {
              const enabled = supported.includes(dt)
              return (
                <option key={dt} value={dt} disabled={!enabled}>
                  {DEVICE_LABEL[dt]}
                  {enabled ? '' : ' (coming soon)'}
                </option>
              )
            })}
            {target.mode === 'create' && (
              <optgroup label="Docker emulator (autofills host/port)">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={`docker:${n}`}>
                    docker-emulator-{n}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        {error && (
          <div className="rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-xs text-[var(--color-offline)]">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] p-3">
        {target.mode === 'edit' ? (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-offline)] hover:bg-[var(--color-offline)]/10 disabled:opacity-40"
          >
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40"
          >
            {target.mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </aside>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {props.label}
      </span>
      {props.children}
    </label>
  )
}

export function draftFromInfo(info: IntersectionInfo): EditorTarget {
  return {
    mode: 'edit',
    id: info.id,
    name: info.name,
    host: info.host ?? '',
    port: info.port ?? 161,
    device_type: info.device_type ?? 'maxtime',
    lat: info.lat,
    lon: info.lon,
  }
}
