import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, GitBranch, AlertTriangle, Map, ScrollText,
  Building2, ChevronLeft, ChevronRight, Activity, Shield,
  Play, Square, Zap, RefreshCw, Inbox, Database
} from 'lucide-react';
import { simulateEvent, simulateBurst, simulateChange } from '../lib/simulator';

type Page = 'dashboard' | 'events' | 'conflicts' | 'mappings' | 'audit' | 'dlq' | 'departments';

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'events', label: 'Live Event Feed', icon: Activity },
  { id: 'conflicts', label: 'Conflict Resolver', icon: AlertTriangle },
  { id: 'mappings', label: 'Schema Mappings', icon: Map },
  { id: 'audit', label: 'Audit Trail', icon: ScrollText },
  { id: 'dlq', label: 'DLQ Inbox', icon: Inbox },
  { id: 'departments', label: 'Department Systems', icon: Building2 },
];

interface LayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onTick: () => void;
  children: React.ReactNode;
}

export default function Layout({ currentPage, onNavigate, onTick, children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(2000);
  const [burstLoading, setBurstLoading] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (simRunning) {
      intervalRef.current = setInterval(async () => {
        await simulateEvent();
        setEventCount(c => c + 1);
        onTick();
      }, simSpeed);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [simRunning, simSpeed, onTick]);

  async function handleBurst() {
    setBurstLoading(true);
    await simulateBurst(8);
    setEventCount(c => c + 8);
    onTick();
    setBurstLoading(false);
  }

  const [legacyLoading, setLegacyLoading] = useState(false);
  async function handleLegacyChange() {
    setLegacyLoading(true);
    const ubid = `UBID-LGCY-${Math.floor(Math.random()*10000).toString().padStart(4, '0')}`;
    await simulateChange({
      department: "factories",
      ubid: ubid,
      event_type: "address_update",
      payload: { registered_address: "123 Legacy St, Detected via Polling" }
    });
    setEventCount(c => c + 1);
    onTick();
    setLegacyLoading(false);
  }

  return (
    <div className="flex h-screen bg-[#f8fafc] text-navy overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-[#e5edf5] bg-white transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'} shadow-[0px_4px_12px_rgba(0,0,0,0.02)] z-20`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[#e5edf5] min-h-[68px]">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <GitBranch size={16} className="text-white" />
          </div>
          {!collapsed && (
            <div>
              <p className="font-bold text-[14px] text-brand-dark leading-tight tracking-tight">SanchaarSetu</p>
              <p className="text-[11px] text-body leading-tight mt-0.5">Interoperability Layer</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-[13px] font-medium transition-all ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-body hover:text-navy hover:bg-gray-50'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={16} className="flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Simulator controls */}
        {!collapsed && (
          <div className="px-4 pb-4 space-y-3 border-t border-[#e5edf5] pt-4 bg-gray-50/50">
            <p className="text-[10px] text-body uppercase tracking-widest font-semibold">Simulator</p>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-body">
                <span>Speed</span>
                <span>{simSpeed / 1000}s interval</span>
              </div>
              <input
                type="range" min={500} max={5000} step={500}
                value={simSpeed}
                onChange={e => setSimSpeed(Number(e.target.value))}
                className="w-full h-1.5 accent-primary cursor-pointer bg-gray-200 rounded-full appearance-none"
              />
            </div>

            <button
              onClick={() => setSimRunning(r => !r)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                simRunning
                  ? 'bg-danger/10 text-danger hover:bg-danger/20'
                  : 'bg-success/10 text-success hover:bg-success/20'
              }`}
            >
              {simRunning
                ? <><Square size={14} fill="currentColor" /> Stop</>
                : <><Play size={14} fill="currentColor" /> Start</>}
            </button>

            <button
              onClick={handleBurst}
              disabled={burstLoading || legacyLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-warning/10 text-warning hover:bg-warning/20 disabled:opacity-50 transition-colors"
            >
              {burstLoading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
              Inject 8 Events
            </button>
            
            <button
              onClick={handleLegacyChange}
              disabled={burstLoading || legacyLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 disabled:opacity-50 transition-colors"
            >
              {legacyLoading ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
              Simulate Legacy Poll
            </button>

            {eventCount > 0 && (
              <p className="text-[11px] text-body text-center">+{eventCount} events this session</p>
            )}
          </div>
        )}

        {/* System status + collapse */}
        <div className="px-3 pb-3 pt-3 border-t border-[#e5edf5] bg-gray-50">
          {!collapsed && (
            <div className="px-3 py-2.5 rounded-md bg-white border border-[#e5edf5] mb-2 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="relative w-2 h-2">
                  <div className={`w-2 h-2 rounded-full ${simRunning ? 'bg-success' : 'bg-body'}`} />
                  {simRunning && <div className="absolute inset-0 rounded-full bg-success animate-ping-slow" />}
                </div>
                <span className="text-[11px] text-navy font-medium">
                  {simRunning ? 'Simulation Active' : 'System Idle'}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center px-3 py-2 rounded-md text-body hover:text-navy hover:bg-white border border-transparent hover:border-[#e5edf5] transition-all"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto relative">
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-[#e5edf5] px-6 py-4 flex items-center justify-between shadow-sm">
          <div>
            <h1 className="text-[18px] font-semibold text-navy tracking-tight">
              {navItems.find(n => n.id === currentPage)?.label}
            </h1>
            <p className="text-[12px] text-body mt-0.5 font-medium">Karnataka Single Window System · SanchaarSetu Interoperability Layer</p>
          </div>
          <div className="flex items-center gap-3">
            {simRunning && (
              <div className="flex items-center gap-2 text-[12px] font-medium text-success bg-success/10 px-3 py-1.5 rounded-full">
                <div className="relative w-1.5 h-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-success" />
                  <div className="absolute inset-0 rounded-full bg-success animate-ping-slow" />
                </div>
                <span>Live Simulation</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-body bg-gray-100 border border-[#e5edf5] px-3 py-1.5 rounded-full">
              <Shield size={12} className="text-primary" />
              <span>mTLS · TLS 1.3</span>
            </div>
          </div>
        </header>

        <div className="p-6 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
