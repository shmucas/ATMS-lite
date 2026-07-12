import type { DeviceType, Movement } from '../types'

const TOKEN = import.meta.env.VITE_CONTROL_TOKEN ?? ''

export interface IntersectionDraft {
  id?: string
  name: string
  host: string
  port?: number
  device_type: DeviceType
  lat?: number | null
  lon?: number | null
}

async function request(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body) headers['content-type'] = 'application/json'
  if (TOKEN) headers['x-control-token'] = TOKEN
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j.detail) detail = j.detail
    } catch {
      // response had no JSON body; keep the status-code message
    }
    throw new Error(detail)
  }
  return res.json()
}

export const intersectionsApi = {
  create: (draft: IntersectionDraft) => request('POST', '/api/intersections', draft),
  update: (id: string, draft: IntersectionDraft) =>
    request('PUT', `/api/intersections/${id}`, draft),
  remove: (id: string) => request('DELETE', `/api/intersections/${id}`),
  updateMovements: (id: string, movements: Movement[]) =>
    request('PUT', `/api/intersections/${id}`, { movements }),
  deviceTypes: (): Promise<{ supported: DeviceType[]; all: DeviceType[] }> =>
    request('GET', '/api/device-types'),
}
