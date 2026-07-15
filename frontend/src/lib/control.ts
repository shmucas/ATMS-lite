// Optional control token. Set VITE_CONTROL_TOKEN at build time to match the
// backend's ATMS_CONTROL_TOKEN when control is guarded.
const TOKEN = import.meta.env.VITE_CONTROL_TOKEN ?? ''

async function post(path: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (body) headers['content-type'] = 'application/json'
  if (TOKEN) headers['x-control-token'] = TOKEN
  const res = await fetch(path, {
    method: 'POST',
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

export const control = {
  arm: (id: string) => post(`/api/intersections/${id}/arm`),
  disarm: (id: string) => post(`/api/intersections/${id}/disarm`),
  call: (id: string, kind: 'veh' | 'ped', phase: number, on = true) =>
    post(`/api/intersections/${id}/call`, { kind, phase, on }),
  hold: (id: string, phases: number[], on = true) =>
    post(`/api/intersections/${id}/hold`, { phases, on }),
  forceOff: (id: string, phases: number[], on = true) =>
    post(`/api/intersections/${id}/force-off`, { phases, on }),
  force: (id: string, phase: number, on = true) =>
    post(`/api/intersections/${id}/force`, { phase, on }),
}
