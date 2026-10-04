import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Palette, Check } from 'lucide-react';

export type ColorTheme = 'blue' | 'green' | 'brown';

export interface ThemeConfig {
  id: ColorTheme;
  name: string;
  badgeColor: string;
  bgSwatch: string;
  accentColor: string;
  borderColor: string;
  description: string;
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'blue',
    name: 'Blue and white',
    badgeColor: '#2563eb',
    bgSwatch: '#f4f7fb',
    accentColor: '#1d4ed8',
    borderColor: '#bfdbfe',
    description: 'Clean, professional corporate blue with crisp white contrast (Default)',
  },
  {
    id: 'green',
    name: 'Green and white',
    badgeColor: '#059669',
    bgSwatch: '#f2f8f5',
    accentColor: '#047857',
    borderColor: '#a7f3d0',
    description: 'Fresh organic emerald green with clear white cards and modern accents',
  },
  {
    id: 'brown',
    name: 'Brown and white',
    badgeColor: '#854d0e',
    bgSwatch: '#f9f6f2',
    accentColor: '#78350f',
    borderColor: '#fde68a',
    description: 'Warm, earthy amber-brown with elegant warm white and ivory tones',
  },
];

interface ThemeContextType {
  theme: ColorTheme;
  setTheme: (theme: ColorTheme) => void;
  themes: ThemeConfig[];
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function applyThemeToDom(theme: ColorTheme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const config = THEMES.find((t) => t.id === theme) || THEMES[0];
    meta.setAttribute('content', config.badgeColor);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(() => {
    try {
      const stored = localStorage.getItem('bf:theme');
      if (stored === 'green' || stored === 'brown' || stored === 'blue') return stored;
    } catch {
      /* ignore */
    }
    return 'blue'; // Blue and white by default
  });

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = (newTheme: ColorTheme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('bf:theme', newTheme);
    } catch {
      /* ignore */
    }
    applyThemeToDom(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Quick theme switcher dropdown for the Topbar */
export function TopbarThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const current = themes.find((t) => t.id === theme) || themes[0];

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.theme-switcher-container')) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('click', handleOutsideClick);
    }
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [open]);

  return (
    <div className="theme-switcher-container" style={{ position: 'relative' }}>
      <button
        type="button"
        className="topbar-btn theme-btn"
        onClick={() => setOpen(!open)}
        title={`Current color theme: ${current.name}. Click to change.`}
        aria-label="Change color theme"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: current.badgeColor,
            boxShadow: '0 0 0 2px var(--surface), 0 0 0 3px ' + current.badgeColor,
          }}
        />
        <Palette size={15} style={{ opacity: 0.85 }} />
        <span className="desktop-only" style={{ textTransform: 'capitalize' }}>
          {theme}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: '240px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            padding: '8px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ padding: '4px 8px 6px', borderBottom: '1px solid var(--border)', fontSize: '11.5px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Choose Color Theme
          </div>

          {themes.map((t) => {
            const isSelected = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: isSelected ? '1px solid ' + t.borderColor : '1px solid transparent',
                  background: isSelected ? 'var(--primary-soft)' : 'transparent',
                  color: isSelected ? 'var(--primary-text)' : 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      backgroundColor: t.badgeColor,
                      border: '2px solid #ffffff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{t.name}</div>
                    {t.id === 'blue' && <div style={{ fontSize: '11px', opacity: 0.75 }}>Default</div>}
                  </div>
                </div>
                {isSelected && <Check size={16} style={{ color: t.badgeColor }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Large visual cards for Settings page */
export function ThemeSettingsCards() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginTop: '12px' }}>
      {themes.map((t) => {
        const isSelected = t.id === theme;
        return (
          <div
            key={t.id}
            onClick={() => setTheme(t.id)}
            style={{
              cursor: 'pointer',
              borderRadius: '12px',
              border: isSelected ? `2px solid ${t.badgeColor}` : '2px solid var(--border)',
              background: 'var(--surface)',
              overflow: 'hidden',
              boxShadow: isSelected ? '0 4px 14px rgba(0, 0, 0, 0.08)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            {/* Visual Mini Mockup */}
            <div
              style={{
                height: '110px',
                background: t.bgSwatch,
                padding: '12px',
                display: 'flex',
                gap: '8px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {/* Mock Sidebar */}
              <div
                style={{
                  width: '35%',
                  background: '#ffffff',
                  borderRadius: '6px',
                  padding: '8px',
                  border: '1px solid rgba(0,0,0,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ width: '60%', height: '8px', borderRadius: '4px', background: t.badgeColor }} />
                <div style={{ width: '80%', height: '6px', borderRadius: '3px', background: '#e2e8f0' }} />
                <div style={{ width: '70%', height: '6px', borderRadius: '3px', background: isSelected ? t.badgeColor : '#e2e8f0', opacity: isSelected ? 0.35 : 1 }} />
              </div>
              {/* Mock Content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div
                  style={{
                    height: '24px',
                    background: '#ffffff',
                    borderRadius: '5px',
                    border: '1px solid rgba(0,0,0,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ width: '40%', height: '6px', borderRadius: '3px', background: t.badgeColor }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: t.badgeColor }} />
                </div>
                <div
                  style={{
                    flex: 1,
                    background: '#ffffff',
                    borderRadius: '6px',
                    border: '1px solid rgba(0,0,0,0.06)',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '4px',
                  }}
                >
                  <div style={{ width: '75%', height: '7px', borderRadius: '3px', background: '#334155' }} />
                  <div style={{ width: '50%', height: '5px', borderRadius: '3px', background: '#94a3b8' }} />
                  <div
                    style={{
                      width: '45px',
                      height: '14px',
                      borderRadius: '4px',
                      background: t.badgeColor,
                      marginTop: '4px',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Card Details */}
            <div style={{ padding: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: t.badgeColor,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: '15px' }}>{t.name}</span>
                </div>
                {isSelected && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: t.badgeColor,
                      background: t.bgSwatch,
                      padding: '2px 8px',
                      borderRadius: '12px',
                    }}
                  >
                    <Check size={14} /> Active
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.4 }}>
                {t.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
