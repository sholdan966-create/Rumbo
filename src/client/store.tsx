import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CompanyData, TripCalc } from '../shared/types';
import { computeTrips } from '../shared/calc';
import { fmtMoney } from '../shared/format';
import { localDate } from '../shared/time';
import { api, ApiError, getToken, setToken } from './api';
import { Role } from '../shared/types';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Modal } from './components/ui';
import { STATIC } from './static/backend';

export interface SessionUser { id: string; name: string; role: Role; driverId?: string }
export interface Meta { serverNow: string; mailConfigured: boolean; aiConfigured: boolean; debounceMs: number; demoMode: boolean; auth: string; user: SessionUser }
interface Toast { id: number; kind: 'ok' | 'err' | 'warn'; text: string }

interface Ctx {
  data: CompanyData; meta: Meta; calcs: Map<string, TripCalc>; today: string; tz: string;
  money: (v: number | null | undefined, decimals?: number) => string;
  reload: () => Promise<void>;
  user: SessionUser; role: Role; canEdit: boolean; canAdmin: boolean; logout: () => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;
  /** Ejecuta una acción contra la API mostrando errores; devuelve undefined si falló. */
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
  /** Confirmación propia (los diálogos nativos están bloqueados en algunos entornos). */
  ask: (message: string, confirmLabel?: string) => Promise<boolean>;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error('sin contexto'); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ data: CompanyData; meta: Meta } | null>(null);
  const [error, setError] = useState<string | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const [dlg, setDlg] = useState<{ message: string; label: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((message: string, label = 'Confirmar') => new Promise<boolean>(resolve => setDlg({ message, label, resolve })), []);

  const reload = useCallback(async () => {
    try { const s = await api<{ data: CompanyData; meta: Meta }>('GET', '/api/state'); setState(s); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo conectar con el servidor'); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const busy = state?.data.tripReports.some(r => r.status === 'pendiente' || r.status === 'generando') || state?.data.monthlyReports.some(r => r.status === 'pendiente' || r.status === 'generando');
  useEffect(() => { const t = setInterval(reload, busy ? 2500 : 15000); const f = () => reload(); window.addEventListener('focus', f); return () => { clearInterval(t); window.removeEventListener('focus', f); }; }, [reload, busy]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = ++seq.current; setToasts(t => [...t, { id, kind, text }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'ok' ? 3500 : 7000);
  }, []);
  useEffect(() => { const f = (e: Event) => toast(String((e as CustomEvent).detail)); window.addEventListener('rumbo:toast', f); return () => window.removeEventListener('rumbo:toast', f); }, [toast]);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string) => {
    try { const r = await fn(); await reload(); if (okMsg) toast(okMsg); return r; }
    catch (e) { if (e instanceof ApiError && e.status === 412) await reload(); toast(e instanceof ApiError ? e.errors.join('\n') : e instanceof Error ? e.message : 'Error inesperado', 'err'); return undefined; }
  }, [reload, toast]);

  const data = state?.data;
  const now = useMemo(() => new Date(), [state]); // se recalcula con cada actualización del servidor
  const calcs = useMemo(() => data ? computeTrips({ settings: data.settings, trucks: data.trucks, trips: data.trips, invoices: data.invoices, payments: data.payments, now }) : new Map<string, TripCalc>(), [data, now]);
  if (error && !state) return <div className="content"><div className="banner red"><XCircle size={20} /><div><b>No se pudo conectar con el servidor.</b><div>{error}. Ejecutá <code>npm run dev</code> y recargá la página.</div></div></div></div>;
  if (!state || !data) return <div className="skel-page" aria-busy="true" aria-label="Cargando"><div className="skel" style={{ height: 34, width: 220 }} /><div className="skel" style={{ height: 96 }} /><div className="skel" style={{ height: 240 }} /></div>;
  const value: Ctx = {
    data, meta: state.meta, calcs, tz: data.settings.timezone, today: localDate(now, data.settings.timezone),
    money: (v, d = 0) => fmtMoney(v, data.settings.currency, d), reload, user: state.meta.user, role: state.meta.user.role, canEdit: state.meta.user.role === 'administrador' || state.meta.user.role === 'operador', canAdmin: state.meta.user.role === 'administrador', logout: async () => { try { await api('POST', '/api/auth/logout'); } catch { /* ya cerrada */ } setToken(null); window.location.reload(); }, toast, run, ask,
  };
  return (
    <C.Provider value={value}>
      {STATIC && <div className="banner amber static-banner" role="note"><AlertTriangle size={18} /><div><b>Demostración en el navegador.</b> Sin servidor: los datos viven solo en esta pestaña y los procesos y PDF son <b>simulados</b>. <details style={{ display: "inline" }}><summary style={{ cursor: 'pointer', display: 'inline' }}>Más</summary> Los procesos usan temporizadores del navegador, y las fichas se ven en pantalla en lugar de descargarse. La versión con servidor ejecuta todo aunque la aplicación esté cerrada.</details></div></div>}
      {children}
      {dlg && <Modal title="Confirmar" onClose={() => { dlg.resolve(false); setDlg(null); }} footer={<><button className="btn" onClick={() => { dlg.resolve(false); setDlg(null); }}>Cancelar</button><button className="btn primary" onClick={() => { dlg.resolve(true); setDlg(null); }}>{dlg.label}</button></>}><p style={{ margin: 0 }}>{dlg.message}</p></Modal>}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'warn' ? 'warn' : ''}`}>
          {t.kind === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}<span style={{ whiteSpace: 'pre-line' }}>{t.text}</span></div>)}
      </div>
    </C.Provider>
  );
}
