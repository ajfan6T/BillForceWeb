import React from 'react';

export interface LogoProps {
  variant?: 'mark' | 'wordmark';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  className?: string;
  style?: React.CSSProperties;
}

export function BillforceLogoMark({
  size = 36,
  className = '',
  style = {},
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`billforce-logo-mark ${className}`}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-label="BILLFORCE"
    >
      {/* Blue rounded square base with subtle theme integration */}
      <rect x="24" y="48" width="420" height="420" rx="96" fill="var(--primary, #2563eb)" />

      {/* Bold White 'B' Lettermark */}
      <path
        d="M 118 162 H 262 C 306 162 334 184 334 220 C 334 246 318 266 288 276 C 326 288 346 312 346 352 C 346 396 312 424 262 424 H 118 Z M 174 214 V 268 H 252 C 276 268 290 256 290 241 C 290 226 276 214 252 214 Z M 174 316 V 372 H 260 C 286 372 302 358 302 344 C 302 329 286 316 260 316 Z"
        fill="#ffffff"
      />

      {/* Gold Rupee Badge in Upper Right Corner */}
      <circle cx="396" cy="116" r="92" fill="#ffffff" />
      <circle cx="396" cy="116" r="76" fill="#f0a726" />

      {/* Indian Rupee Symbol ₹ */}
      <g fill="#332010" transform="translate(396, 116) scale(0.68) translate(-42, -56)">
        <rect x="0" y="0" width="84" height="15" rx="3" />
        <rect x="0" y="26" width="76" height="14" rx="3" />
        <path d="M 16 0 V 62 C 38 62 58 56 64 42 C 68 33 66 26 62 20 H 76 C 81 29 80 43 73 54 C 62 71 38 76 16 76 V 82 L 56 128 H 36 L 4 88 V 74 H 16 V 0 Z" />
      </g>
    </svg>
  );
}

export function BillforceLogo({
  variant = 'mark',
  size = 'md',
  className = '',
  style = {},
}: LogoProps) {
  const pixelSize =
    typeof size === 'number'
      ? size
      : size === 'xs'
        ? 24
        : size === 'sm'
          ? 32
          : size === 'md'
            ? 40
            : size === 'lg'
              ? 54
              : 68;

  if (variant === 'wordmark') {
    return (
      <div
        className={`billforce-logo-wordmark ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: Math.max(8, Math.round(pixelSize * 0.28)) + 'px',
          ...style,
        }}
      >
        <BillforceLogoMark size={pixelSize} />
        <span
          style={{
            fontFamily:
              "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
            fontWeight: 900,
            fontSize: Math.round(pixelSize * 0.62) + 'px',
            letterSpacing: '0.04em',
            color: 'var(--text, #0f172a)',
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          BILLFORCE
        </span>
      </div>
    );
  }

  return <BillforceLogoMark size={pixelSize} className={className} style={style} />;
}
