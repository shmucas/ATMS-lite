export type Signal = 'red' | 'yellow' | 'green' | 'dark'
export type Ped = 'walk' | 'ped_clear' | 'dont_walk' | 'dark'
export type Connection = 'connected' | 'degraded' | 'disconnected' | 'unsupported' | 'starting'
export type DeviceType = 'maxtime' | 'econolite' | 'siemens'

export interface Phase {
  phase: number
  signal: Signal
  ped: Ped
  veh_call: boolean
  ped_call: boolean
  on: boolean
  next: boolean
}

export interface Coord {
  pattern: number | null
  cycle_status: number | null
  sync_timer: number | null
  local_free: number | null
  /* Measured by the backend from the observed signal sequence, not reported
     by the controller. Actuated operation means cycle length varies. */
  last_cycle: number | null
  avg_cycle: number | null
  cycles_seen: number
  cycle_elapsed: number | null
  reference_phase: number | null
}

export interface Detector {
  detector: number
  volume: number | null
  occupancy: number | null
  reporting: boolean
}

export interface Moe {
  phases: { phase: number; green_pct: number; samples: number }[]
  window_polls: number
}

export interface Snapshot {
  schema: string
  intersection_id: string
  seq: number
  ts: string
  connection: Connection
  uptime_ticks: number
  poll_latency_ms: number
  phases: Phase[]
  masks: Record<string, number>
  coord?: Coord
  detectors?: Detector[]
  moe?: Moe
}

export interface AtmsEvent {
  intersection_id: string
  ts: string
  kind: string
  detail: string
}

export type Approach = 'NB' | 'SB' | 'EB' | 'WB'
export type LaneKind = 'left' | 'through' | 'right'

/* A lane-use arrow: one or more parallel lanes (left-to-right) that share a
   phase, drawn as a single map marker rotated to face the direction of
   travel. */
export interface Movement {
  id: string
  approach: Approach
  lanes: LaneKind[]
  phase: number
  lat: number
  lon: number
  heading: number
}

export interface IntersectionInfo {
  id: string
  name: string
  lat: number | null
  lon: number | null
  connection: Connection
  device_type?: DeviceType
  host?: string
  port?: number
  movements?: Movement[]
  /* Corridor membership for the time-space diagram: which named corridor
     this intersection sits on, its distance along it, and which phase
     represents the corridor's progression direction here. `direction`,
     when set, is the compass approach that travels toward increasing
     position_m; the diagram derives each member's phase from its own
     movements for that approach (falling back to `phase` when a member
     has none mapped) and can flip to the opposite approach. */
  corridor?: {
    name: string
    position_m: number
    phase: number
    direction?: Approach
  } | null
  static: {
    sys_descr?: string
    controller_max_phases?: number
    controller_phase_groups?: number
    polled_groups?: number
    polled_phases?: number
    rings?: { ring: number; phases: number[] }[]
    barriers?: number[][]
    /* Per-phase concurrency, keyed by phase number (JSON object keys are
       strings): which other phases this one may legally run alongside.
       Ground truth for what a "phase pair" is allowed to be. */
    concurrency?: Record<string, number[]>
  } | null
}
