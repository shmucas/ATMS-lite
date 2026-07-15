import clsx from "clsx";
import { useState } from "react";
import { control } from "../lib/control";
import { isConcurrentSelection, maskHasPhase } from "../lib/phaseMask";
import type { ControlState, StreamState } from "../lib/stream";
import type { Connection, IntersectionInfo, Snapshot } from "../types";
import { CoordMonitor } from "./CoordMonitor";
import { IntersectionMiniMap } from "./IntersectionMiniMap";
import { DetectorPanel } from "./panels/DetectorPanel";
import { HealthPanel } from "./panels/HealthPanel";
import { PhaseStatusTable } from "./PhaseStatusTable";
import { RingDiagram } from "./RingDiagram";

type Tab = "signals" | "detectors" | "health";

const STATUS_LABEL: Record<Connection, { text: string; color: string }> = {
  connected: { text: "Online", color: "var(--color-online)" },
  degraded: { text: "Degraded", color: "var(--color-degraded)" },
  disconnected: { text: "Offline", color: "var(--color-offline)" },
  unsupported: { text: "Unsupported device", color: "var(--color-ink-3)" },
  starting: { text: "Starting", color: "var(--color-ink-3)" },
};

function StatusPill({ state }: { state: Connection }) {
  const s = STATUS_LABEL[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{
        background: `color-mix(in srgb, ${s.color} 15%, transparent)`,
        color: s.color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: s.color }}
      />
      {s.text}
    </span>
  );
}

