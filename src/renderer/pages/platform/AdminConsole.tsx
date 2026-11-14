/**
 * The server's admin (#/admin, online billing only): sign in with the admin login set on the
 * server, see every registered business with its owner's contact details and how much it is
 * used, and turn a business off, reset its owner's password, download a backup or remove it.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Ban, Building2, CheckCircle2, Download, FileSpreadsheet, KeyRound, LogOut, Mail, Phone, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { BROWSER_EDITION, DESKTOP } from '../../api';
import { useDialogs, useToast } from '../../feedback';
import { downloadInBrowser } from '../../browserActions';
import { Alert, Badge, Button, EmptyState, Loading } from '../../components/ui';
import { Field, SearchInput, TextInput } from '../../components/forms';
import { formatINR } from '../../../shared/money';
import { formatDate, formatDateTime } from '../../../shared/dates';
import { whatsappNumber } from '../../../shared/whatsapp';
import './platform.css';

interface AdminBusiness {
  id: string;
  name: string;
  registeredAt: string;
  disabled: boolean;
  owner: { fullName: string; username: string; lastLoginAt: string | null } | null;
  phone: string;
  email: string;
  address: string;
  users: number;
  bills: number;
  sales: number;
  lastBillDate: string | null;
  lastActiveAt: string | null;
  sizeBytes: number;
  problem: string | null;
}

const TOKEN_KEY = 'bf:admin-token';

function storedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function storeToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window: the admin signs in again after a reload */
  }
}

class AdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function adminCall<T>(action: string, body: Record<string, unknown> = {}, token = storedToken()): Promise<T> {
  const res = await fetch(`/api/admin/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: { code: string; message: string } } | null;
  if (!json) throw new AdminError('The server did not answer. Check the connection and try again.', 'NETWORK');
  if (!json.ok) throw new AdminError(json.error?.message ?? 'Failed', json.error?.code ?? 'ERROR');
  return json.data as T;
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function daysAgo(ts: string | null): string {
  if (!ts) return 'Never';
  const days = Math.floor((Date.now() - new Date(ts.replace(' ', 'T')).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return formatDateTime(ts);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function AdminConsole() {
  const [state, setState] = useState<'checking' | 'off' | 'signin' | 'in'>('checking');
  const [startError, setStartError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStartError(null);
    try {
      const s = await adminCall<{ enabled: boolean; signedIn: boolean }>('status');
      setState(!s.enabled ? 'off' : s.signedIn ? 'in' : 'signin');
    } catch (e) {
      setStartError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (DESKTOP || BROWSER_EDITION) setState('off');
    else void check();
  }, [check]);

  if (startError) {
    return (
      <div className="auth-screen">
        <div className="auth-card stack">
          <h1>Admin</h1>
          <Alert tone="red">{startError}</Alert>
          <Button variant="primary" onClick={() => void check()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (state === 'checking') return <Loading label="Opening admin…" />;
  if (state === 'off') {
    return (
      <div className="auth-screen">
        <div className="auth-card stack">
          <ShieldCheck size={36} className="pa-mark" />
          <h1>The admin login is not set up</h1>
          <p className="muted">
            {DESKTOP || BROWSER_EDITION
              ? 'The admin is part of online billing: open /#/admin on your BILLFORCE server.'
              : 'Set BILLFORCE_ADMIN_PASSWORD (8 characters or more) where the server starts, restart it and open this page again.'}
          </p>
          <a className="btn btn-secondary btn-md" href="#/">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }
  if (state === 'signin') return <AdminSignIn onSignedIn={() => setState('in')} />;
  return (
    <AdminHome
      onSignedOut={() => {
        storeToken(null);
        setState('signin');
      }}
    />
  );
}

function AdminSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await adminCall<{ token: string }>('login', { username, password }, null);
      storeToken(token);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card stack" onSubmit={submit}>
        <div className="setup-brand center">
          <ShieldCheck size={40} className="pa-mark" />
          <h1>BILLFORCE admin</h1>
          <p className="muted">Manage the businesses on this server</p>
        </div>
        <Field label="Admin username">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Admin password">
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!username.trim() || !password}>
          Sign in
        </Button>
        <a className="small center" href="#/">
          Business sign-in
        </a>
      </form>
    </div>
  );
}

function AdminHome({ onSignedOut }: { onSignedOut: () => void }) {
  const toast = useToast();
  const dialogs = useDialogs();
  const [rows, setRows] = useState<AdminBusiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'off'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reset, setReset] = useState<{ business: string; username: string; password: string } | null>(null);

  const guard = useCallback(
    (e: unknown) => {
      if (e instanceof AdminError && e.code === 'UNAUTHENTICATED') {
        toast.info('Your admin sign-in has ended. Please sign in again.');
        onSignedOut();
        return true;
      }
      return false;
    },
    [onSignedOut, toast],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminCall<AdminBusiness[]>('businesses'));
    } catch (e) {
      if (!guard(e)) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [guard]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((b) => {
      if (filter === 'active' && b.disabled) return false;
      if (filter === 'off' && !b.disabled) return false;
      if (!q) return true;
      return [b.name, b.id, b.phone, b.email, b.owner?.fullName, b.owner?.username].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, query, filter]);

  const totals = useMemo(() => {
    const all = rows ?? [];
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      businesses: all.length,
      off: all.filter((b) => b.disabled).length,
      newThisMonth: all.filter((b) => new Date(b.registeredAt) >= monthStart).length,
      activeWeek: all.filter((b) => b.lastActiveAt && Date.now() - new Date(b.lastActiveAt.replace(' ', 'T')).getTime() < 7 * 86_400_000).length,
      bills: all.reduce((n, b) => n + b.bills, 0),
    };
  }, [rows]);

  const replace = (b: AdminBusiness) => setRows((list) => (list ?? []).map((x) => (x.id === b.id ? b : x)));

  const act = async (b: AdminBusiness, what: () => Promise<void>) => {
    setBusyId(b.id);
    try {
      await what();
    } catch (e) {
      if (!guard(e)) toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (b: AdminBusiness) =>
    act(b, async () => {
      if (!b.disabled) {
        const ok = await dialogs.confirm({
          title: `Turn off ${b.name}?`,
          message: 'Everyone signed in to it is signed out, and nobody can sign in or open its bill links until you turn it on again. Its data is kept.',
          confirmText: 'Turn off',
          danger: true,
        });
        if (!ok) return;
      }
      const updated = await adminCall<AdminBusiness>(b.disabled ? 'enable' : 'disable', { id: b.id });
      replace(updated);
      toast.success(updated.disabled ? `${b.name} is turned off.` : `${b.name} is turned on again.`);
    });

  const resetPassword = (b: AdminBusiness) =>
    act(b, async () => {
      const ok = await dialogs.confirm({
        title: `Reset the owner password of ${b.name}?`,
        message: `${b.owner?.fullName ?? 'The owner'} gets a temporary password and must choose a new one at the next sign-in. Their current sign-ins end.`,
        confirmText: 'Reset password',
      });
      if (!ok) return;
      const r = await adminCall<{ username: string; fullName: string; password: string }>('reset-password', { id: b.id });
      setReset({ business: b.name, username: r.username, password: r.password });
    });

  const backup = (b: AdminBusiness) =>
    act(b, async () => {
      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${storedToken() ?? ''}` },
        body: JSON.stringify({ id: b.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
        throw new AdminError(json?.error?.message ?? 'The backup could not be made.', json?.error?.code ?? 'ERROR');
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${b.id}.bfbackup`;
      const url = URL.createObjectURL(await res.blob());
      downloadInBrowser(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`Backup of ${b.name} downloaded (${name}).`);
    });

  const remove = (b: AdminBusiness) =>
    act(b, async () => {
      const typed = await dialogs.prompt({
        title: `Remove ${b.name} from the server?`,
        message: `Its owner and staff can no longer sign in, and the name can be registered again. A copy of its data (${b.bills} bills) is kept in the server's "deleted" folder, so this can be undone by restoring that file.`,
        label: 'Type the business name to confirm',
        placeholder: b.name,
        confirmText: 'Remove business',
        danger: true,
        validate: (v) => (v.trim().toLowerCase() === b.name.trim().toLowerCase() ? null : `Type "${b.name}" exactly`),
      });
      if (typed === null) return;
      await adminCall('delete', { id: b.id, confirmName: typed });
      setRows((list) => (list ?? []).filter((x) => x.id !== b.id));
      toast.success(`${b.name} was removed. A copy of its data is kept on the server.`);
    });

  const exportCsv = () => {
    const head = ['Business', 'Sign-in id', 'Owner', 'Owner username', 'Mobile', 'Email', 'Address', 'Registered', 'Last active', 'Users', 'Bills', 'Sales (Rs)', 'Last bill', 'Status'];
    const lines = (rows ?? []).map((b) =>
      [
        b.name,
        b.id,
        b.owner?.fullName ?? '',
        b.owner?.username ?? '',
        b.phone,
        b.email,
        b.address,
        formatDate(b.registeredAt.slice(0, 10)),
        b.lastActiveAt ? formatDateTime(b.lastActiveAt) : '',
        b.users,
        b.bills,
        (b.sales / 100).toFixed(2),
        b.lastBillDate ? formatDate(b.lastBillDate) : '',
        b.disabled ? 'Turned off' : 'Active',
      ]
        .map(csvCell)
        .join(','),
    );
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    downloadInBrowser(url, `billforce-businesses-${new Date().toISOString().slice(0, 10)}.csv`);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const signOut = async () => {
    await adminCall('logout').catch(() => null);
    onSignedOut();
  };

  return (
    <div className="pa">
      <header className="pa-top">
        <div className="pa-brand">
          <ShieldCheck size={22} />
          <span>BILLFORCE admin</span>
        </div>
        <div className="pa-top-actions">
          <Button size="sm" icon={<RefreshCw size={15} />} onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
          <Button size="sm" variant="ghost" icon={<LogOut size={15} />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="pa-main">
        <div className="pa-head">
          <div>
            <h1>Businesses</h1>
            <p className="muted">Everyone who registered on this server, how to reach them and how much they use BILLFORCE.</p>
          </div>
          <Button icon={<FileSpreadsheet size={16} />} onClick={exportCsv} disabled={!rows?.length}>
            Export CSV
          </Button>
        </div>

        <div className="pa-stats">
          <div className="pa-stat">
            <span>Businesses</span>
            <b>{totals.businesses}</b>
          </div>
          <div className="pa-stat">
            <span>New this month</span>
            <b>{totals.newThisMonth}</b>
          </div>
          <div className="pa-stat">
            <span>Active this week</span>
            <b>{totals.activeWeek}</b>
          </div>
          <div className="pa-stat">
            <span>Bills in all</span>
            <b>{totals.bills.toLocaleString('en-IN')}</b>
          </div>
          <div className="pa-stat">
            <span>Turned off</span>
            <b>{totals.off}</b>
          </div>
        </div>

        {reset && (
          <Alert tone="green" title={`Temporary password for ${reset.business}`}>
            <div className="pa-reset">
              <span>
                Username <b>{reset.username}</b> · password <code>{reset.password}</code>
              </span>
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(reset.password).then(() => toast.success('Password copied'))}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReset(null)}>
                Done
              </Button>
            </div>
            <div className="small">Give it to the owner; they choose a new password when they sign in. It is not shown again.</div>
          </Alert>
        )}

        <div className="pa-tools">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, owner, mobile or email…" />
          <div className="pa-filter" role="group" aria-label="Show">
            {(
              [
                ['all', 'All'],
                ['active', 'Active'],
                ['off', 'Turned off'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <Alert tone="red">{error}</Alert>}
        {!rows && !error && <Loading label="Loading businesses…" />}
        {rows && !shown.length && (
          <EmptyState icon={<Building2 size={34} />} title={rows.length ? 'No business matches' : 'No businesses yet'} message={rows.length ? 'Try another search.' : 'Businesses appear here when they register.'} />
        )}

        <div className="pa-list">
          {shown.map((b) => {
            const wa = whatsappNumber(b.phone);
            return (
              <article key={b.id} className={`pa-card${b.disabled ? ' off' : ''}`}>
                <div className="pa-card-head">
                  <div>
                    <h2>{b.name}</h2>
                    <div className="small muted">
                      Sign-in id <code>{b.id}</code> · registered {formatDate(b.registeredAt.slice(0, 10))}
                    </div>
                  </div>
                  {b.disabled ? <Badge tone="red">Turned off</Badge> : <Badge tone="green">Active</Badge>}
                </div>

                <div className="pa-card-body">
                  <div className="pa-contact">
                    <div>
                      <span className="pa-label">Owner</span>
                      {b.owner ? (
                        <>
                          {b.owner.fullName} <span className="muted">({b.owner.username})</span>
                        </>
                      ) : (
                        <span className="muted">No active owner</span>
                      )}
                    </div>
                    <div>
                      <span className="pa-label">Mobile</span>
                      {b.phone ? (
                        <span className="pa-links">
                          <a href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}>
                            <Phone size={13} /> {b.phone}
                          </a>
                          {wa && (
                            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                              WhatsApp
                            </a>
                          )}
                        </span>
                      ) : (
                        <span className="muted">Not given</span>
                      )}
                    </div>
                    <div>
                      <span className="pa-label">Email</span>
                      {b.email ? (
                        <a href={`mailto:${b.email}`}>
                          <Mail size={13} /> {b.email}
                        </a>
                      ) : (
                        <span className="muted">Not given</span>
                      )}
                    </div>
                    {b.address && (
                      <div>
                        <span className="pa-label">Address</span>
                        {b.address}
                      </div>
                    )}
                  </div>

                  <dl className="pa-usage">
                    <div>
                      <dt>Bills</dt>
                      <dd>{b.bills.toLocaleString('en-IN')}</dd>
                    </div>
                    <div>
                      <dt>Sales</dt>
                      <dd>{formatINR(b.sales)}</dd>
                    </div>
                    <div>
                      <dt>Last bill</dt>
                      <dd>{b.lastBillDate ? formatDate(b.lastBillDate) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Last active</dt>
                      <dd title={b.lastActiveAt ? formatDateTime(b.lastActiveAt) : undefined}>{daysAgo(b.lastActiveAt)}</dd>
                    </div>
                    <div>
                      <dt>Logins</dt>
                      <dd>{b.users}</dd>
                    </div>
                    <div>
                      <dt>Data</dt>
                      <dd>{size(b.sizeBytes)}</dd>
                    </div>
                  </dl>
                </div>

                {b.problem && <Alert tone="amber">Its data could not be read: {b.problem}</Alert>}

                <div className="pa-actions">
                  <Button size="sm" icon={<Download size={15} />} disabled={busyId === b.id} onClick={() => void backup(b)}>
                    Backup
                  </Button>
                  <Button size="sm" icon={<KeyRound size={15} />} disabled={busyId === b.id || !b.owner} onClick={() => void resetPassword(b)}>
                    Reset owner password
                  </Button>
                  <Button size="sm" icon={b.disabled ? <CheckCircle2 size={15} /> : <Ban size={15} />} disabled={busyId === b.id} onClick={() => void toggle(b)}>
                    {b.disabled ? 'Turn on' : 'Turn off'}
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 size={15} />} disabled={busyId === b.id} onClick={() => void remove(b)}>
                    Remove
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
