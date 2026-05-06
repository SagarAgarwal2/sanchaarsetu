import { useEffect, useState } from 'react';
import type { Department } from '../lib/types';
import { listDepartments, updateDepartment } from '../lib/api';
import { RefreshCw, Zap, Radio, Database, Clock, CheckCircle2 } from 'lucide-react';

const STATUS_CFG: Record<Department['status'], { label: string; color: string; dot: string; bg: string; border: string }> = {
  active: { label: 'Active', color: 'text-success', dot: 'bg-success', bg: 'bg-success/10', border: 'border-success/20' },
  degraded: { label: 'Degraded', color: 'text-amber-500', dot: 'bg-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  offline: { label: 'Offline', color: 'text-danger', dot: 'bg-danger', bg: 'bg-danger/10', border: 'border-danger/20' },
  circuit_open: { label: 'Circuit Open', color: 'text-[#C53030]', dot: 'bg-[#C53030]', bg: 'bg-[#C53030]/10', border: 'border-[#C53030]/20' },
};

const TIER_CFG = [
  { tier: 1, label: 'Webhook', desc: 'Near real-time (<1s)', icon: Zap, color: 'text-success', bg: 'bg-success/10' },
  { tier: 2, label: 'Polling', desc: 'Configurable (1–15 min)', icon: Radio, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  { tier: 3, label: 'Snapshot', desc: 'Configurable (hourly)', icon: Database, color: 'text-orange-500', bg: 'bg-orange-500/10' },
];

const CONN_ICON = { webhook: Zap, polling: Radio, snapshot: Database };

const ALL_STATUSES: Department['status'][] = ['active', 'degraded', 'offline', 'circuit_open'];

function formatLastSync(ts: string | null) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
}

export default function Departments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Department | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const data = await listDepartments();
    setDepartments(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function setStatus(dept: Department, status: Department['status']) {
    setUpdating(dept.id);
    await updateDepartment(dept.id, status);
    await load();
    setSelected(prev => prev?.id === dept.id ? { ...prev, status } : prev);
    showToast(`${dept.code} status updated to ${STATUS_CFG[status].label}`);
    setUpdating(null);
  }

  const byTier = TIER_CFG.map(tc => ({
    ...tc,
    depts: departments.filter(d => d.ingestion_tier === tc.tier),
  }));

  const onlineCount = departments.filter(d => d.status === 'active').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {toast && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-white border border-success text-success text-[13px] font-semibold px-4 py-3 rounded-lg shadow-panel animate-slide-up">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}

      {/* Tier summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {byTier.map(tc => {
          const Icon = tc.icon;
          const activeInTier = tc.depts.filter(d => d.status === 'active').length;
          return (
            <div key={tc.tier} className="card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-1.5 rounded-md ${tc.bg}`}>
                  <Icon size={16} className={tc.color} />
                </div>
                <span className="text-[14px] font-bold text-navy">Tier {tc.tier} — {tc.label}</span>
              </div>
              <p className="text-[12px] text-body mb-4">{tc.desc}</p>
              <div className="flex items-end justify-between pt-2 border-t border-[#e5edf5]">
                <div>
                  <p className="text-[28px] font-semibold text-navy leading-none tabular-nums">{tc.depts.length}</p>
                  <p className="text-[11px] font-medium text-muted uppercase tracking-wider mt-1.5">systems</p>
                </div>
                <div className="text-right">
                  <p className="text-[20px] font-semibold text-success leading-none tabular-nums">{activeInTier}</p>
                  <p className="text-[11px] font-medium text-muted uppercase tracking-wider mt-1.5">online</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-6">
        {/* Department tables by tier */}
        <div className="flex-1 space-y-6 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw size={24} className="animate-spin text-body" />
            </div>
          ) : (
            byTier.map(({ tier, label, color, bg, depts }) => depts.length > 0 && (
              <div key={tier} className="card overflow-hidden">
                <div className="px-6 py-4 border-b border-[#e5edf5] flex items-center gap-3 bg-gray-50/50">
                  <div className={`p-1.5 rounded-md ${bg}`}>
                    {tier === 1 && <Zap size={14} className={color} />}
                    {tier === 2 && <Radio size={14} className={color} />}
                    {tier === 3 && <Database size={14} className={color} />}
                  </div>
                  <h2 className="text-[14px] font-bold text-navy">Tier {tier} — {label} Systems</h2>
                  <span className="text-[12px] text-muted font-medium ml-1">({depts.length})</span>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[#e5edf5] bg-gray-50/50">
                      {['System', 'Status', 'Connection', 'Last Sync', 'Records', 'Actions'].map(h => (
                        <th key={h} className="px-6 py-3.5 text-[11px] text-body font-bold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5edf5] bg-white">
                    {depts.map(dept => {
                      const sc = STATUS_CFG[dept.status];
                      const ConnIcon = CONN_ICON[dept.connection_type];
                      const isSelected = selected?.id === dept.id;
                      return (
                        <tr
                          key={dept.id}
                          onClick={() => setSelected(isSelected ? null : dept)}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : 'hover:bg-gray-50/50'}`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm ${sc.dot} ${dept.status === 'active' ? 'animate-pulse' : ''}`} />
                              <div>
                                <p className="font-bold text-navy text-[13px]">{dept.code}</p>
                                <p className="text-[11px] text-muted font-medium truncate max-w-[180px] mt-0.5">{dept.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[11px] px-2.5 py-1 rounded-full border font-bold ${sc.bg} ${sc.border} ${sc.color}`}>
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-body capitalize">
                              <ConnIcon size={12} className="flex-shrink-0 text-muted" />
                              {dept.connection_type}
                              {dept.poll_interval_minutes && <span className="text-muted ml-0.5">({dept.poll_interval_minutes}m)</span>}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-body">
                              <Clock size={12} className="text-muted" />
                              {formatLastSync(dept.last_sync_at)}
                            </span>
                          </td>
                          <td className="px-6 py-4 tabular-nums text-[13px] font-semibold text-navy">
                            {dept.records_synced.toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                              {ALL_STATUSES.filter(s => s !== dept.status).map(s => {
                                const cfg = STATUS_CFG[s];
                                return (
                                  <button
                                    key={s}
                                    disabled={updating === dept.id}
                                    onClick={() => setStatus(dept, s)}
                                    className={`text-[10px] px-2 py-1 rounded-md border font-bold transition-all disabled:opacity-40 bg-white ${cfg.color} ${cfg.border} hover:bg-gray-50`}
                                  >
                                    {cfg.label}
                                  </button>
                                );
                              })}
                              {updating === dept.id && <RefreshCw size={14} className="animate-spin text-body ml-2" />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 flex-shrink-0 animate-slide-left">
            <div className="card sticky top-6 shadow-panel border-[#e5edf5]">
              <div className="px-6 py-5 border-b border-[#e5edf5] flex items-start justify-between bg-gray-50 rounded-t-xl">
                <div>
                  <h3 className="font-bold text-navy text-[16px]">{selected.code}</h3>
                  <p className="text-[12px] text-body font-medium mt-1 pr-4">{selected.name}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted hover:text-navy text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-200 transition-colors -mt-1 -mr-2 bg-white border border-[#e5edf5]">×</button>
              </div>
              <div className="px-6 py-5 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Domain</p>
                    <p className="text-[13px] font-medium text-navy capitalize">{selected.domain.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Tier</p>
                    <p className="text-[13px] font-medium text-navy">Tier {selected.ingestion_tier}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Connection</p>
                    <p className="text-[13px] font-medium text-navy capitalize">{selected.connection_type}</p>
                  </div>
                  {selected.poll_interval_minutes && (
                    <div>
                      <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Poll Interval</p>
                      <p className="text-[13px] font-medium text-navy">{selected.poll_interval_minutes}m</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Last Sync</p>
                    <p className="text-[13px] font-medium text-navy">{formatLastSync(selected.last_sync_at)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Records</p>
                    <p className="text-[14px] font-bold text-primary tabular-nums">{selected.records_synced.toLocaleString()}</p>
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-lg border border-[#e5edf5]">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Current Status</p>
                  <span className={`inline-flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-full border font-bold ${STATUS_CFG[selected.status].bg} ${STATUS_CFG[selected.status].border} ${STATUS_CFG[selected.status].color}`}>
                    <span className={`w-2 h-2 rounded-full shadow-sm ${STATUS_CFG[selected.status].dot} ${selected.status === 'active' ? 'animate-pulse' : ''}`} />
                    {STATUS_CFG[selected.status].label}
                  </span>
                </div>

                <div className="pt-4 border-t border-[#e5edf5]">
                  <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3">Manual Override</p>
                  <div className="space-y-2">
                    {ALL_STATUSES.map(s => {
                      const cfg = STATUS_CFG[s];
                      const isActive = selected.status === s;
                      return (
                        <button
                          key={s}
                          disabled={isActive || updating === selected.id}
                          onClick={() => setStatus(selected, s)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md border text-[12px] font-bold transition-all disabled:opacity-50 ${
                            isActive
                              ? `${cfg.bg} ${cfg.border} ${cfg.color} cursor-default`
                              : 'bg-white border-[#e5edf5] text-body hover:border-gray-300 hover:text-navy hover:shadow-sm'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${cfg.dot} ${!isActive && 'opacity-60'}`} />
                          {cfg.label}
                          {isActive && <span className="ml-auto text-[10px] uppercase tracking-wider opacity-60">Active</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
