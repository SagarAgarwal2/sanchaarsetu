import type { Business, Conflict, Department, PropagationEvent, SchemaMapping, AuditRecord, DlqMessage } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type DashboardStats = {
  events: PropagationEvent[];
  recentEvents: PropagationEvent[];
  departments: Department[];
  totalEvents: number;
  activeConflicts: number;
  pendingMappings: number;
  totalBusinesses: number;
  activeDepts: number;
  avgPropMs: number;
  swsToDept: number;
  deptToSws: number;
};

export async function getDashboardStats() {
  return request<DashboardStats>('/dashboard/stats');
}

export async function listPropagationEvents(params: {
  limit?: number;
  offset?: number;
  outcome?: string;
  q?: string;
} = {}) {
  const search = new URLSearchParams();
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  if (params.outcome) search.set('outcome', params.outcome);
  if (params.q) search.set('q', params.q);
  return request<{ data: PropagationEvent[]; total: number }>(`/propagation-events?${search.toString()}`);
}

export async function replayPropagationEvent(event: PropagationEvent) {
  return request<PropagationEvent>('/propagation-events/replay', {
    method: 'POST',
    body: JSON.stringify({
      ubid: event.ubid,
      event_type: event.event_type,
      direction: event.direction,
      source_system: event.source_system,
      destination_system: event.destination_system,
      payload_hash: event.payload_hash,
    }),
  });
}

export async function listConflicts(params: {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  return request<{ data: Conflict[]; total: number }>(`/conflicts?${search.toString()}`);
}

export async function resolveConflict(conflictId: string, payload: {
  winning_value?: string | null;
  resolved_by?: string | null;
  resolution_reason?: string | null;
}) {
  return request<Conflict>(`/conflicts/${conflictId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function suggestConflictResolution(conflictId: string) {
  return request<{ suggested_winner: string; reasoning: string }>(`/conflicts/${conflictId}/suggest`);
}

export async function listSchemaMappings(params: {
  status?: string;
  department_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.department_id) search.set('department_id', params.department_id);
  if (params.q) search.set('q', params.q);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  return request<{ data: SchemaMapping[]; total: number }>(`/schema-mappings?${search.toString()}`);
}

export async function createSchemaMapping(input: {
  department_id: string;
  sws_field: string;
  dept_field: string;
  confidence_score: number;
}) {
  return request<SchemaMapping>('/schema-mappings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSchemaMapping(mappingId: string, input: {
  status?: SchemaMapping['status'];
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  confidence_score?: number | null;
}) {
  return request<SchemaMapping>(`/schema-mappings/${mappingId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listDepartments() {
  return request<Department[]>('/departments');
}

export async function updateDepartment(deptId: string, status: Department['status']) {
  return request<Department>(`/departments/${deptId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function listBusinesses() {
  return request<Business[]>('/businesses');
}

export async function simulateBackendEvent() {
  return request<Json>('/simulate/event', { method: 'POST' });
}

export async function simulateBackendBurst(count = 8) {
  return request<Json>('/simulate/burst', { method: 'POST', body: JSON.stringify({ count }) });
}

export async function listAuditTrail(params: { limit?: number; offset?: number } = {}) {
  const search = new URLSearchParams();
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  return request<AuditRecord[]>(`/audit?${search.toString()}`);
}

export async function listDlq() {
  return request<{ data: DlqMessage[]; total: number }>('/dlq');
}

export async function replayDlq(dlqMessageId: string) {
  return request<PropagationEvent>(`/dlq/${dlqMessageId}/replay`, { method: 'POST' });
}

export async function simulateChangeDetected(payload: { department: string; ubid: string; event_type: string; payload: any }) {
  return request<Json>('/simulate/change-detected', { method: 'POST', body: JSON.stringify(payload) });
}
