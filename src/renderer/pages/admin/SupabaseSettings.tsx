import { useState, useEffect } from 'react';
import {
  Cloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Database,
  Key,
  Globe,
  Copy,
  Check,
  ShieldCheck,
  User,
  Lock,
  LogIn,
  LogOut,
  UserPlus,
  Server,
  Zap,
} from 'lucide-react';
import { Page, PageHeader, Card, Button } from '../../components/ui';
import { useSupabaseSync } from '../../hooks/useSupabaseSync';
import {
  getClientConfig,
  saveCloudConfig,
  testConnection,
  getPostgresSchemaSql,
  signInWithSupabase,
  signUpWithSupabase,
  signOutSupabase,
} from '../../supabase';
import { useToast } from '../../feedback';

export function SupabaseSettingsPage() {
  const toast = useToast();
  const { configured, connected, status, lastSyncedAt, loading, syncNow, supabaseUser, refresh, stats } = useSupabaseSync();

  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [showKey, setShowKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);

  const [saving, setSaving] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Auth form state
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // SQL schema state
  const [schemaSql, setSchemaSql] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const cfg = getClientConfig();
    setUrl(cfg.url || '');
    setAnonKey(cfg.anonKey || '');
    setAutoSync(cfg.autoSync !== false);

    getPostgresSchemaSql().then((sql) => {
      setSchemaSql(sql);
    });
  }, []);

  const handleTest = async () => {
    if (!url.trim() || !anonKey.trim()) {
      toast.warning('Enter both Supabase URL and Anon Key');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection({ url: url.trim(), anonKey: anonKey.trim() });
      setTestResult(res);
      if (res.success) {
        toast.success('Connection to Supabase successful!');
      } else {
        toast.error('Connection failed');
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await saveCloudConfig({
        url: url.trim(),
        anonKey: anonKey.trim(),
        autoSync,
      });
      if (res.ok) {
        toast.success('Supabase configuration saved!');
        refresh();
      } else {
        toast.error(res.error || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncResult(null);
    try {
      const res = await syncNow();
      setSyncResult(res.message);
      if (res.success) {
        toast.success('Data synchronized with Supabase!');
      } else {
        toast.warning('Sync encountered errors');
      }
    } catch (e: any) {
      setSyncResult(e.message);
      toast.error('Sync failed');
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError('Email and password required');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (isSignUp) {
        await signUpWithSupabase(authEmail.trim(), authPassword.trim());
        toast.success('Registration successful! Check your email if verification is required.');
      } else {
        await signInWithSupabase(authEmail.trim(), authPassword.trim());
        toast.success('Signed in with Supabase!');
      }
      setAuthEmail('');
      setAuthPassword('');
      refresh();
    } catch (e: any) {
      setAuthError(e.message || 'Authentication failed');
      toast.error(e.message || 'Authentication error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutSupabase();
      toast.info('Signed out from Supabase');
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(schemaSql);
    setCopied(true);
    toast.success('Supabase SQL schema copied to clipboard!');
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Page>
      <PageHeader
        title="Supabase Cloud Synchronization"
        subtitle="Transform Billforce from offline to online with seamless Supabase database synchronization and user authentication"
        actions={
          <Button variant="primary" onClick={handleSync} disabled={loading || !configured}>
            <RefreshCw size={16} className={loading ? 'spin-icon' : ''} />
            <span>{loading ? 'Synchronizing...' : 'Sync Now'}</span>
          </Button>
        }
      />

      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Left Column: Connection & Auth */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Status Banner Card */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '4px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  background: configured && (connected || status === 'synced') ? 'var(--success-soft)' : 'var(--warning-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: configured && (connected || status === 'synced') ? 'var(--success)' : 'var(--warning)',
                }}
              >
                {configured && (connected || status === 'synced') ? <Cloud size={26} /> : <Server size={26} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '17px' }}>
                    {configured
                      ? connected || status === 'synced'
                        ? 'Supabase Cloud Connected'
                        : 'Connecting to Supabase...'
                      : 'Offline Mode (Local SQLite)'}
                  </h3>
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: configured && (connected || status === 'synced') ? 'var(--success-soft)' : 'var(--primary-soft)',
                      color: configured && (connected || status === 'synced') ? 'var(--success)' : 'var(--primary-text)',
                    }}
                  >
                    {configured ? 'Online Cloud' : 'Local Only'}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', color: 'var(--text-2)', fontSize: '13.5px' }}>
                  {lastSyncedAt
                    ? `Last synchronized with Supabase: ${new Date(lastSyncedAt).toLocaleString()}`
                    : 'Changes will automatically synchronize when configured.'}
                </p>
              </div>
            </div>
          </Card>

          {/* Connection Configuration Form */}
          <Card title="Supabase Project Credentials">
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13.5px' }}>
                  <Globe size={15} />
                  <span>Project URL</span>
                </label>
                <input
                  type="text"
                  placeholder="https://xyzcompany.supabase.co"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    fontSize: '14px',
                  }}
                  required
                />
                <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                  Found under Project Settings &gt; API in your Supabase dashboard.
                </span>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13.5px' }}>
                  <Key size={15} />
                  <span>Anon / Public API Key</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                    }}
                    required
                  />
                  <Button type="button" variant="secondary" onClick={() => setShowKey(!showKey)}>
                    {showKey ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="autoSync"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                />
                <label htmlFor="autoSync" style={{ fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>
                  <strong>Realtime Auto-Sync:</strong> Automatically synchronize every bill, item, and payment immediately upon creation
                </label>
              </div>

              {testResult && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '13.5px',
                    background: testResult.success ? 'var(--success-soft)' : 'var(--danger-soft)',
                    color: testResult.success ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {testResult.success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <div>
                    <div>{testResult.message}</div>
                    {testResult.latencyMs && (
                      <div style={{ fontSize: '12px', opacity: 0.85 }}>Response time: {testResult.latencyMs}ms</div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Configuration'}
                </Button>
                <Button type="button" variant="secondary" onClick={handleTest} disabled={testing}>
                  <Zap size={15} />
                  <span>{testing ? 'Testing...' : 'Test Connection'}</span>
                </Button>
              </div>
            </form>
          </Card>

          {/* Supabase Authentication Service */}
          <Card title="Supabase Authentication Services">
            {supabaseUser ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    background: 'var(--success-soft)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <ShieldCheck size={26} color="var(--success)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>
                      Authenticated with Supabase Cloud
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>
                      Email: <strong>{supabaseUser.email}</strong>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-3)', fontFamily: 'monospace' }}>
                      UID: {supabaseUser.id}
                    </div>
                  </div>
                </div>
                <Button variant="secondary" onClick={handleSignOut} style={{ alignSelf: 'flex-start' }}>
                  <LogOut size={15} />
                  <span>Sign Out Supabase Account</span>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-2)' }}>
                  Sign in or register a cloud user with Supabase Auth to authenticate multi-device access.
                </p>

                <div className="field">
                  <label style={{ fontSize: '13px', fontWeight: 600 }}>Email Address</label>
                  <input
                    type="email"
                    placeholder="user@billforce.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '14px',
                    }}
                    required
                  />
                </div>

                <div className="field">
                  <label style={{ fontSize: '13px', fontWeight: 600 }}>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '14px',
                    }}
                    required
                  />
                </div>

                {authError && (
                  <div style={{ color: 'var(--danger)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertCircle size={15} />
                    <span>{authError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <Button type="submit" variant="primary" disabled={authLoading || !configured}>
                    {isSignUp ? <UserPlus size={15} /> : <LogIn size={15} />}
                    <span>{authLoading ? 'Authenticating...' : isSignUp ? 'Create Supabase Account' : 'Sign In with Supabase'}</span>
                  </Button>
                  <button
                    type="button"
                    onClick={() => setIsSignUp(!isSignUp)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--primary)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {isSignUp ? 'Already have account? Sign in' : 'Create new account'}
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>

        {/* Right Column: Synchronization Stats & SQL Migration */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Cloud Sync Controls & Stats */}
          <Card title="Database Synchronization Status">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>Seamless Two-Way Sync</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-2)' }}>
                    Syncs POS bills, double-entry accounts, stock moves, customer ledgers, and items.
                  </div>
                </div>
                <Button variant="primary" onClick={handleSync} disabled={loading || !configured}>
                  <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
                  <span>{loading ? 'Syncing...' : 'Sync Now'}</span>
                </Button>
              </div>

              {syncResult && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '13.5px',
                    background: syncResult.includes('failed') ? 'var(--danger-soft)' : 'var(--success-soft)',
                    color: syncResult.includes('failed') ? 'var(--danger)' : 'var(--success)',
                  }}
                >
                  {syncResult.includes('failed') ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
                  <span>{syncResult}</span>
                </div>
              )}

              {stats && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '10px',
                    padding: '12px',
                    background: 'var(--surface-2)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)' }}>{stats.bills}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>Sales Bills</div>
                  </div>
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)' }}>{stats.customers}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>Customers</div>
                  </div>
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)' }}>{stats.items}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>Items</div>
                  </div>
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)' }}>{stats.purchases}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>Purchases</div>
                  </div>
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)' }}>{stats.accounts}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>Accounts</div>
                  </div>
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)' }}>{stats.journals}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>Journals</div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Supabase PostgreSQL Setup SQL Script */}
          <Card title="Supabase Database Schema Setup">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-2)' }}>
                To prepare your Supabase project for Billforce data synchronization, run this SQL script in your{' '}
                <strong>Supabase SQL Editor</strong>. It creates all tables, indexes, and Row Level Security policies.
              </p>

              <div style={{ display: 'flex', gap: '10px' }}>
                <Button variant="primary" onClick={handleCopySql}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copied ? 'Copied to Clipboard!' : 'Copy Complete Supabase SQL Schema'}</span>
                </Button>
              </div>

              <div
                style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  background: '#1a2624',
                  color: '#93edd6',
                  padding: '12px',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.4',
                }}
              >
                <pre style={{ margin: 0 }}>{schemaSql || '-- Loading Supabase Schema SQL...'}</pre>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
