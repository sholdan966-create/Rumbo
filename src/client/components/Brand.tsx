import { BRAND } from '../../shared/brand';

/** Ícono de camión (el mismo que usa el sitio de la empresa). */
export const TruckIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
);

/** Logo de la empresa: variante clara para fondos oscuros y oscura para fondos claros. */
export function TgLogo({ onDark = false, size = 40 }: { onDark?: boolean; size?: number }) {
  return (
    <div className={`tg-logo ${onDark ? 'on-dark' : ''}`} style={{ ['--s' as string]: `${size}px` }}>
      <span className="tg-mark"><TruckIcon size={Math.round(size * 0.55)} /></span>
      <span className="tg-text"><b>{BRAND.short}</b><span>{BRAND.tagline}</span></span>
    </div>
  );
}

/** Sello del producto al pie: "by RUMBO" con su logo. */
export function ByRumbo({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className={`by-rumbo ${onDark ? 'on-dark' : ''}`}>
      <span>by</span>
      <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#12212D" /><path d="M9 22V10h7a4 4 0 010 8h-7m7 0l5 4" fill="none" stroke="#2DD4BF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <b>RUMBO</b>
    </div>
  );
}
