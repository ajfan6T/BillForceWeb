import { useState } from 'react';
import { Cloud, CloudCheck, CloudOff, RefreshCw, Database, ExternalLink, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { useSupabaseSync } from '../hooks/useSupabaseSync';
import { Modal } from './modal';
import { Button } from './ui';
import { useNavigate } from 'react-router';

export function SupabaseBadge() {
  const { configured, connected, status, lastSyncedAt, loading, syncNow, supabaseUser, stats } = useSupabaseSync();
  const [open, setOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSync = async () => {
    setSyncMsg(null);
    const res = await syncNow();
    setSyncMsg(res.message);
  };

  const getStatusDisplay = () => {
    if (loading || status === 'syncing') {
      return {
        label: 'Syncing...',
        className: 'badge-syncing',
        icon: <RefreshCw size={13} className="spin-icon" />,
      };
    }
    if (!configured) {
      return {
        label: 'Local ERP',
        className: 'badge-offline',
        icon: <CloudOff size={13} />,
      };
    }
    if (connected || status === 'synced') {
      return {
        label: 'Supabase Cloud',
        className: 'badge-online',
        icon: <CloudCheck size={13} />,
      };
    }
    return {
      label: 'Cloud Offline',
      className: 'badge-warning',
      icon: <CloudOff size={13} />,
    };
  };

  const info = getStatusDisplay();

  return (
    <>
      <button
        type="button"
        className={`supabase-top-badge ${info.className}`}
        onClick={() => setOpen(true)}
        title="Supabase Online Cloud Synchronization & Auth"
      >
        {info.icon}
        <span>{info.label}</span>
      </button>

      {open && (
        <Modal
          open={open}
          title="Supabase Cloud Synchronization & Auth"
          onClose={() => {
            setOpen(false);
            setSyncMsg(null);
          }}
          width={520}
        >
          <div className="supabase-modal-content">
            <div className="supabase-status-banner">
              <div className="banner-icon-box">
                {configured && (connected || status === 'synced') ? (
                  <CloudCheck size={28} className="text-success" />
                ) : (
                  <Cloud size={28} className="text-primary" />
                )}
              </div>
              <div className="banner-details">
                <h4>
                  {configured
                    ? connected || status === 'synced'
                      ? 'Connected to Supabase'
                      : 'Connecting to Cloud...'
                    : 'Supabase Not Configured'}
                </h4>
                <p>
                  {configured
                    ? lastSyncedAt
                      ? `Last synchronized: ${new Date(lastSyncedAt).toLocaleTimeString()}`
                      : 'Never synchronized yet'
                    : 'Configure your Supabase project URL and API key to enable online synchronization.'}
                </p>
              </div>
            </div>

            {supabaseUser && (
              <div className="supabase-user-box">
                <ShieldCheck size={18} className="text-success" />
                <div>
                  <strong>Authenticated Supabase User:</strong>
                  <div className="text-muted">{supabaseUser.email || supabaseUser.id}</div>
                </div>
              </div>
            )}

            {syncMsg && (
              <div className={`sync-alert ${syncMsg.includes('failed') ? 'alert-danger' : 'alert-success'}`}>
                {syncMsg.includes('failed') ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{syncMsg}</span>
              </div>
            )}

            {stats && (
              <div className="sync-stats-grid">
                <div className="stat-pill">
                  <span className="stat-num">{stats.bills}</span>
                  <span className="stat-label">Bills</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-num">{stats.customers}</span>
                  <span className="stat-label">Customers</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-num">{stats.items}</span>
                  <span className="stat-label">Items</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-num">{stats.purchases}</span>
                  <span className="stat-label">Purchases</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-num">{stats.accounts}</span>
                  <span className="stat-label">Accounts</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-num">{stats.journals}</span>
                  <span className="stat-label">Journals</span>
                </div>
              </div>
            )}

            <div className="modal-actions-bar">
              <Button
                variant="primary"
                onClick={handleSync}
                disabled={loading || !configured}
              >
                <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
                <span>{loading ? 'Synchronizing...' : 'Sync Now'}</span>
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  navigate('/settings/supabase');
                }}
              >
                <Database size={15} />
                <span>Configure Settings</span>
                <ExternalLink size={13} />
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
