export type Signal = 'red' | 'yellow' | 'green' | 'dark'
export type Ped = 'walk' | 'ped_clear' | 'dont_walk' | 'dark'
export type Connection = 'connected' | 'degraded' | 'disconnected'

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

export interface IntersectionInfo {
  id: string
  name: string
  lat: number | null
  lon: number | null
  connection: Connection
  static: {
    sys_descr?: string
    controller_max_phases?: number
    controller_phase_groups?: number
    polled_groups?: number
    polled_phases?: number
    rings?: { ring: number; phases: number[] }[]
    barriers?: number[][]
  } | null
}
