async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
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
}
