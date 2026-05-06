import { useEffect, useState } from 'react';
import type { PropagationEvent } from '../lib/types';
import { listPropagationEvents } from '../lib/api';
import { RefreshCw, Search, Lock, CheckCircle2, AlertTriangle, Download } from 'lucide-react';

const OUTCOME_CFG: Record<string, { color: string; bg: string; border: string }> = {
  success: { color: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
  failure: { color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
  conflict: { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20' },
  duplicate: { color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  pending: { color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
  dlq: { color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
};

const PER_PAGE = 25;

export default function AuditTrail() {
  const [events, setEvents] = useState<PropagationEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  async function load() {
    const { data, total } = await listPropagationEvents({
      limit: PER_PAGE,
      offset: page * PER_PAGE,
      outcome: outcomeFilter,
    });
    setEvents(data || []);
    setTotal(total || 0);
    setLoading(false);
  }

  useEffect(() => { load(); }, [page, outcomeFilter]);

  const filtered = events.filter(e =>
    search === '' ||
    e.ubid.toLowerCase().includes(search.toLowerCase()) ||
    e.event_type.toLowerCase().includes(search.toLowerCase()) ||
    e.idempotency_key.toLowerCase().includes(search.toLowerCase()) ||
    e.source_system.toLowerCase().includes(search.toLowerCase()) ||
    e.destination_system.toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (ts: string) => new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  function exportCSV() {
    const rows = [
      ['Timestamp', 'UBID', 'Event Type', 'Source', 'Destination', 'Outcome', 'Latency (ms)', 'Retries', 'Conflict', 'Idempotency Key'],
      ...filtered.map(e => [
        e.created_at, e.ubid, e.event_type, e.source_system, e.destination_system,
        e.outcome, e.propagation_ms ?? '', e.retry_count, e.conflict_flag, e.idempotency_key,
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sanchaarsetu-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const outcomes = ['all', 'success', 'failure', 'conflict', 'duplicate', 'pending', 'dlq'];
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Immutability banner */}
      <div className="flex items-start gap-4 card px-6 py-4 border-l-4 border-l-primary">
        <Lock size={18} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[14px] font-bold text-navy">Append-Only Audit Log · Tamper-Evident via Hash Chaining</p>
          <p className="text-[12px] text-body mt-1 leading-relaxed">
            No DELETE or UPDATE permissions on this table. Every propagation event — success, failure, conflict, retry, DLQ — is permanently recorded.
            Each record captures UBID, event type, source, destination, payload hash, idempotency key, outcome, and timestamp.
          </p>
        </div>
        <button
          onClick={exportCSV}
          className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-white border border-[#e5edf5] hover:bg-gray-50 text-navy text-[13px] rounded-md transition-colors font-semibold shadow-sm"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[280px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="Search UBID, event, system, idempotency key..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-[#e5edf5] rounded-md pl-10 pr-4 py-2 text-[13px] text-navy placeholder-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary shadow-sm transition-all" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {outcomes.map(o => {
            const cfg = OUTCOME_CFG[o];
            return (
              <button key={o} onClick={() => { setOutcomeFilter(o); setPage(0); }}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-all capitalize shadow-sm ${
                  outcomeFilter === o
                    ? o === 'all' ? 'bg-navy text-white border-navy' : `${cfg.bg} ${cfg.border} ${cfg.color}`
                    : 'bg-white text-body border-[#e5edf5] hover:border-gray-300 hover:text-navy'
                }`}>
                {o}
              </button>
            );
          })}
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-50 border border-[#e5edf5] rounded-md text-[13px] text-navy font-medium transition-colors shadow-sm ml-auto">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e5edf5] bg-gray-50">
                {['Timestamp', 'UBID', 'Event Type', 'Source → Dest', 'Outcome', 'Latency', 'Retries', 'Idempotency Key'].map(h => (
                  <th key={h} className="px-6 py-4 text-[11px] text-body font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5edf5] bg-white">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center"><RefreshCw size={24} className="animate-spin text-body mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-body text-[14px]">No records match your filters</td></tr>
              ) : (
                filtered.map(event => {
                  const cfg = OUTCOME_CFG[event.outcome] ?? OUTCOME_CFG.pending;
                  return (
                    <tr key={event.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-6 py-4 text-[12px] text-muted font-medium whitespace-nowrap">{formatDate(event.created_at)}</td>
                      <td className="px-6 py-4">
                        <code className="text-[13px] text-navy font-semibold font-mono">{event.ubid}</code>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[12px] text-navy font-medium capitalize">{event.event_type.replace(/_/g, ' ')}</span>
                        {event.conflict_flag && <AlertTriangle size={12} className="inline-block text-warning ml-2" />}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[12px] flex items-center">
                          <span className="text-navy font-medium font-mono bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md">{event.source_system}</span>
                          <span className="text-muted mx-2">→</span>
                          <span className="text-navy font-medium font-mono bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md">{event.destination_system}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                          {event.outcome}
                        </span>
                      </td>
                      <td className="px-6 py-4 tabular-nums text-[12px] font-medium text-body">
                        {event.propagation_ms != null ? `${event.propagation_ms}ms` : '—'}
                      </td>
                      <td className="px-6 py-4 text-center tabular-nums text-[12px] font-medium">
                        {event.retry_count > 0
                          ? <span className="text-warning bg-warning/10 px-2 py-0.5 rounded font-bold">{event.retry_count}</span>
                          : <span className="text-muted">0</span>}
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-[11px] text-muted font-mono group-hover:text-navy transition-colors max-w-[180px] truncate block">
                          {event.idempotency_key}
                        </code>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-[#e5edf5] bg-gray-50 flex items-center justify-between text-[12px] text-body font-medium">
          <span>{total.toLocaleString()} total records · page {page + 1} of {Math.max(1, totalPages)}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="px-3 py-1.5 bg-white border border-[#e5edf5] rounded-md text-navy disabled:opacity-50 hover:bg-gray-50 transition-colors shadow-sm font-semibold">«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 bg-white border border-[#e5edf5] rounded-md text-navy disabled:opacity-50 hover:bg-gray-50 transition-colors shadow-sm font-semibold">‹ Prev</button>
            <span className="px-4 py-1.5 bg-white border border-[#e5edf5] rounded-md text-primary font-bold shadow-sm">{page + 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 bg-white border border-[#e5edf5] rounded-md text-navy disabled:opacity-50 hover:bg-gray-50 transition-colors shadow-sm font-semibold">Next ›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 bg-white border border-[#e5edf5] rounded-md text-navy disabled:opacity-50 hover:bg-gray-50 transition-colors shadow-sm font-semibold">»</button>
          </div>
        </div>
      </div>
    </div>
  );
}
