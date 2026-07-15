// Control masks (holds, omits, force_offs, calls) are keyed by 8-phase group
// number as a string (JSON object keys), one bit per phase within the group.

export function maskHasPhase(
  masks: Record<string, number> | undefined,
  phase: number,
): boolean {
  if (!masks) return false
  const group = String(((phase - 1) >> 3) + 1)
  return Boolean((masks[group] ?? 0) & (1 << ((phase - 1) % 8)))
}

// A phase selection may be held or forced off together only if every phase
// in it is in every other phase's concurrency set, per the controller's own
// phaseConcurrency table. A single phase is always trivially valid.
export function isConcurrentSelection(
  concurrency: Record<string, number[]> | undefined,
  phases: number[],
): boolean {
  if (phases.length <= 1) return true
  if (!concurrency) return false
  return phases.every((a) => {
    const allowed = concurrency[String(a)] ?? []
    return phases.every((b) => b === a || allowed.includes(b))
  })
}
