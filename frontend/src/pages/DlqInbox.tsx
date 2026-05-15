import { useEffect, useState } from 'react';
import type { DlqMessage } from '../lib/types';
import { listDlq, replayDlq } from '../lib/api';
import { RefreshCw, Search, Inbox, Play, AlertCircle } from 'lucide-react';

export default function DlqInbox() {
  const [messages, setMessages] = useState<DlqMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [replaying, setReplaying] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, total } = await listDlq();
    setMessages(data || []);
    setTotal(total || 0);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = messages.filter(m =>
    search === '' ||
    m.ubid.toLowerCase().includes(search.toLowerCase()) ||
    m.event_type.toLowerCase().includes(search.toLowerCase()) ||
    m.source_system.toLowerCase().includes(search.toLowerCase()) ||
    m.destination_system.toLowerCase().includes(search.toLowerCase())
  );

  async function handleReplay(id: string) {
    if (!confirm('Replay this DLQ message? It will be re-inserted into the propagation pipeline.')) return;
    setReplaying(id);
    try {
      await replayDlq(id);
      await load();
    } catch (err: any) {
      alert(`Replay failed: ${err.message}`);
    } finally {
      setReplaying(null);
    }
  }

  const formatDate = (ts: string) => {
    const dateTs = ts.endsWith('Z') || ts.includes('+') ? ts : `${ts}Z`;
    return new Date(dateTs).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4 card px-6 py-4 border-l-4 border-l-danger bg-danger/5">
        <Inbox size={18} className="text-danger flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[14px] font-bold text-navy">Dead Letter Queue (DLQ)</p>
          <p className="text-[12px] text-body mt-1 leading-relaxed">
            Messages that permanently failed delivery after exhausting all exponential backoff retries. Review the payloads and manually replay them into the pipeline once the downstream system recovers.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[280px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="Search UBID, event, system..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-[#e5edf5] rounded-md pl-10 pr-4 py-2 text-[13px] text-navy placeholder-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary shadow-sm transition-all" />
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-50 border border-[#e5edf5] rounded-md text-[13px] text-navy font-medium transition-colors shadow-sm ml-auto">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e5edf5] bg-gray-50">
                {['Timestamp', 'UBID', 'Event Type', 'Source → Dest', 'Payload', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-4 text-[11px] text-body font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5edf5] bg-white">
              {loading ? (
                <tr><td colSpan={6} className="py-16 text-center"><RefreshCw size={24} className="animate-spin text-body mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center text-body text-[14px]">No messages in the DLQ</td></tr>
              ) : (
                filtered.map(msg => (
                  <tr key={msg.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-[12px] text-muted font-medium whitespace-nowrap">{formatDate(msg.created_at)}</td>
                    <td className="px-6 py-4">
                      <code className="text-[13px] text-navy font-semibold font-mono">{msg.ubid}</code>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] text-navy font-medium capitalize">{msg.event_type.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[12px] flex items-center">
                        <span className="text-navy font-medium font-mono bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md">{msg.source_system}</span>
                        <span className="text-muted mx-2">→</span>
                        <span className="text-navy font-medium font-mono bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md">{msg.destination_system}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-[11px] text-muted font-mono max-w-[200px] truncate block bg-gray-50 p-1 border rounded" title={typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload)}>
                        {typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload)}
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleReplay(msg.id)}
                        disabled={replaying === msg.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-primary/5 text-primary border border-primary/20 hover:border-primary rounded text-[12px] font-semibold transition-colors disabled:opacity-50"
                      >
                        {replaying === msg.id ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                        Replay
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-[#e5edf5] bg-gray-50 flex items-center justify-between text-[12px] text-body font-medium">
          <span>{total.toLocaleString()} total messages in DLQ</span>
        </div>
      </div>
    </div>
  );
}
