import { ReactNode, useEffect, useState } from 'react';
import { LayoutDashboard, Route as RouteIcon, Truck, Wallet, FileText, Settings as Cog, Menu, FlaskConical, FileSignature, Users, FolderOpen, LogOut } from 'lucide-react';
import { useApp } from '../store';
import { InstallButton } from './InstallButton';
import { ByRumbo, TgLogo } from './Brand';
import { ROSARIO_PLACES } from '../../shared/templates';
import { href } from '../router';
import { invoiceTotals } from '../../shared/calc';

const NAV = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard }, { id: 'viajes', label: 'Viajes', icon: RouteIcon }, { id: 'cotizaciones', label: 'Cotizaciones', icon: FileSignature },
  { id: 'flota', label: 'Flota', icon: Truck }, { id: 'clientes', label: 'Clientes', icon: Users }, { id: 'cobros', label: 'Cobros', icon: Wallet },
  { id: 'documentos', label: 'Documentos', icon: FolderOpen }, { id: 'informes', label: 'Informes', icon: FileText }, { id: 'configuracion', label: 'Configuración', icon: Cog },
];
const UserRoundIcon = () => <span className="dot" style={{ color: 'var(--accent)' }} />;
export function Layout({ section, children, routeKey = section }: { section: string; children: ReactNode; routeKey?: string }) {
  const { data, today, user, logout, meta } = useApp();
  const places = [...new Set([...ROSARIO_PLACES, ...data.trips.flatMap(t => [t.origin, t.destination])].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [section]);
  const overdue = data.invoices.filter(i => invoiceTotals(i, data.payments, today, data.settings.dueSoonDays).status === 'vencida').length;
  const label = NAV.find(n => n.id === section)?.label ?? '';
  return (
    <div className="app">
      <datalist id="places">{places.map(p => <option key={p} value={p} />)}</datalist>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Navegación principal">
        <div className="brand-top"><TgLogo onDark size={42} /></div>
        <nav className="nav">
          {NAV.map(n => (
            <a key={n.id} href={href(n.id)} className={section === n.id ? 'active' : ''} aria-current={section === n.id ? 'page' : undefined}>
              <n.icon size={20} /> {n.label}{n.id === 'cobros' && overdue > 0 && <span className="badge-dot" title={`${overdue} facturas vencidas`}>{overdue}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">{data.settings.companyName}<br />Zona horaria: {data.settings.timezone.split('/').pop()?.replace(/_/g, ' ')}<ByRumbo onDark /></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn icon menu-btn" onClick={() => setOpen(o => !o)} aria-label="Abrir menú"><Menu size={20} /></button>
          <strong className="hide-md" style={{ fontSize: 16 }}>{label}</strong>
          <span className="spacer" />
          {data.isDemo && <span className="chip demo" title="Todos los datos de esta instalación son ficticios"><FlaskConical size={14} /> Datos de demostración</span>}
          <span className="chip gray hide-sm" title={`Sesión: ${user.name}`}><UserRoundIcon /> {user.name} · {user.role}</span>
          <InstallButton />
          <button className="btn sm" onClick={logout}><LogOut size={15} /> Salir</button>
          <span className="sr-only">{meta.auth}</span>
        </header>
        <main className="content" key={routeKey}>{children}<footer className="app-foot"><span>{data.settings.companyName}</span><ByRumbo /></footer></main>
      </div>
    </div>
  );
}
