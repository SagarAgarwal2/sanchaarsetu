import { useState, useCallback } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EventFeed from './pages/EventFeed';
import ConflictResolver from './pages/ConflictResolver';
import SchemaMappings from './pages/SchemaMappings';
import AuditTrail from './pages/AuditTrail';
import Departments from './pages/Departments';

type Page = 'dashboard' | 'events' | 'conflicts' | 'mappings' | 'audit' | 'departments';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleTick = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  function renderPage() {
    switch (page) {
      case 'dashboard': return <Dashboard key={refreshKey} />;
      case 'events': return <EventFeed key={refreshKey} />;
      case 'conflicts': return <ConflictResolver key={refreshKey} />;
      case 'mappings': return <SchemaMappings key={refreshKey} />;
      case 'audit': return <AuditTrail key={refreshKey} />;
      case 'departments': return <Departments key={refreshKey} />;
    }
  }

  return (
    <Layout currentPage={page} onNavigate={setPage} onTick={handleTick}>
      {renderPage()}
    </Layout>
  );
}