function SignalsTab(props: {
  info: IntersectionInfo;
  snapshot?: Snapshot;
  control?: ControlState;
}) {
  const { info, snapshot } = props;
  const enabled = props.control?.armed ?? false;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [phaseInput, setPhaseInput] = useState("1");
  const forcedPhase = props.control?.forced_phase ?? null;
  const holds = props.control?.holds ?? {};
  const forceOffs = props.control?.force_offs ?? {};
  const pedCalls = props.control?.ped_calls ?? {};
  const vehCalls = props.control?.veh_calls ?? {};
  const phaseNum = parseInt(phaseInput, 10);
  const validPhase = Number.isInteger(phaseNum) && phaseNum >= 1;
  const pedCalled = validPhase ? maskHasPhase(pedCalls, phaseNum) : false;
  const vehCalled = validPhase ? maskHasPhase(vehCalls, phaseNum) : false;

  const selectedPhases = [...selected].sort((a, b) => a - b);
  const concurrency = info.static?.concurrency;
  const selectionLegal = isConcurrentSelection(concurrency, selectedPhases);
  const selectionAllHeld =
    selectedPhases.length > 0 && selectedPhases.every((p) => maskHasPhase(holds, p));
  const selectionAllForcedOff =
    selectedPhases.length > 0 &&
    selectedPhases.every((p) => maskHasPhase(forceOffs, p));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (phase: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  };

  const canSend =
    enabled &&
    info.connection !== "disconnected" &&
    !busy &&
    selectedPhases.length > 0 &&
    selectionLegal;

  if (!snapshot) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-ink-3)]">
        No signal data yet from this controller.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {info.lat != null &&
        info.lon != null &&
        (info.movements?.length ?? 0) > 0 && (
          <IntersectionMiniMap
            lat={info.lat}
            lon={info.lon}
            movements={info.movements ?? []}
            snapshot={snapshot}
          />
        )}
      <PhaseStatusTable snapshot={snapshot} />
      <RingDiagram
        snapshot={snapshot}
        info={info}
        armed={enabled}
        selected={selected}
        onToggle={toggleSelect}
        holds={holds}
        forceOffs={forceOffs}
      />
      <CoordMonitor snapshot={snapshot} />

      {/* Manual control: a labeled, explained safety switch, not jargon. */}
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--color-ink)]">
              Manual control
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-ink-2)]">
              {enabled
                ? "Enabled. Click phases above to select them, then hold or force off."
                : "Read-only. Enable to send hold / force off to the physical controller."}
            </div>
          </div>
          <button
            type="button"
            disabled={busy || info.connection === "disconnected"}
            onClick={() =>
              run(async () => {
                setSelected(new Set());
                await (enabled ? control.disarm(info.id) : control.arm(info.id));
              })
            }
            className={clsx(
              "shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-40",
              enabled
                ? "bg-[var(--color-degraded)] text-black hover:brightness-110"
                : "border border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]",
            )}
          >
            {enabled ? "Disable control" : "Enable control"}
          </button>
        </div>
        {enabled && (
          <div className="mt-3 rounded-md border border-[var(--color-degraded)]/30 bg-[var(--color-degraded)]/10 px-3 py-2 text-xs text-[var(--color-degraded)]">
            Live control is enabled. Holds and force-offs auto-clear when you
            disable it, the link drops, or after 5 minutes.
          </div>
        )}
        {enabled && (
          <div className="mt-3 border-t border-[var(--color-line)] pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-ink-2)]">
                {selectedPhases.length === 0
                  ? "Click one phase, or a concurrent pair, on the diagram."
                  : `Selected: ${selectedPhases.map((p) => `Φ${p}`).join(" + ")}`}
              </span>
              <button
                type="button"
                disabled={!canSend}
                onClick={() =>
                  run(() =>
                    control.hold(info.id, selectedPhases, !selectionAllHeld),
                  )
                }
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40",
                  selectionAllHeld
                    ? "bg-[var(--color-degraded)] text-black hover:brightness-110"
                    : "border border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]",
                )}
              >
                {selectionAllHeld ? "Release hold" : "Hold"}
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={() =>
                  run(() =>
                    control.forceOff(
                      info.id,
                      selectedPhases,
                      !selectionAllForcedOff,
                    ),
                  )
                }
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40",
                  selectionAllForcedOff
                    ? "bg-[var(--color-offline)] text-black hover:brightness-110"
                    : "border border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]",
                )}
              >
                {selectionAllForcedOff ? "Release force off" : "Force off"}
              </button>
              {selectedPhases.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-md px-2 py-1.5 text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                >
                  Clear
                </button>
              )}
            </div>
            {selectedPhases.length > 1 && !selectionLegal && (
              <div className="mt-2 text-[11px] text-[var(--color-offline)]">
                These phases cannot run concurrently on this intersection;
                pick phases from the same barrier column instead.
              </div>
            )}
          </div>
        )}
        {enabled && (
          <details className="mt-3 border-t border-[var(--color-line)] pt-3">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
              Other controls
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
                Phase
                <input
                  type="number"
                  min={1}
                  value={phaseInput}
                  onChange={(e) => setPhaseInput(e.target.value)}
                  className="w-14 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1 text-xs text-[var(--color-ink)]"
                />
              </label>
              <button
                type="button"
                disabled={
                  busy ||
                  !validPhase ||
                  info.connection === "disconnected" ||
                  (forcedPhase != null && forcedPhase !== phaseNum)
                }
                onClick={() =>
                  run(() =>
                    control.force(info.id, phaseNum, forcedPhase !== phaseNum),
                  )
                }
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40",
                  forcedPhase === phaseNum
                    ? "bg-[var(--color-degraded)] text-black hover:brightness-110"
                    : "border border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]",
                )}
              >
                {forcedPhase === phaseNum ? "Release force" : "Force phase to serve"}
              </button>
              <button
                type="button"
                disabled={
                  busy || !validPhase || info.connection === "disconnected"
                }
                onClick={() =>
                  run(() => control.call(info.id, "veh", phaseNum, !vehCalled))
                }
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40",
                  vehCalled
                    ? "bg-[var(--color-degraded)] text-black hover:brightness-110"
                    : "border border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]",
                )}
              >
                {vehCalled ? "Clear veh call" : "Veh call"}
              </button>
              <button
                type="button"
                disabled={
                  busy || !validPhase || info.connection === "disconnected"
                }
                onClick={() =>
                  run(() => control.call(info.id, "ped", phaseNum, !pedCalled))
                }
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40",
                  pedCalled
                    ? "bg-[var(--color-degraded)] text-black hover:brightness-110"
                    : "border border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:bg-[var(--color-panel)]",
                )}
              >
                {pedCalled ? "Clear ped call" : "Ped call"}
              </button>
              {forcedPhase != null && (
                <span className="text-[11px] text-[var(--color-ink-3)]">
                  Phase {forcedPhase} forced; all others in its ring are omitted.
                </span>
              )}
            </div>
          </details>
        )}
        {error && (
          <div className="mt-3 rounded-md border border-[var(--color-offline)]/30 bg-[var(--color-offline)]/10 px-3 py-2 text-xs text-[var(--color-offline)]">
            {error}
          </div>
        )}
      </div>

      <div className="tabular flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-ink-3)]">
        <span>poll {snapshot.poll_latency_ms} ms</span>
        <span>seq {snapshot.seq}</span>
        <span>
          {info.static?.polled_phases ?? 8} of{" "}
          {info.static?.controller_max_phases ?? "?"} phases
        </span>
      </div>
    </div>
  );
}

export function DetailDrawer(props: {
  stream: StreamState;
  id: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { stream, id, onClose, onEdit } = props;
  const info = stream.intersections.find((i) => i.id === id);
  const [tab, setTab] = useState<Tab>("signals");

  if (!info) return null;
  const snapshot = stream.snapshots[id];

  const tabs: { id: Tab; label: string }[] = [
    { id: "signals", label: "Signal Status" },
    { id: "detectors", label: "Detectors" },
    { id: "health", label: "Health" },
  ];

  return (
    <aside className="flex h-full w-full flex-col border-l border-[var(--color-line)] bg-[var(--color-panel)] sm:w-[440px]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2
              className="truncate text-base font-bold"
              style={{ color: "var(--color-ink)" }}
            >
              {info.name}
            </h2>
            <StatusPill state={info.connection} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]">
            {info.static?.sys_descr ?? info.id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-[var(--color-ink-3)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
            aria-label="Edit configuration"
            title="Edit configuration"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--color-ink-3)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-line)] px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "rounded-t-md px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-[var(--color-accent)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {tab === "signals" && (
          <SignalsTab
            info={info}
            snapshot={snapshot}
            control={stream.control[id]}
          />
        )}
        {tab === "detectors" && <DetectorPanel snapshot={snapshot} />}
        {tab === "health" && (
          <HealthPanel info={info} snapshot={snapshot} stream={stream} />
        )}
      </div>
    </aside>
  );
}
