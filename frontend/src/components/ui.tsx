import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { Connection } from '../types'

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm',
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

export function CardHeader(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3',
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

const CONNECTION_STYLES: Record<Connection, string> = {
  connected: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  degraded: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  disconnected: 'bg-red-500/15 text-red-400 border-red-500/30',
  unsupported: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

export function ConnectionBadge(props: { state: Connection }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide',
        CONNECTION_STYLES[props.state],
      )}
    >
      <span
        className={clsx('h-1.5 w-1.5 rounded-full', {
          'bg-emerald-400': props.state === 'connected',
          'bg-amber-400 animate-pulse': props.state === 'degraded',
          'bg-red-400 animate-pulse': props.state === 'disconnected',
        })}
      />
      {props.state}
    </span>
  )
}

export function TabButton(props: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={props.onClick}
      className={clsx(
        'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
        props.active
          ? 'bg-slate-800 text-slate-100'
          : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
      )}
    >
      {props.children}
    </button>
  )
}
