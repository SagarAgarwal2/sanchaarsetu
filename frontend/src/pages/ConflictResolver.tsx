import { useEffect, useState } from 'react';
import type { Conflict, Department } from '../lib/types';
import { listConflicts, listDepartments, resolveConflict } from '../lib/api';
import {
  AlertTriangle, CheckCircle2, Clock, RefreshCw, Shield, Info,
  GitMerge, Check, X
} from 'lucide-react';

const POLICY_CFG = {
  sws_wins: {
    label: 'SWS Wins',
    color: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/20',
    desc: 'SWS is authoritative. SWS value is applied; department update is logged.',
  },
  last_write_wins: {
    label: 'Last-Write Wins',
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    desc: 'The update with the most recent timestamp is applied. Used for low-criticality fields.',
  },
  manual_review: {
    label: 'Manual Review',
    color: 'text-warning',
    bg: 'bg-warning/10',
    border: 'border-warning/20',
    desc: 'Both updates held. Human must select the correct value. For PAN, GSTIN, signatory.',
  },
};

const STATUS_CFG = {
  open: { label: 'Open', color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
  pending_review: { label: 'Pending Review', color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20' },
  resolved: { label: 'Resolved', color: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
};

const HIGH_STAKES = ['pan_number', 'gstin', 'signatory_name', 'signatory_update'];

export default function ConflictResolver() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [deptMap, setDeptMap] = useState<Record<string, Department>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'pending_review' | 'resolved'>('all');
  const [resolving, setResolving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  async function load() {
    const [cRes, dRes] = await Promise.all([
      listConflicts({ status: filter === 'all' ? undefined : filter, limit: 500 }),
      listDepartments(),
    ]);
    const map: Record<string, Department> = {};
    (dRes || []).forEach(d => { map[d.id] = d; });
    setDeptMap(map);
    setConflicts(cRes.data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function resolve(id: string, winValue: string, source: 'sws' | 'dept' | 'dismiss') {
    const conflict = conflicts.find(c => c.id === id);
    const dept = conflict?.source_department_id ? deptMap[conflict.source_department_id] : null;
    const policyLabel = conflict ? POLICY_CFG[conflict.resolution_policy].label : 'Manual Review';
    const customReason = (reasonDraft[id] || '').trim();

    let reason: string;
    if (source === 'sws') {
      reason = customReason || `SWS value accepted for field "${conflict?.field_name}". Department value from ${dept?.code || 'unknown'} was discarded. Policy: ${policyLabel}. Resolved by admin.`;
    } else if (source === 'dept') {
      reason = customReason || `Department value from ${dept?.code || 'unknown'} accepted for field "${conflict?.field_name}". SWS value was discarded. Policy: ${policyLabel}. Resolved by admin.`;
    } else {
      reason = customReason || `Conflict for field "${conflict?.field_name}" dismissed without selecting a winner. No write performed.`;
    }

    setResolving(id);
    await resolveConflict(id, {
      winning_value: winValue || null,
      resolved_by: 'admin@sanchaarsetu.kar.gov.in',
      resolution_reason: reason,
    });
    setReasonDraft(prev => { const n = { ...prev }; delete n[id]; return n; });
    showToast('Conflict resolved and written to Audit Store');
    await load();
    setResolving(null);
  }

  async function autoResolveAll() {
    const open = conflicts.filter(c => c.status === 'open' && c.resolution_policy === 'sws_wins');
    for (const c of open) {
      const dept = c.source_department_id ? deptMap[c.source_department_id] : null;
      await resolveConflict(c.id, {
        winning_value: c.sws_value,
        resolved_by: 'system:sws_wins_policy',
        resolution_reason: `SWS value accepted for field "${c.field_name}" via SWS-wins policy (auto-resolution). Department value from ${dept?.code || 'unknown'} was discarded. SWS is authoritative for this field.`,
      });
    }
    showToast(`Auto-resolved ${open.length} SWS-wins conflict${open.length !== 1 ? 's' : ''}`);
    await load();
  }

  const filtered = conflicts.filter(c => filter === 'all' || c.status === filter);
  const counts = {
    all: conflicts.length,
    open: conflicts.filter(c => c.status === 'open').length,
    pending_review: conflicts.filter(c => c.status === 'pending_review').length,
    resolved: conflicts.filter(c => c.status === 'resolved').length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-white border border-success text-success text-sm px-4 py-3 rounded-lg shadow-panel animate-slide-up font-medium">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { key: 'open', label: 'Open', icon: AlertTriangle, color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
          { key: 'pending_review', label: 'Pending Review', icon: Clock, color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20' },
          { key: 'resolved', label: 'Resolved', icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
          { key: 'all', label: 'Total', icon: GitMerge, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.key} className="card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] text-body font-medium uppercase tracking-wider">{card.label}</p>
                  <p className="text-[28px] font-semibold mt-1 tabular-nums text-navy">
                    {counts[card.key as keyof typeof counts]}
                  </p>
                </div>
                <div className={`p-2.5 rounded-md ${card.bg}`}>
                  <Icon size={20} className={card.color} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Policy legend */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-navy">Resolution Policies</h2>
          {counts.open > 0 && (
            <button
              onClick={autoResolveAll}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-[13px] rounded-md transition-colors font-medium"
            >
              <Check size={14} /> Auto-resolve SWS-wins ({conflicts.filter(c => c.status === 'open' && c.resolution_policy === 'sws_wins').length})
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(POLICY_CFG).map(([key, cfg]) => (
            <div key={key} className={`border rounded-lg p-4 bg-white ${cfg.border} shadow-sm`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-md ${cfg.bg}`}>
                  <Shield size={14} className={cfg.color} />
                </div>
                <span className={`text-[13px] font-bold ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className="text-[12px] text-body leading-relaxed">{cfg.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Conflict queue */}
      <div className="card flex flex-col h-full min-h-[500px]">
        <div className="px-6 py-4 border-b border-[#e5edf5] flex items-center gap-4 flex-wrap bg-gray-50/50 rounded-t-lg">
          <h2 className="font-semibold text-navy text-[15px]">Conflict Queue</h2>
          <div className="flex gap-2 ml-auto">
            {(['all', 'open', 'pending_review', 'resolved'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-all capitalize ${
                  filter === s ? 'bg-navy text-white border-navy shadow-sm' : 'bg-white text-body border-[#e5edf5] hover:border-gray-300 hover:text-navy'
                }`}
              >
                {s.replace('_', ' ')} ({counts[s]})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center flex-1 py-12"><RefreshCw size={20} className="animate-spin text-body" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-16 gap-3 text-body">
            <div className="p-4 bg-gray-50 rounded-full">
              <Info size={24} className="text-muted" />
            </div>
            <p className="text-[14px] font-medium text-navy">No conflicts in this category</p>
            <p className="text-[12px]">All systems are currently synchronized.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e5edf5]">
            {filtered.map(conflict => {
              const pcfg = POLICY_CFG[conflict.resolution_policy];
              const scfg = STATUS_CFG[conflict.status];
              const dept = conflict.source_department_id ? deptMap[conflict.source_department_id] : null;
              const isHighStakes = HIGH_STAKES.includes(conflict.field_name);

              return (
                <div key={conflict.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-6 flex-wrap lg:flex-nowrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap mb-3">
                        <code className="text-[13px] font-bold text-navy bg-gray-100 px-2 py-0.5 rounded">{conflict.ubid}</code>
                        <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${scfg.bg} ${scfg.border} ${scfg.color}`}>
                          {scfg.label}
                        </span>
                        <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${pcfg.bg} ${pcfg.border} ${pcfg.color}`}>
                          {pcfg.label}
                        </span>
                        {isHighStakes && (
                          <span className="text-[11px] px-2.5 py-0.5 rounded-full border font-semibold bg-danger/10 border-danger/20 text-danger flex items-center gap-1">
                            <AlertTriangle size={10} /> High-Stakes Field
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mb-4 text-[12px] text-body flex-wrap bg-gray-50 px-3 py-2 rounded-md border border-[#e5edf5]">
                        <span>Field: <code className="text-navy font-semibold">{conflict.field_name}</code></span>
                        {dept && <span>· Dept: <span className="text-navy font-semibold">{dept.code}</span></span>}
                        <span>· {new Date(conflict.created_at).toLocaleString('en-IN')}</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className={`rounded-lg p-4 border transition-all ${
                          conflict.status === 'resolved' && conflict.winning_value === conflict.sws_value
                            ? 'border-success/40 bg-success/5 ring-1 ring-success/20'
                            : 'border-[#e5edf5] bg-white shadow-sm'
                        }`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-primary" />
                              <span className="text-[12px] font-semibold text-navy uppercase tracking-wide">SWS Value</span>
                            </div>
                            {conflict.status === 'resolved' && conflict.winning_value === conflict.sws_value && (
                              <span className="text-[11px] text-success flex items-center gap-1 font-bold bg-success/10 px-2 py-0.5 rounded"><Check size={12} /> Winner</span>
                            )}
                          </div>
                          <p className="text-[14px] text-navy font-medium leading-relaxed bg-gray-50 px-3 py-2 rounded border border-gray-100">{conflict.sws_value || '—'}</p>
                        </div>

                        <div className={`rounded-lg p-4 border transition-all ${
                          conflict.status === 'resolved' && conflict.winning_value === conflict.dept_value
                            ? 'border-success/40 bg-success/5 ring-1 ring-success/20'
                            : 'border-[#e5edf5] bg-white shadow-sm'
                        }`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-cyan-600" />
                              <span className="text-[12px] font-semibold text-navy uppercase tracking-wide">Department Value</span>
                            </div>
                            {conflict.status === 'resolved' && conflict.winning_value === conflict.dept_value && (
                              <span className="text-[11px] text-success flex items-center gap-1 font-bold bg-success/10 px-2 py-0.5 rounded"><Check size={12} /> Winner</span>
                            )}
                          </div>
                          <p className="text-[14px] text-navy font-medium leading-relaxed bg-gray-50 px-3 py-2 rounded border border-gray-100">{conflict.dept_value || '—'}</p>
                        </div>
                      </div>

                      {conflict.status === 'resolved' && (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center gap-2 text-[12px] text-body bg-success/5 border border-success/10 px-3 py-2 rounded-md">
                            <CheckCircle2 size={14} className="text-success" />
                            <span>Resolved by <span className="text-navy font-semibold">{conflict.resolved_by}</span></span>
                            {conflict.resolved_at && <span className="text-muted">· {new Date(conflict.resolved_at).toLocaleString('en-IN')}</span>}
                          </div>
                          {conflict.resolution_reason && (
                            <div className="bg-gray-50 border border-[#e5edf5] rounded-md px-4 py-3">
                              <p className="text-[11px] text-muted uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-1">
                                <Info size={11} /> Resolution Reason
                              </p>
                              <p className="text-[12px] text-navy leading-relaxed">{conflict.resolution_reason}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {conflict.status !== 'resolved' && (
                      <div className="flex flex-col gap-2.5 flex-shrink-0 w-full lg:w-[220px] bg-gray-50 p-4 rounded-lg border border-[#e5edf5]">
                        <p className="text-[11px] text-navy uppercase tracking-wide font-bold mb-1">Manual Resolution</p>
                        <textarea
                          rows={2}
                          placeholder="Optional reason or note..."
                          value={reasonDraft[conflict.id] || ''}
                          onChange={e => setReasonDraft(prev => ({ ...prev, [conflict.id]: e.target.value }))}
                          className="w-full bg-white border border-[#e5edf5] rounded-md px-3 py-2 text-[12px] text-navy placeholder-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
                        />
                        <button
                          disabled={resolving === conflict.id}
                          onClick={() => resolve(conflict.id, conflict.sws_value || '', 'sws')}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white text-[12px] rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50 font-medium shadow-sm"
                        >
                          <Check size={14} /> Accept SWS Value
                        </button>
                        <button
                          disabled={resolving === conflict.id}
                          onClick={() => resolve(conflict.id, conflict.dept_value || '', 'dept')}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-[#e5edf5] text-navy text-[12px] rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 font-medium shadow-sm"
                        >
                          <Check size={14} /> Accept Dept Value
                        </button>
                        <div className="h-px bg-[#e5edf5] my-1" />
                        <button
                          disabled={resolving === conflict.id}
                          onClick={() => resolve(conflict.id, '', 'dismiss')}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-muted hover:text-danger text-[12px] rounded-md transition-colors disabled:opacity-50 font-medium"
                        >
                          <X size={14} /> Dismiss Conflict
                        </button>
                        {resolving === conflict.id && <RefreshCw size={14} className="animate-spin text-primary mx-auto mt-2" />}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
