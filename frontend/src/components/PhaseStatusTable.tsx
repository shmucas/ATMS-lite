import type { Phase, Snapshot } from '../types'

const FILL: Record<Phase['signal'], string> = {
  green: '#10d982',
  yellow: '#f5c518',
  red: '#ff5a5a',
  dark: '#2b3a4f',
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="mx-auto block h-3 w-3 rounded-full"
      style={{ background: color, boxShadow: `0 0 6px 1px ${color}88` }}
    />
  )
}

function CarIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mx-auto h-4 w-4"
      fill="none"
      stroke={on ? 'var(--color-accent)' : 'var(--color-ink-3)'}
      strokeWidth={on ? 2 : 1.25}
      opacity={on ? 1 : 0.35}
    >
      <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" />
      <rect x="3" y="13" width="18" height="5" rx="1.5" />
      <circle cx="7.5" cy="18" r="1.4" />
      <circle cx="16.5" cy="18" r="1.4" />
    </svg>
  )
}

function PedIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mx-auto h-4 w-4"
      fill={on ? '#a78bfa' : 'none'}
      stroke={on ? '#a78bfa' : 'var(--color-ink-3)'}
      strokeWidth={1.5}
      opacity={on ? 1 : 0.35}
    >
      <circle cx="12" cy="5" r="2" />
      <path d="M12 8v6M9 22l2-8M15 22l-2-8M8 12l4-1 4 1" />
    </svg>
  )
}

function HandIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mx-auto h-4 w-4"
      fill={on ? '#ff5a5a' : 'none'}
      stroke={on ? '#ff5a5a' : 'var(--color-ink-3)'}
      strokeWidth={1.5}
      opacity={on ? 1 : 0.35}
    >
      <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6a1.5 1.5 0 0 1 3 0v7M17 11v2a5 5 0 0 1-5 5h-1a5 5 0 0 1-4.2-2.3L4 11.5" />
    </svg>
  )
}

function WalkIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mx-auto h-4 w-4"
      fill={on ? '#10d982' : 'none'}
      stroke={on ? '#10d982' : 'var(--color-ink-3)'}
      strokeWidth={1.5}
      opacity={on ? 1 : 0.35}
    >
      <circle cx="13" cy="4" r="1.7" />
      <path d="M10 22l1.5-6-2-1.5.5-4.5 3-1.5 3 2.5 2 1M9.5 15l-3.5 2M13 12l3 2.5-1 4.5" />
    </svg>
  )
}

const ROWS: {
  label: string
  render: (p: Phase) => React.ReactNode
}[] = [
  { label: 'Reds', render: (p) => (p.signal === 'red' ? <Dot color={FILL.red} /> : null) },
  { label: 'Yellows', render: (p) => (p.signal === 'yellow' ? <Dot color={FILL.yellow} /> : null) },
  { label: 'Greens', render: (p) => (p.signal === 'green' ? <Dot color={FILL.green} /> : null) },
  { label: 'Veh Calls', render: (p) => <CarIcon on={p.veh_call} /> },
  { label: 'Ped Calls', render: (p) => <PedIcon on={p.ped_call} /> },
  { label: 'Dont Walks', render: (p) => <HandIcon on={p.ped === 'dont_walk'} /> },
  { label: 'Ped Clears', render: (p) => <HandIcon on={p.ped === 'ped_clear'} /> },
  { label: 'Walks', render: (p) => <WalkIcon on={p.ped === 'walk'} /> },
]

export function PhaseStatusTable({ snapshot }: { snapshot: Snapshot }) {
  const phases = [...snapshot.phases].sort((a, b) => a.phase - b.phase)
  if (phases.length === 0) return null

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        Phase &amp; call status
      </h3>
      <div className="scroll-thin overflow-x-auto rounded-lg border border-[var(--color-line)]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-panel-2)]">
              <th className="sticky left-0 bg-[var(--color-panel-2)] px-2.5 py-1.5 text-left font-semibold text-[var(--color-ink-3)]">
                Phase
              </th>
              {phases.map((p) => (
                <th
                  key={p.phase}
                  className="px-2.5 py-1.5 text-center font-semibold text-[var(--color-ink)]"
                >
                  {p.phase}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr
                key={row.label}
                className={i % 2 === 0 ? 'bg-[var(--color-panel-2)]/40' : ''}
              >
                <td className="sticky left-0 bg-[inherit] px-2.5 py-1.5 text-[var(--color-ink-2)]">
                  {row.label}
                </td>
                {phases.map((p) => (
                  <td key={p.phase} className="px-2.5 py-1.5">
                    {row.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
