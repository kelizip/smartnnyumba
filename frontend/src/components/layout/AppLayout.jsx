import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar  from './Topbar';

export default function AppLayout({ title, actions, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--surface-muted)' }}>

      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main column */}
      <div style={{ marginLeft: 'var(--sidebar-w)', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100vh', overflow: 'hidden' }}
        className="lg:ml-[--sidebar-w] ml-0">

        <Topbar title={title} actions={actions} onMenuClick={() => setSidebarOpen(true)} />

        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ padding: '1.5rem', maxWidth: 1400 }}>
            {children}
          </div>
        </main>

      </div>
    </div>
  );
}
