import type { DeviceType, Movement } from "../types";

const TOKEN = import.meta.env.VITE_CONTROL_TOKEN ?? "";

export interface HiresEvent {
  ts: string;
  event_code: number;
  event_param: number;
}

export interface IntersectionDraft {
  id?: string;
  name: string;
  host: string;
  port?: number;
  device_type: DeviceType;
  lat?: number | null;
  lon?: number | null;
  /* Optional per-intersection SNMP communities. The backend stores them in
     a gitignored sidecar; blank means keep the current/default value. */
  read_community?: string;
  write_community?: string;
  movements?: Movement[];
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  sys_descr?: string;
  uptime_ticks?: number | null;
  max_phases?: number | null;
}

async function request(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (TOKEN) headers["x-control-token"] = TOKEN;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.detail) detail = j.detail;
    } catch {
      // response had no JSON body; keep the status-code message
    }
    throw new Error(detail);
  }
  return res.json();
}

export const intersectionsApi = {
  create: (draft: IntersectionDraft) =>
    request("POST", "/api/intersections", draft),
  update: (id: string, draft: IntersectionDraft) =>
    request("PUT", `/api/intersections/${id}`, draft),
  remove: (id: string) => request("DELETE", `/api/intersections/${id}`),
  deviceTypes: (): Promise<{ supported: DeviceType[]; all: DeviceType[] }> =>
    request("GET", "/api/device-types"),
  probe: (body: {
    host: string;
    port?: number;
    read_community?: string;
  }): Promise<ProbeResult> => request("POST", "/api/probe", body),
  hires: (id: string, opts: { minutes?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.minutes != null) params.set("minutes", String(opts.minutes));
    if (opts.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request(
      "GET",
      `/api/intersections/${id}/hires${qs ? `?${qs}` : ""}`,
    ) as Promise<HiresEvent[]>;
  },
};
