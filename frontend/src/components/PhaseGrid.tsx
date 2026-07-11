import clsx from 'clsx'
import type { Phase, Snapshot } from '../types'

/* Signal head colors are domain-semantic (a red ball is red), deliberately
   not palette-abstracted. */
const LAMP: Record<Phase['signal'], string> = {
  red: 'bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.55)]',
  yellow: 'bg-amber-400 shadow-[0_0_12px_2px_rgba(251,191,36,0.55)]',
  green: 'bg-emerald-500 shadow-[0_0_12px_2px_rgba(16,185,129,0.55)]',
  dark: 'bg-slate-700',
}

const PED_LABEL: Record<Phase['ped'], { text: string; cls: string }> = {
  walk: { text: 'WALK', cls: 'text-emerald-400' },
  ped_clear: { text: 'FDW', cls: 'text-amber-400' },
  dont_walk: { text: 'DW', cls: 'text-slate-500' },
  dark: { text: '', cls: 'text-slate-700' },
}

function PhaseTile({ p }: { p: Phase }) {
  const dark = p.signal === 'dark'
  return (
    <div
      className={clsx(
        'relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5',
        dark
          ? 'border-slate-800/60 bg-slate-900/30 opacity-45'
          : 'border-slate-800 bg-slate-900/70',
      )}
    >
      {p.next && (
        <span className="absolute -top-2 rounded-full bg-sky-500/90 px-1.5 text-[10px] font-bold text-white">
          NEXT
        </span>
      )}
      <span className="text-xs font-semibold text-slate-400">
        {'Φ'}{p.phase}
      </span>
      <span className={clsx('h-5 w-5 rounded-full', LAMP[p.signal])} />
      <span className={clsx('h-3 text-[10px] font-bold', PED_LABEL[p.ped].cls)}>
        {PED_LABEL[p.ped].text}
      </span>
      <div className="flex h-4 gap-1">
        {p.veh_call && (
          <span className="rounded bg-sky-500/20 px-1 text-[10px] font-bold text-sky-400">
            V
          </span>
        )}
        {p.ped_call && (
          <span className="rounded bg-violet-500/20 px-1 text-[10px] font-bold text-violet-400">
            P
          </span>
        )}
      </div>
    </div>
  )
}

export function PhaseGrid({ snapshot }: { snapshot: Snapshot }) {
  const active = snapshot.phases.filter((p) => p.signal !== 'dark')
  const shown =
    active.length > 0 ? snapshot.phases.slice(0, Math.max(8, active.length)) : snapshot.phases.slice(0, 8)
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
      {shown.map((p) => (
        <PhaseTile key={p.phase} p={p} />
      ))}
    </div>
  )
}
