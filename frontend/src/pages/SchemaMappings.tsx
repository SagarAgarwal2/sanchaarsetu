import { useEffect, useState } from 'react';
import type { SchemaMapping, Department } from '../lib/types';
import { createSchemaMapping, listDepartments, listSchemaMappings, updateSchemaMapping } from '../lib/api';
import { CheckCircle2, XCircle, RefreshCw, Zap, Search, AlertCircle, Plus } from 'lucide-react';

const STATUS_CFG = {
  auto_mapped: { label: 'Auto-Mapped', color: 'text-cyan-600', bg: 'bg-cyan-600/10', border: 'border-cyan-600/20' },
  pending_review: { label: 'Pending Review', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  confirmed: { label: 'Confirmed', color: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
  rejected: { label: 'Rejected', color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
};

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(Number(score) * 100);
  const color = pct >= 85 ? '#15be53' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const label = pct >= 85 ? 'text-success' : pct >= 70 ? 'text-amber-500' : 'text-danger';
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={`text-[12px] font-bold tabular-nums w-10 text-right ${label}`}>{pct}%</span>
    </div>
  );
}

type AddForm = { department_id: string; sws_field: string; dept_field: string; confidence_score: string };

export default function SchemaMappings() {
  const [mappings, setMappings] = useState<SchemaMapping[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>({ department_id: '', sws_field: '', dept_field: '', confidence_score: '0.75' });
  const [adding, setAdding] = useState(false);

  async function load() {
    const [mRes, dRes] = await Promise.all([
      listSchemaMappings({ limit: 500 }),
      listDepartments(),
    ]);
    setMappings(mRes.data || []);
    setDepts(dRes || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function updateStatus(id: string, status: SchemaMapping['status']) {
    setUpdating(id);
    await updateSchemaMapping(id, {
      status,
      reviewed_by: ['confirmed', 'rejected'].includes(status) ? 'admin@sanchaarsetu.kar.gov.in' : null,
      reviewed_at: ['confirmed', 'rejected'].includes(status) ? new Date().toISOString() : null,
    });
    showToast(status === 'confirmed' ? 'Mapping confirmed — propagation active' : 'Mapping rejected');
    await load();
    setUpdating(null);
  }

  async function addMapping() {
    if (!addForm.department_id || !addForm.sws_field || !addForm.dept_field) return;
    const score = parseFloat(addForm.confidence_score);
    if (isNaN(score) || score < 0 || score > 1) return;
    setAdding(true);
    const autoStatus = score >= 0.85 ? 'auto_mapped' : 'pending_review';
    try {
      await createSchemaMapping({
        department_id: addForm.department_id,
        sws_field: addForm.sws_field.trim().toLowerCase().replace(/\s+/g, '_'),
        dept_field: addForm.dept_field.trim().toLowerCase().replace(/\s+/g, '_'),
        confidence_score: score,
      });
      showToast(`Added — ${autoStatus === 'auto_mapped' ? 'auto-mapped (≥85%)' : 'queued for review (<85%)'}`);
      setAddForm({ department_id: '', sws_field: '', dept_field: '', confidence_score: '0.75' });
      setShowAdd(false);
      await load();
    } catch (err) {
      showToast('Error: ' + (err instanceof Error ? err.message : 'unknown error'), 'error');
    }
    setAdding(false);
  }

  const deptMap: Record<string, Department> = {};
  depts.forEach(d => { deptMap[d.id] = d; });

  const filtered = mappings.filter(m => {
    if (selectedDept !== 'all' && m.department_id !== selectedDept) return false;
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    if (search && !m.sws_field.includes(search.toLowerCase()) && !m.dept_field.includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all: mappings.length,
    auto_mapped: mappings.filter(m => m.status === 'auto_mapped').length,
    pending_review: mappings.filter(m => m.status === 'pending_review').length,
    confirmed: mappings.filter(m => m.status === 'confirmed').length,
    rejected: mappings.filter(m => m.status === 'rejected').length,
  };

  const avgConf = mappings.length > 0
    ? (mappings.reduce((s, m) => s + Number(m.confidence_score), 0) / mappings.length * 100).toFixed(0)
    : '0';

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-2 border text-sm px-4 py-3 rounded-lg shadow-panel animate-slide-up font-medium ${
          toast.type === 'success' ? 'bg-white border-success text-success' : 'bg-white border-danger text-danger'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="card p-5">
          <p className="text-[12px] text-body font-medium uppercase tracking-wider">Avg Confidence</p>
          <p className="text-[28px] font-semibold text-navy mt-1 tabular-nums">{avgConf}%</p>
        </div>
        {Object.entries(STATUS_CFG).map(([key, cfg]) => (
          <div key={key} className={`border rounded-xl p-5 bg-white ${cfg.border} shadow-sm`}>
            <p className={`text-[12px] font-medium uppercase tracking-wider ${cfg.color}`}>{cfg.label}</p>
            <p className={`text-[28px] font-semibold mt-1 tabular-nums ${cfg.color}`}>{counts[key as keyof typeof counts]}</p>
          </div>
        ))}
      </div>

      {/* AI info */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-primary/10 rounded-lg border border-primary/20 flex-shrink-0">
            <Zap size={18} className="text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-navy">AI-Powered Semantic Mapping (Sentence Transformers + pgvector)</p>
            <p className="text-[13px] text-body mt-1 leading-relaxed max-w-3xl">
              Fields scoring ≥85% are auto-mapped. 70–84% require human confirmation. Below 70% are blocked.
              All mappings are versioned — schema changes trigger re-validation before propagation resumes.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-6 text-[12px] font-medium flex-wrap ml-[52px]">
          <span className="flex items-center gap-2 text-success"><span className="w-2.5 h-2.5 rounded-full bg-success inline-block shadow-sm" /> ≥85% Auto-mapped</span>
          <span className="flex items-center gap-2 text-amber-500"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shadow-sm" /> 70–84% Needs confirmation</span>
          <span className="flex items-center gap-2 text-danger"><span className="w-2.5 h-2.5 rounded-full bg-danger inline-block shadow-sm" /> &lt;70% Blocked</span>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="px-6 py-4 border-b border-[#e5edf5] flex items-center gap-4 flex-wrap bg-gray-50/50 rounded-t-xl">
          <h2 className="font-semibold text-navy text-[15px]">Mapping Registry</h2>
          <div className="flex gap-2 flex-wrap">
            {(['all', ...Object.keys(STATUS_CFG)] as const).map(s => {
              const cfg = STATUS_CFG[s as keyof typeof STATUS_CFG];
              return (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-all ${
                    filterStatus === s
                      ? s === 'all' ? 'bg-navy text-white border-navy shadow-sm' : `${cfg.bg} ${cfg.border} ${cfg.color} shadow-sm`
                      : 'bg-white text-body border-[#e5edf5] hover:border-gray-300 hover:text-navy'
                  }`}>
                  {s === 'all' ? `All (${counts.all})` : `${cfg.label} (${counts[s as keyof typeof counts]})`}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 ml-auto flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="text" placeholder="Search fields..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-white border border-[#e5edf5] rounded-md pl-9 pr-3 py-1.5 text-[12px] text-navy placeholder-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-48 shadow-sm transition-all" />
            </div>
            <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)}
              className="bg-white border border-[#e5edf5] rounded-md px-3 py-1.5 text-[12px] text-navy focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm transition-all cursor-pointer">
              <option value="all">All Depts</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
            </select>
            <button onClick={() => setShowAdd(s => !s)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-[12px] rounded-md hover:bg-primary-hover transition-colors font-semibold shadow-sm">
              <Plus size={14} />{showAdd ? 'Cancel' : 'Add Mapping'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="px-6 py-5 bg-gray-50 border-b border-[#e5edf5] animate-fade-in">
            <p className="text-[13px] font-bold text-navy mb-3">New Field Mapping</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <select value={addForm.department_id} onChange={e => setAddForm(f => ({ ...f, department_id: e.target.value }))}
                className="bg-white border border-[#e5edf5] rounded-md px-3 py-2 text-[13px] text-navy focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">
                <option value="">Select dept...</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name.split('(')[0].trim()}</option>)}
              </select>
              <input type="text" placeholder="SWS field (e.g. owner_name)" value={addForm.sws_field}
                onChange={e => setAddForm(f => ({ ...f, sws_field: e.target.value }))}
                className="bg-white border border-[#e5edf5] rounded-md px-3 py-2 text-[13px] text-navy placeholder-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm" />
              <input type="text" placeholder="Dept field (e.g. proprietor)" value={addForm.dept_field}
                onChange={e => setAddForm(f => ({ ...f, dept_field: e.target.value }))}
                className="bg-white border border-[#e5edf5] rounded-md px-3 py-2 text-[13px] text-navy placeholder-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm" />
              <input type="number" placeholder="Confidence (0–1)" value={addForm.confidence_score}
                min="0" max="1" step="0.01"
                onChange={e => setAddForm(f => ({ ...f, confidence_score: e.target.value }))}
                className="bg-white border border-[#e5edf5] rounded-md px-3 py-2 text-[13px] text-navy placeholder-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm" />
              <button onClick={addMapping} disabled={adding}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-success hover:bg-green-600 text-white text-[13px] rounded-md transition-colors font-bold disabled:opacity-50 shadow-sm">
                {adding ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Add Mapping
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5edf5] bg-gray-50/50">
                {['SWS Field', 'Dept', 'Department Field', 'Confidence', 'Ver.', 'Status', 'Reviewed By', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-[11px] text-body font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5edf5] bg-white rounded-b-xl">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center"><RefreshCw size={24} className="animate-spin text-body mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-body text-[14px]">No mappings found</td></tr>
              ) : filtered.map(m => {
                const scfg = STATUS_CFG[m.status];
                const dept = deptMap[m.department_id];
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <code className="text-[12px] font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-md">{m.sws_field}</code>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] font-medium text-navy bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-md font-mono">{dept?.code || '—'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-[12px] font-semibold text-cyan-700 bg-cyan-600/10 px-2.5 py-1 rounded-md">{m.dept_field}</code>
                    </td>
                    <td className="px-6 py-4">
                      <ConfidenceBar score={Number(m.confidence_score)} />
                    </td>
                    <td className="px-6 py-4">
                      <span
                        title={`Schema version ${m.version}. Version increments when department schema changes and triggers re-validation.`}
                        className="inline-flex items-center text-[11px] font-bold text-navy bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md font-mono cursor-default"
                      >
                        v{m.version}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${scfg.bg} ${scfg.border} ${scfg.color}`}>
                        {scfg.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {m.reviewed_by
                        ? <span className="text-[12px] font-medium text-body">{m.reviewed_by.split('@')[0]}</span>
                        : <span className="text-[12px] text-muted">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {(m.status === 'pending_review' || m.status === 'auto_mapped') && (
                          <button disabled={updating === m.id} onClick={() => updateStatus(m.id, 'confirmed')}
                            title="Confirm" className="p-1.5 text-success hover:bg-success/10 rounded-md transition-colors disabled:opacity-50">
                            <CheckCircle2 size={16} />
                          </button>
                        )}
                        {m.status !== 'rejected' && m.status !== 'confirmed' && (
                          <button disabled={updating === m.id} onClick={() => updateStatus(m.id, 'rejected')}
                            title="Reject" className="p-1.5 text-danger hover:bg-danger/10 rounded-md transition-colors disabled:opacity-50">
                            <XCircle size={16} />
                          </button>
                        )}
                        {m.status === 'confirmed' && (
                          <button disabled={updating === m.id} onClick={() => updateStatus(m.id, 'pending_review')}
                            className="px-2 py-1 text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors disabled:opacity-50 text-[11px] font-bold border border-transparent hover:border-amber-500/20">
                            Re-review
                          </button>
                        )}
                        {m.status === 'rejected' && (
                          <button disabled={updating === m.id} onClick={() => updateStatus(m.id, 'pending_review')}
                            className="px-2 py-1 text-body hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-md transition-colors disabled:opacity-50 text-[11px] font-bold">
                            Restore
                          </button>
                        )}
                        {updating === m.id && <RefreshCw size={14} className="animate-spin text-body" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
