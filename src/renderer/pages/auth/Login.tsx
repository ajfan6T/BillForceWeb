import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, UserCircle2, Cloud } from 'lucide-react';
import { Button, Alert } from '../../components/ui';
import { Field, TextInput } from '../../components/forms';
import { Modal } from '../../components/modal';
import { useMutation, useQuery } from '../../hooks';
import { useAuth } from '../../auth';
import { ROLE_LABELS, WRONG_LOGIN_MESSAGE } from '../../../shared/constants';
import { signInWithSupabase, getClientConfig } from '../../supabase';

function RecoveryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [result, setResult] = useState<{ username: string; recoveryCode: string } | null>(null);
  const m = useMutation('auth.recover');
  return (
    <Modal
      open={open}
      title="Reset owner password"
      onClose={() => (setResult(null), onClose())}
      width={460}
      footer={
        result ? (
          <Button variant="primary" onClick={() => (setResult(null), onClose())}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.loading} disabled={!code || pw.length < 4} onClick={async () => setResult(await m.run({ recoveryCode: code, newPassword: pw }).catch(() => null))}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <Alert tone="green" title="Password changed">
            Log in as <b>{result.username}</b> with your new password.
          </Alert>
          <p>Your old recovery code no longer works. Write down the new one:</p>
          <div className="recovery-code">{result.recoveryCode}</div>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Enter the recovery code you wrote down when Billforce was set up.</p>
          <Field label="Recovery code" error={m.fields.recoveryCode}>
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoFocus />
          </Field>
          <Field label="New owner password" hint="At least 4 characters" error={m.fields.newPassword}>
            <TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          {m.error && !m.fields.recoveryCode && <Alert tone="red">{m.error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

export function LoginScreen() {
  const { refresh } = useAuth();
  const [businessName, setBusinessName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recover, setRecover] = useState(false);
  const [supabaseMode, setSupabaseMode] = useState(false);
  const [sbEmail, setSbEmail] = useState('');
  const [sbPassword, setSbPassword] = useState('');
  const [sbLoading, setSbLoading] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const m = useMutation('auth.login');

  const submit = async () => {
    try {
      const res = await m.run({ businessName: businessName.trim(), username: username.trim(), password });
      if (res && (res as any).token) {
        localStorage.setItem('bf:session-token', (res as any).token);
      }
      await refresh();
    } catch {
      setPassword('');
      pwRef.current?.focus();
    }
  };

  const submitSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setSbLoading(true);
    setSbError(null);
    try {
      await signInWithSupabase(sbEmail.trim(), sbPassword.trim());
      const res = await m.run({ businessName: businessName.trim(), username: username.trim() || 'owner', password: sbPassword }).catch(() => null);
      if (res && (res as any).token) {
        localStorage.setItem('bf:session-token', (res as any).token);
      }
      await refresh();
    } catch (err: any) {
      setSbError(err.message || 'Supabase authentication failed');
    } finally {
      setSbLoading(false);
    }
  };

  const cfg = getClientConfig();
  const hasSupabase = !!(cfg.url && cfg.anonKey);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="setup-brand center">
          <div className="brand-mark big">₹</div>
          <div>
            <h1>Billforce</h1>
            <p className="muted">Business Portal Login</p>
          </div>
        </div>

        <p className="small muted center" style={{ marginTop: '-4px', marginBottom: '14px' }}>
          Enter your registered business name and credentials to log in.
        </p>

        {hasSupabase && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            <button
              type="button"
              onClick={() => setSupabaseMode(false)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                border: 'none',
                background: !supabaseMode ? 'var(--primary-soft)' : 'transparent',
                color: !supabaseMode ? 'var(--primary-text)' : 'var(--text-2)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Business Credentials
            </button>
            <button
              type="button"
              onClick={() => setSupabaseMode(true)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                border: 'none',
                background: supabaseMode ? 'var(--primary-soft)' : 'transparent',
                color: supabaseMode ? 'var(--primary-text)' : 'var(--text-2)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Cloud size={14} />
              <span>Supabase Cloud Auth</span>
            </button>
          </div>
        )}

        {supabaseMode ? (
          <form className="stack" onSubmit={submitSupabase}>
            <Field label="Business Name" error={m.fields.businessName}>
              <TextInput
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Enter your registered business name"
                autoFocus
              />
            </Field>
            <Field label="Supabase Cloud Email">
              <TextInput
                value={sbEmail}
                onChange={(e) => setSbEmail(e.target.value)}
                placeholder="user@example.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={sbPassword}
                onChange={(e) => setSbPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            {sbError && <Alert tone="red">{sbError}</Alert>}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={sbLoading}
              disabled={!businessName.trim() || !sbEmail || !sbPassword}
              icon={<Cloud size={16} />}
            >
              Sign in with Supabase
            </Button>
          </form>
        ) : (
          <>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Field label="Business Name" hint="Registered name of your business" error={m.fields.businessName}>
                <TextInput
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Diet factory"
                  autoFocus
                />
              </Field>
              <Field label="Username" error={m.fields.username}>
                <TextInput
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username / Owner"
                  autoComplete="username"
                />
              </Field>
              <Field label="Password" error={m.fields.password}>
                <TextInput
                  ref={pwRef}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Field>
              {m.error && <Alert tone="red">{m.error}</Alert>}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={m.loading}
                disabled={!businessName.trim() || !username.trim() || !password}
                icon={<Lock size={16} />}
              >
                Log in to Business
              </Button>
            </form>
            <button type="button" className="link-btn" onClick={() => setRecover(true)}>
              Forgot the owner password?
            </button>
          </>
        )}
      </div>
      <RecoveryModal open={recover} onClose={() => setRecover(false)} />
    </div>
  );
}

/**
 * Make everything on the page except `keep` inert (no focus, clicks or screen reader), including dialogs
 * that open later. Returns the function that undoes it.
 */
function isolate(keep: HTMLElement): () => void {
  const changed = new Map<Element, { inert: boolean; ariaHidden: string | null }>();
  const hide = (el: Element) => {
    if (el === keep || changed.has(el) || !(el instanceof HTMLElement) || el.tagName === 'SCRIPT') return;
    changed.set(el, { inert: el.inert, ariaHidden: el.getAttribute('aria-hidden') });
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
  };
  Array.from(document.body.children).forEach(hide);
  const observer = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => n.parentNode === document.body && hide(n as Element))));
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect();
    changed.forEach((prev, el) => {
      (el as HTMLElement).inert = prev.inert;
      if (prev.ariaHidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', prev.ariaHidden);
    });
  };
}

/**
 * Shown over the app after inactivity or "Lock screen": same user must re-enter the password.
 * The app underneath stays as it was but cannot be reached: it is inert, keyboard shortcuts are off
 * (useHotkeys checks the lock) and focus stays inside this card.
 */
export function LockScreen() {
  const { session, unlock, logout, refresh, lockReturnFocus } = useAuth();
  const [password, setPassword] = useState('');
  const m = useMutation('auth.login');
  const overlayRef = useRef<HTMLDivElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  // Where the user was when the screen locked. Read while rendering: by the time effects run, the password
  // box has taken the focus (autoFocus) and the page underneath has been made inert.
  const [before] = useState(() => {
    const given = lockReturnFocus();
    if (given?.isConnected) return given;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const restore = isolate(overlay);
    const focusables = () => Array.from(overlay.querySelectorAll<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')).filter((el) => !(el as HTMLButtonElement).disabled);
    pwRef.current?.focus();
    // Tab cycles inside the card.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[next].focus();
    };
    // Keys typed in the card reach its own (React) handlers but never page-level window listeners.
    const onDocKey = (e: KeyboardEvent) => {
      if (overlay.contains(e.target as Node)) e.stopPropagation();
    };
    // Keys that start outside the card (e.g. after clicking the dark background) are swallowed.
    const onWindowKey = (e: KeyboardEvent) => {
      if (overlay.contains(e.target as Node)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      pwRef.current?.focus();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!e.relatedTarget || !overlay.contains(e.relatedTarget as Node)) setTimeout(() => overlay.isConnected && !overlay.contains(document.activeElement) && pwRef.current?.focus(), 0);
    };
    overlay.addEventListener('keydown', onKey);
    overlay.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onDocKey);
    window.addEventListener('keydown', onWindowKey, true);
    return () => {
      overlay.removeEventListener('keydown', onKey);
      overlay.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onDocKey);
      window.removeEventListener('keydown', onWindowKey, true);
      restore();
      // Back to where the user was before the lock (after the page is no longer inert).
      setTimeout(() => before?.isConnected && before.focus?.(), 0);
    };
  }, [before]);

  if (!session) return null;
  const submit = async () => {
    try {
      await m.run({ username: session.username, password });
      await refresh();
      setPassword('');
      unlock();
    } catch {
      setPassword('');
      pwRef.current?.focus();
    }
  };
  // Only the password is asked here, so "Wrong username or password" would confuse; the lockout message stays.
  const error = m.error === WRONG_LOGIN_MESSAGE ? 'Wrong password. Try again.' : m.error;
  return createPortal(
    <div className="lock-overlay" ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby="lock-title" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div className="auth-card">
        <div className="auth-icon">
          <Lock size={28} />
        </div>
        <h1 id="lock-title">Screen locked</h1>
        <p className="muted">
          {session.fullName} ({ROLE_LABELS[session.role]})
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Password">
            <TextInput ref={pwRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
          </Field>
          {error && <Alert tone="red">{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={m.loading} disabled={!password}>
            Unlock
          </Button>
        </form>
        <button type="button" className="link-btn" onClick={() => void logout()}>
          Switch user
        </button>
      </div>
    </div>,
    document.body,
  );
}
