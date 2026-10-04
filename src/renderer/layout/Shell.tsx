import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import {
  Boxes,
  ChevronDown,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plus,
  Receipt,
  UserCircle2,
  X,
} from 'lucide-react';
import { NAV, NEW_BILL_PATH, type NavGroup } from '../nav';
import { useAuth, useFeatures } from '../auth';
import { useHotkeys } from '../hooks';
import { confirmLeave, useGuardedNavigate } from '../guards';
import { ROLE_LABELS } from '../../shared/constants';
import { fyOf, formatDateLong, todayISO } from '../../shared/dates';
import { ChangePasswordModal } from './ChangePassword';
import { SupabaseBadge } from '../components/SupabaseBadge';
import { TopbarThemeSwitcher, useTheme } from '../theme';
import { BillforceLogoMark } from '../components/Logo';
import type { Permission } from '../../shared/permissions';

function allowed(can: (p: Permission) => boolean, perm?: Permission | Permission[]): boolean {
  if (!perm) return true;
  return Array.isArray(perm) ? perm.some(can) : can(perm);
}

function Sidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const { can } = useAuth();
  const features = useFeatures();
  const location = useLocation();
  const { onLinkClick } = useGuardedNavigate();
  const groups = useMemo(
    () =>
      NAV.map((g) => ({ ...g, items: g.items?.filter((i) => allowed(can, i.perm) && (!i.feature || i.feature(features))) }))
        .filter((g) => allowed(can, g.perm) && (!g.feature || g.feature(features)))
        .filter((g) => g.to || (g.items && g.items.length)),
    [can, features],
  );
  const activeGroup = groups.find((g) => g.items?.some((i) => location.pathname === i.to || (i.to !== '/' && location.pathname.startsWith(i.to + '/'))))?.key;
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('bf:nav-open') ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (activeGroup && !open[activeGroup]) setOpen((o) => ({ ...o, [activeGroup]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);
  useEffect(() => {
    localStorage.setItem('bf:nav-open', JSON.stringify(open));
  }, [open]);

  // Close mobile drawer on route click
  const handleNavClick = (to: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onCloseMobile) onCloseMobile();
    onLinkClick(to)(e);
  };

  const renderGroup = (g: NavGroup) => {
    const Icon = g.icon;
    if (g.to) {
      return (
        <NavLink key={g.key} to={g.to} end className={({ isActive }) => `nav-top${isActive ? ' active' : ''}`} onClick={handleNavClick(g.to)}>
          <span className="nav-ic">
            <Icon size={17} />
          </span>
          <span>{g.label}</span>
        </NavLink>
      );
    }
    const isOpen = !!open[g.key];
    return (
      <div key={g.key} className={`nav-group${activeGroup === g.key ? ' has-active' : ''}`}>
        <button type="button" className="nav-top" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}>
          <span className="nav-ic">
            <Icon size={17} />
          </span>
          <span>{g.label}</span>
          <ChevronDown size={15} className={`chev${isOpen ? ' open' : ''}`} />
        </button>
        {isOpen && (
          <div className="nav-items">
            {g.items!.map((i) => (
              <NavLink key={i.to} to={i.to} end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={handleNavClick(i.to)}>
                {i.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onCloseMobile} aria-hidden="true" />}
      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="brand">
          <BillforceLogoMark size={32} />
          <div className="brand-name">Billforce</div>
          {onCloseMobile && (
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={onCloseMobile}
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          )}
        </div>
        {can('billing.create') && (
          <NavLink to={NEW_BILL_PATH} className="new-bill-btn" onClick={handleNavClick(NEW_BILL_PATH)}>
            <Plus size={18} />
            <span>New bill</span>
            <kbd>F2</kbd>
          </NavLink>
        )}
        <nav className="nav">{groups.map(renderGroup)}</nav>
      </aside>
    </>
  );
}

function UserMenu() {
  const { session, logout, lock } = useAuth();
  const [open, setOpen] = useState(false);
  const [changePw, setChangePw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!session) return null;
  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-btn"
        onFocus={(e) => {
          const from = e.relatedTarget;
          if (from instanceof HTMLElement && !ref.current?.contains(from)) cameFrom.current = from;
        }}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserCircle2 size={19} />
        <span className="user-name">{session.fullName}</span>
        <span className="user-role">{ROLE_LABELS[session.role]}</span>
        <ChevronDown size={14} className="user-chevron" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => (setOpen(false), setChangePw(true))}>
            <KeyRound size={15} /> Change password
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), lock(cameFrom.current))}>
            <Lock size={15} /> Lock screen
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), void confirmLeave().then((ok) => (ok ? logout() : undefined)))}>
            <LogOut size={15} /> Log out / switch user
          </button>
        </div>
      )}
      <ChangePasswordModal open={changePw} onClose={() => setChangePw(false)} />
    </div>
  );
}

function MobileBottomNav({
  onOpenMenu,
}: {
  onOpenMenu: () => void;
}) {
  const { can } = useAuth();
  const location = useLocation();

  return (
    <nav className="mobile-bottom-nav" aria-label="Quick mobile navigation">
      <NavLink
        to="/"
        end
        className={({ isActive }) => `mb-nav-item${isActive ? ' active' : ''}`}
      >
        <LayoutDashboard size={20} />
        <span>Home</span>
      </NavLink>

      <NavLink
        to="/sales/bills"
        className={({ isActive }) => `mb-nav-item${isActive ? ' active' : ''}`}
      >
        <Receipt size={20} />
        <span>Bills</span>
      </NavLink>

      {can('billing.create') && (
        <NavLink
          to={NEW_BILL_PATH}
          className="mb-nav-item-fab"
          aria-label="New Bill"
        >
          <div className="mb-fab-circle">
            <Plus size={24} />
          </div>
          <span className="mb-fab-label">New Bill</span>
        </NavLink>
      )}

      <NavLink
        to="/sales/items"
        className={({ isActive }) => `mb-nav-item${isActive ? ' active' : ''}`}
      >
        <Boxes size={20} />
        <span>Items</span>
      </NavLink>

      <button
        type="button"
        className="mb-nav-item"
        onClick={onOpenMenu}
        aria-label="All Navigation Modules"
      >
        <Menu size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}

export function Shell({ children, fullBleed }: { children: ReactNode; fullBleed?: boolean }) {
  const { status, can } = useAuth();
  const { go } = useGuardedNavigate();
  const location = useLocation();
  const today = todayISO();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on path change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close drawer on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useHotkeys({
    F2: () => can('billing.create') && void go(NEW_BILL_PATH),
  });

  return (
    <div className="shell">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={22} />
            </button>
            <span className="biz-name" title={status?.businessName}>
              {status?.businessName || 'Billforce'}
            </span>
          </div>
          <div className="topbar-right">
            <SupabaseBadge />
            <TopbarThemeSwitcher />
            <span className="today desktop-only">{formatDateLong(today)}</span>
            <span className="fy-badge desktop-only" title="Current financial year">
              FY {fyOf(today).name}
            </span>
            <UserMenu />
          </div>
        </header>
        <main className={`content${fullBleed ? ' full-bleed' : ''}`}>{children}</main>
        <MobileBottomNav onOpenMenu={() => setMobileOpen(true)} />
      </div>
    </div>
  );
}

