import type { Phase } from '../types'

/* Signal colors are domain-semantic: a red ball is red. Deliberately not from
   the abstract categorical palette. */
export const SIGNAL_FILL: Record<Phase['signal'], string> = {
  green: '#10d982',
  yellow: '#f5c518',
  red: '#ff5a5a',
  dark: '#2b3a4f',
}

export const PED_TEXT: Record<Phase['ped'], { t: string; c: string }> = {
  walk: { t: 'WALK', c: '#10d982' },
  ped_clear: { t: 'FDW', c: '#f5c518' },
  dont_walk: { t: 'DW', c: 'var(--color-ink-3)' },
  dark: { t: '', c: 'transparent' },
}
