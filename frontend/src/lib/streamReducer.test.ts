import { describe, expect, it } from 'vitest'
import type { AtmsEvent, IntersectionInfo, Snapshot } from '../types'
import { applyMessage, EMPTY, type StreamState } from './streamReducer'

const info = (id: string, overrides: Partial<IntersectionInfo> = {}): IntersectionInfo => ({
  id,
  name: id,
  lat: 33.8,
  lon: -84.3,
  connection: 'starting',
  static: null,
  ...overrides,
})

const snapshot = (id: string, latency = 25): Snapshot => ({
  schema: 'atms.snapshot.v1',
  intersection_id: id,
  seq: 1,
  ts: '2026-07-12T00:00:00.000+00:00',
  connection: 'connected',
  uptime_ticks: 100,
  poll_latency_ms: latency,
  phases: [],
  masks: {},
})

const event = (id: string, kind: string): AtmsEvent => ({
  intersection_id: id,
  ts: '2026-07-12T00:00:01.000+00:00',
  kind,
  detail: '',
})

describe('applyMessage', () => {
  it('hello replaces intersections and merges snapshots/control', () => {
    const prior: StreamState = {
      ...EMPTY,
      snapshots: { old: snapshot('old') },
    }
    const s = applyMessage(prior, {
      type: 'hello',
      intersections: [info('a')],
      snapshots: { a: snapshot('a') },
      events: [],
      control: { a: { armed: false, armed_until: null, veh_calls: {}, ped_calls: {}, holds: {}, omits: {}, forced_phase: null } },
    })
    expect(s.intersections.map((i) => i.id)).toEqual(['a'])
    expect(Object.keys(s.snapshots).sort()).toEqual(['a', 'old'])
    expect(s.control.a.armed).toBe(false)
  })

  it('snapshot updates data, marks connected, and caps latency history', () => {
    let s: StreamState = { ...EMPTY, intersections: [info('a')] }
    for (let i = 0; i < 150; i++) {
      s = applyMessage(s, { type: 'snapshot', data: snapshot('a', i) })
    }
    expect(s.intersections[0].connection).toBe('connected')
    expect(s.latencyHistory.a).toHaveLength(120)
    expect(s.latencyHistory.a.at(-1)).toBe(149)
    expect(s.snapshots.a.poll_latency_ms).toBe(149)
  })

  it('connection events flip intersection state', () => {
    let s: StreamState = {
      ...EMPTY,
      intersections: [info('a', { connection: 'connected' })],
    }
    s = applyMessage(s, { type: 'event', data: event('a', 'degraded') })
    expect(s.intersections[0].connection).toBe('degraded')
    s = applyMessage(s, { type: 'event', data: event('a', 'disconnected') })
    expect(s.intersections[0].connection).toBe('disconnected')
    s = applyMessage(s, { type: 'event', data: event('a', 'reconnected') })
    expect(s.intersections[0].connection).toBe('connected')
    // Non-connection events leave state alone but land in the log.
    s = applyMessage(s, { type: 'event', data: event('a', 'controller-reboot') })
    expect(s.intersections[0].connection).toBe('connected')
    expect(s.events).toHaveLength(4)
  })

  it('event log is capped at 200', () => {
    let s: StreamState = { ...EMPTY, intersections: [info('a')] }
    for (let i = 0; i < 250; i++) {
      s = applyMessage(s, { type: 'event', data: event('a', 'unit-status-change') })
    }
    expect(s.events).toHaveLength(200)
  })

  it('intersection add is idempotent and update/remove work', () => {
    let s = applyMessage(EMPTY, { type: 'intersection_added', data: info('a') })
    s = applyMessage(s, { type: 'intersection_added', data: info('a', { name: 'A2' }) })
    expect(s.intersections).toHaveLength(1)
    expect(s.intersections[0].name).toBe('A2')
    s = applyMessage(s, {
      type: 'intersection_updated',
      data: info('a', { name: 'A3' }),
    })
    expect(s.intersections[0].name).toBe('A3')
    s = applyMessage(s, { type: 'intersection_removed', data: { id: 'a' } })
    expect(s.intersections).toHaveLength(0)
  })

  it('control message is keyed by intersection', () => {
    const s = applyMessage(EMPTY, {
      type: 'control',
      data: {
        intersection_id: 'a', armed: true, armed_until: null,
        veh_calls: { 1: 4 }, ped_calls: {}, holds: {}, omits: {}, forced_phase: null,
      },
    })
    expect(s.control.a.armed).toBe(true)
    expect(s.control.a.veh_calls).toEqual({ 1: 4 })
  })

  it('unknown message types are ignored', () => {
    expect(applyMessage(EMPTY, { type: 'mystery' })).toBe(EMPTY)
  })
})
