import { useId } from "react";

export default function SpotLogo({ size = 36, showText = true, textColor = "#111827", className = "" }) {
  const id = useId();
  const gradId = `spot-grad-${id}`;

  const numSize = typeof size === 'number'
    ? size
    : size === 'sm' ? 28 : size === 'lg' ? 44 : 36;

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
      role="img"
      aria-label="SPOT"
    >
      <svg width={numSize} height={numSize} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="6" y1="0" x2="34" y2="0">
            <stop offset="0" stopColor="#9CA3AF" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        <path d="M13 7.9H27L34 20L27 32.1H13L6 20Z" stroke={`url(#${gradId})`} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="13" cy="7.9" r="3.2" fill="#fff" stroke="#9CA3AF" strokeWidth="1.6" />
        <circle cx="6" cy="20" r="3.2" fill="#fff" stroke="#9CA3AF" strokeWidth="1.6" />
        <circle cx="13" cy="32.1" r="3.2" fill="#fff" stroke="#9CA3AF" strokeWidth="1.6" />
        <circle cx="27" cy="7.9" r="3.6" fill="#7C3AED" />
        <circle cx="34" cy="20" r="3" fill="#7C3AED" />
        <circle cx="27" cy="32.1" r="3" fill="#7C3AED" />
      </svg>
      {showText && (
        <span style={{ fontSize: numSize * 0.61, fontWeight: 800, letterSpacing: "0.24em", color: textColor, lineHeight: 1 }}>
          SPOT
        </span>
      )}
    </span>
  );
}

export { SpotLogo };