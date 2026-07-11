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
  } | null
}
