import clsx from 'clsx'
import { useEffect, useState } from 'react'
import type { StreamState } from '../lib/stream'

type Tab = 'events' | 'audit'

interface AuditRecord {
  ts: string
  intersection_id: string
  actor: string
  action: string
  detail?: string
  reason?: string
  oid?: string
  mask?: number
  error?: string
}

const EVENT_STYLE: Record<string, { bg: string; fg: string }> = {
  disconnected: { bg: 'var(--color-offline)', fg: 'var(--color-offline)' },
  degraded: { bg: 'var(--color-degraded)', fg: 'var(--color-degraded)' },
  connected: { bg: 'var(--color-online)', fg: 'var(--color-online)' },
  reconnected: { bg: 'var(--color-online)', fg: 'var(--color-online)' },
  // Audit actions
  arm: { bg: 'var(--color-degraded)', fg: 'var(--color-degraded)' },
  'auto-disarm': { bg: 'var(--color-degraded)', fg: 'var(--color-degraded)' },
  'write-failed': { bg: 'var(--color-offline)', fg: 'var(--color-offline)' },
}

function KindChip({ kind }: { kind: string }) {
  const style = EVENT_STYLE[kind]
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={
        style
          ? {
              background: `color-mix(in srgb, ${style.bg} 15%, transparent)`,
              color: style.fg,
            }
          : { background: 'var(--color-panel-2)', color: 'var(--color-ink-2)' }
      }
    >
      {kind}
    </span>
  )
}

function timeOf(ts: string) {
  return ts.slice(11, 19)
}

function dayOf(ts: string) {
  return ts.slice(0, 10)
}

/* Timestamps are ISO UTC; show a date prefix only when the entry is not
   from today so the common case stays compact. */
function when(ts: string) {
  const today = new Date().toISOString().slice(0, 10)
  return dayOf(ts) === today ? timeOf(ts) : `${dayOf(ts).slice(5)} ${timeOf(ts)}`
}

export function ActivityDrawer(props: {
  stream: StreamState
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const { stream, onClose, onSelect } = props
  const [tab, setTab] = useState<Tab>('events')
  const [audit, setAudit] = useState<AuditRecord[] | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)

  const nameOf = (id: string) =>
    stream.intersections.find((i) => i.id === id)?.name ?? id

  // The audit log is REST, not part of the stream: fetch on open and keep
  // it fresh while the tab is visible.
  useEffect(() => {
    if (tab !== 'audit') return
    let stop = false
    const load = () =>
      fetch('/api/audit?limit=100')
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((records: AuditRecord[]) => {
          if (!stop) {
            setAudit(records)
            setAuditError(null)
          }
        })
        .catch((e) => {
          if (!stop) setAuditError(e instanceof Error ? e.message : String(e))
        })
    load()
    const t = window.setInterval(load, 5000)
    return () => {
      stop = true
      window.clearInterval(t)
    }
  }, [tab])

  const events = [...stream.events].reverse()
  const auditRows = audit ? [...audit].reverse() : null

  return (
    <aside className="flex h-full w-full flex-col border-r border-[var(--color-line)] bg-[var(--color-panel)] sm:w-[400px]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="text-base font-bold text-[var(--color-ink)]">Activity</h2>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-[var(--color-ink-3)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-line)] px-3 pt-2">
        {(
          [
            { id: 'events', label: 'Events' },
            { id: 'audit', label: 'Control audit' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-ink)]'
                : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-3">
        {tab === 'events' &&
          (events.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--color-ink-3)]">
              No events yet this session.
            </div>
          ) : (
            <div className="space-y-0.5">
              {events.map((e, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelect(e.intersection_id)}
                  className="block w-full rounded-md border-b border-[var(--color-line)] px-1.5 py-1.5 text-left text-xs last:border-0 hover:bg-[var(--color-panel-2)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="tabular w-24 shrink-0 text-[var(--color-ink-3)]">
                      {when(e.ts)}
                    </span>
                    <KindChip kind={e.kind} />
                    <span className="truncate font-medium text-[var(--color-ink-2)]">
                      {nameOf(e.intersection_id)}
                    </span>
                  </div>
                  {e.detail && (
                    <div className="mt-0.5 pl-26 text-[11px] text-[var(--color-ink-3)]">
                      {e.detail}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}

        {tab === 'audit' && (
          <>
            {auditError && (
              <div className="mb-2 rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-xs text-[var(--color-offline)]">
                Could not load the audit log: {auditError}
              </div>
            )}
            {auditRows == null && !auditError ? (
              <div className="py-8 text-center text-sm text-[var(--color-ink-3)]">
                Loading...
              </div>
            ) : auditRows != null && auditRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-ink-3)]">
                No control actions recorded.
              </div>
            ) : (
              <div className="space-y-0.5">
                {auditRows?.map((r, i) => (
                  <div
                    key={i}
                    className="border-b border-[var(--color-line)] px-1.5 py-1.5 text-xs last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="tabular w-24 shrink-0 text-[var(--color-ink-3)]">
                        {when(r.ts)}
                      </span>
                      <KindChip
                        kind={r.action}
                      />
                      <span className="truncate font-medium text-[var(--color-ink-2)]">
                        {nameOf(r.intersection_id)}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-[var(--color-ink-3)]">
                        {r.actor}
                      </span>
                    </div>
                    {(r.detail || r.reason || r.error) && (
                      <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
                        {r.detail ?? r.reason ?? r.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 text-[10px] text-[var(--color-ink-3)]">
              Last 100 entries, refreshed every 5s while open.
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
