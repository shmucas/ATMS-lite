import {
  APPROACH_LABEL,
  LANE_LABEL,
  defaultMovementPosition,
  movementColor,
  newMovementId,
  suggestPhase,
} from '../lib/movements'
import type { Approach, IntersectionInfo, LaneKind, Movement, Snapshot } from '../types'
import { IntersectionMiniMap } from './IntersectionMiniMap'

const APPROACHES: Approach[] = ['NB', 'SB', 'EB', 'WB']
const LANE_KINDS: LaneKind[] = ['left', 'through', 'right']
const NUDGES = [-15, -5, 5, 15]

function normalizeHeading(deg: number) {
  return ((deg % 360) + 360) % 360
}

function MovementCard({
  movement,
  color,
  baseLat,
  baseLon,
  onChange,
  onRemove,
}: {
  movement: Movement
  color: string
  baseLat: number
  baseLon: number
  onChange: (next: Movement) => void
  onRemove: () => void
}) {
  const setApproach = (approach: Approach) => {
    const pos = defaultMovementPosition(baseLat, baseLon, approach, movement.lanes)
    onChange({ ...movement, approach, phase: suggestPhase(approach, movement.lanes), ...pos })
  }

  const setLane = (index: number, kind: LaneKind) => {
    const lanes = movement.lanes.map((l, i) => (i === index ? kind : l))
    onChange({ ...movement, lanes, phase: suggestPhase(movement.approach, lanes) })
  }

  const addLane = () => {
    const lanes = [...movement.lanes, 'through' as LaneKind]
    onChange({ ...movement, lanes, phase: suggestPhase(movement.approach, lanes) })
  }

  const removeLane = (index: number) => {
    if (movement.lanes.length <= 1) return
    const lanes = movement.lanes.filter((_, i) => i !== index)
    onChange({ ...movement, lanes, phase: suggestPhase(movement.approach, lanes) })
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px 1px ${color}88` }}
          />
          <select
            className="input"
            style={{ width: 'auto' }}
            value={movement.approach}
            onChange={(e) => setApproach(e.target.value as Approach)}
          >
            {APPROACHES.map((a) => (
              <option key={a} value={a}>
                {APPROACH_LABEL[a]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md p-1 text-[var(--color-ink-3)] hover:bg-[var(--color-panel)] hover:text-[var(--color-offline)]"
          aria-label="Remove movement"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Lanes
        </span>
        {movement.lanes.map((kind, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <select
              className="input"
              style={{ width: 'auto' }}
              value={kind}
              onChange={(e) => setLane(i, e.target.value as LaneKind)}
            >
              {LANE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LANE_LABEL[k]}
                </option>
              ))}
            </select>
            {movement.lanes.length > 1 && (
              <button
                type="button"
                onClick={() => removeLane(i)}
                className="px-1 text-sm text-[var(--color-ink-3)] hover:text-[var(--color-offline)]"
                aria-label="Remove lane"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addLane}
          className="rounded-md border border-[var(--color-line-strong)] px-1.5 py-1 text-[10px] font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]"
        >
          + Lane
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          Phase
          <input
            type="number"
            min={1}
            value={movement.phase}
            onChange={(e) =>
              onChange({ ...movement, phase: Math.max(1, parseInt(e.target.value, 10) || 1) })
            }
            className="w-14 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1 text-xs text-[var(--color-ink)]"
          />
        </label>
        <span className="tabular text-[10px] text-[var(--color-ink-3)]">
          {movement.lat.toFixed(5)}, {movement.lon.toFixed(5)}
        </span>
      </div>

      {/* Heading rotates the arrow to line up with the real pavement in the
          mini map above - the auto-placed compass heading is just a
          starting point, real intersections rarely sit dead on N/E/S/W. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Heading
        </span>
        <input
          type="number"
          min={0}
          max={359}
          value={Math.round(movement.heading)}
          onChange={(e) =>
            onChange({ ...movement, heading: normalizeHeading(parseInt(e.target.value, 10) || 0) })
          }
          className="w-16 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1 text-xs text-[var(--color-ink)]"
        />
        <span className="text-[10px] text-[var(--color-ink-3)]">°</span>
        <div className="ml-1 flex items-center gap-1">
          {NUDGES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ ...movement, heading: normalizeHeading(movement.heading + n) })}
              className="rounded-md border border-[var(--color-line-strong)] px-1.5 py-1 text-[10px] font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]"
            >
              {n > 0 ? `+${n}°` : `${n}°`}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={359}
          value={Math.round(movement.heading)}
          onChange={(e) => onChange({ ...movement, heading: normalizeHeading(parseInt(e.target.value, 10)) })}
          className="mt-1 w-full accent-[var(--color-accent)]"
        />
      </div>
    </div>
  )
}

export function MovementsPanel(props: {
  info: IntersectionInfo
  snapshot?: Snapshot
  draft: Movement[]
  onChangeDraft: (items: Movement[]) => void
  onSave: () => void
  onDiscard: () => void
  dirty: boolean
  saving: boolean
  error: string | null
}) {
  const { info, snapshot, draft, onChangeDraft, onSave, onDiscard, dirty, saving, error } = props

  if (info.lat == null || info.lon == null) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-ink-3)]">
        Pin this intersection on the map before configuring lane movements.
      </div>
    )
  }

  const baseLat = info.lat
  const baseLon = info.lon

  const addMovement = () => {
    const approach: Approach = 'NB'
    const lanes: LaneKind[] = ['through']
    const pos = defaultMovementPosition(baseLat, baseLon, approach, lanes)
    const movement: Movement = {
      id: newMovementId(draft),
      approach,
      lanes,
      phase: suggestPhase(approach, lanes),
      ...pos,
    }
    onChangeDraft([...draft, movement])
  }

  const updateMovement = (id: string, next: Movement) => {
    onChangeDraft(draft.map((m) => (m.id === id ? next : m)))
  }

  const removeMovement = (id: string) => {
    onChangeDraft(draft.filter((m) => m.id !== id))
  }

  const dragMovement = (movementId: string, lat: number, lon: number) => {
    onChangeDraft(draft.map((m) => (m.id === movementId ? { ...m, lat, lon } : m)))
  }

  const rotateAll = (delta: number) => {
    onChangeDraft(draft.map((m) => ({ ...m, heading: normalizeHeading(m.heading + delta) })))
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Lane movements
        </h3>
        {draft.length > 0 ? (
          <IntersectionMiniMap
            lat={baseLat}
            lon={baseLon}
            movements={draft}
            snapshot={snapshot}
            editable
            onDragMovement={dragMovement}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] py-8 text-center text-xs text-[var(--color-ink-3)]">
            No movements yet. Add one below to place a lane-use arrow.
          </div>
        )}
        <div className="mt-1.5 text-[10px] text-[var(--color-ink-3)]">
          Drag an arrow on the satellite view to reposition it; use Heading below to rotate it onto
          the real lane.
        </div>
        {draft.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2.5 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
              Rotate all
            </span>
            {NUDGES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => rotateAll(n)}
                className="rounded-md border border-[var(--color-line-strong)] px-1.5 py-1 text-[10px] font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]"
              >
                {n > 0 ? `+${n}°` : `${n}°`}
              </button>
            ))}
            <span className="text-[10px] text-[var(--color-ink-3)]">
              nudges every arrow together - use this if the whole intersection is skewed off compass
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={addMovement}
        className="w-full rounded-md border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
      >
        + Add movement
      </button>

      <div className="space-y-3">
        {draft.map((m) => (
          <MovementCard
            key={m.id}
            movement={m}
            color={movementColor(snapshot, m.phase)}
            baseLat={baseLat}
            baseLon={baseLon}
            onChange={(next) => updateMovement(m.id, next)}
            onRemove={() => removeMovement(m.id)}
          />
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-xs text-[var(--color-offline)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onDiscard}
          className="rounded-lg border border-[var(--color-line-strong)] px-3.5 py-2 text-xs font-semibold text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)] disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save movements'}
        </button>
      </div>
    </div>
  )
}
