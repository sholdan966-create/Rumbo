import { ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Eye, EyeOff, FlaskConical, LockKeyhole, Truck, UserRound } from 'lucide-react';
import { api, ApiError, getToken, setToken } from './api';
import { SessionUser } from './store';
import { Field } from './components/ui';
import { STATIC } from './static/backend';
import { ByRumbo, TgLogo } from './components/Brand';
import { BRAND } from '../shared/brand';

const ROLE: Record<string, string> = { administrador: 'Administrador', operador: 'Operador', consulta: 'Solo consulta', chofer: 'Chofer' };
const LAST_USER = 'rumbo.lastUser';
const getLast = () => { try { return localStorage.getItem(LAST_USER) ?? ''; } catch { return ''; } };

function Logo({ dark = false }: { dark?: boolean }) {
  return <div className="brand" style={{ padding: 0, color: dark ? '#fff' : 'var(--ink)' }}><div className="brand-mark" style={{ background: dark ? '#0E1A24' : 'var(--nav)' }}><svg width="20" height="20" viewBox="0 0 32 32"><path d="M9 22V10h7a4 4 0 010 8h-7m7 0l5 4" fill="none" stroke="#2DD4BF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
    <div><b style={{ color: 'inherit' }}>RUMBO</b><span style={{ color: dark ? '#9FB4C4' : 'var(--ink-2)' }}>Gestión de transporte</span></div></div>;
}

/** Pantalla dividida: panel de marca (escritorio) + formulario. En el celular el panel se reduce a una franja. */
function AuthShell({ children, notice, shake }: { children: ReactNode; notice?: ReactNode; shake?: number }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <TgLogo onDark size={52} />
        <div className="auth-pitch"><h1>Cada viaje, con su resultado.</h1>
          <ul><li>Costo, margen y comparación contra lo cotizado, viaje por viaje.</li><li>Los choferes cargan gastos y fotos de tickets desde el celular.</li><li>Cobros, vencimientos de documentos y servicios al día.</li></ul></div>
        <div className="auth-foot"><div>{BRAND.company} · {BRAND.city}</div><ByRumbo onDark /></div>
      </aside>
      <main className="auth-main"><div className={`auth-card ${shake ? 'shake' : ''}`} key={shake ?? 0}>{notice}{children}</div></main>
    </div>
  );
}

function PasswordInput({ value, onChange, label = 'Contraseña', autoComplete, error, hint, id }: { value: string; onChange: (v: string) => void; label?: string; autoComplete: string; error?: string; hint?: ReactNode; id?: string }) {
  const [show, setShow] = useState(false); const [caps, setCaps] = useState(false);
  return (
    <Field label={label} error={error} hint={caps ? <span style={{ color: 'var(--amber)' }}>Tenés las mayúsculas activadas</span> : hint}>
      <div className="pw-wrap"><input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={e => onChange(e.target.value)} onKeyUp={e => setCaps(e.getModifierState?.('CapsLock') ?? false)} onBlur={() => setCaps(false)} />
        <button type="button" className="pw-eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={show}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
    </Field>
  );
}

const rules = (p: string) => [{ ok: p.length >= 10, t: 'Al menos 10 caracteres' }, { ok: !/^\d*$/.test(p), t: 'No puede ser solo números' }, { ok: /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(p) && /\d|[^a-zA-Z0-9]/.test(p), t: 'Recomendado: mezclar letras con números o símbolos' }];
function Strength({ p }: { p: string }) {
  if (!p) return null; const r = rules(p); const score = (p.length >= 10 ? 1 : 0) + (p.length >= 14 ? 1 : 0) + (r[2].ok ? 1 : 0) + (r[1].ok ? 0 : -2); const lvl = !r[0].ok || !r[1].ok ? 0 : Math.max(1, Math.min(3, score));
  const label = ['Débil: no cumple los requisitos', 'Aceptable', 'Buena', 'Muy buena'][lvl]; const color = ['var(--red)', 'var(--amber)', 'var(--accent)', 'var(--accent)'][lvl];
  return <div aria-live="polite"><div className="strength"><span style={{ width: `${(lvl + (lvl ? 0 : 0.5)) * 25}%`, background: color }} /></div><ul className="rules">{r.map(x => <li key={x.t} className={x.ok ? 'ok' : ''}>{x.ok ? <Check size={14} /> : <span className="dot" />} {x.t}</li>)}</ul><div className="small" style={{ color }}>{label}</div></div>;
}

function ErrorBox({ msg }: { msg: string }) { return msg ? <div className="banner red" role="alert"><AlertTriangle size={18} /><div>{msg}</div></div> : null; }

// ------------------------------------------------------------------ instalación inicial
export function Setup({ needsToken, onDone }: { needsToken: boolean; onDone: (u: SessionUser) => void }) {
  const [step, setStep] = useState(1); const [v, setV] = useState({ name: BRAND.company, cuit: '', address: BRAND.city, phone: BRAND.phone, adminName: '', username: '', password: '', password2: '', setupToken: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const pwOk = rules(v.password).slice(0, 2).every(x => x.ok);
  const next = (e: React.FormEvent) => { e.preventDefault(); if (v.name.trim()) setStep(2); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (v.password !== v.password2) { setErr('Las contraseñas no coinciden'); return; } setBusy(true); setErr('');
    try { const r = await api<{ token: string; user: SessionUser }>('POST', '/api/setup', { setupToken: v.setupToken, company: { name: v.name, legalName: v.name, cuit: v.cuit, address: v.address, phone: v.phone }, admin: { name: v.adminName, username: v.username, password: v.password } }); setToken(r.token, false); try { localStorage.setItem(LAST_USER, v.username.trim().toLowerCase()); } catch { /* ignorar */ } onDone(r.user); }
    catch (x) { setErr(x instanceof ApiError ? x.errors.join(' · ') : 'No se pudo completar la instalación'); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <div className="steps" aria-label="Progreso"><span className={step >= 1 ? 'on' : ''}>1 · Empresa</span><span className={step >= 2 ? 'on' : ''}>2 · Administrador</span></div>
      <h2 style={{ fontSize: 22 }}>{step === 1 ? `Bienvenido a la gestión de ${BRAND.short}` : 'Creá tu usuario administrador'}</h2>
      <p className="muted" style={{ margin: '-6px 0 0' }}>{step === 1 ? 'Empecemos con los datos de la empresa. Los vas a poder cambiar después.' : 'Con este usuario vas a cargar camiones, choferes y clientes, y a crear los usuarios del resto del equipo.'}</p>
      {step === 1 ? <form className="stack" onSubmit={next}>
        <Field label="Nombre o razón social"><input type="text" autoFocus value={v.name} onChange={set('name')} autoComplete="organization" /></Field>
        <div className="grid g2"><Field label="CUIT"><input type="text" inputMode="numeric" value={v.cuit} onChange={set('cuit')} placeholder="30-00000000-0" /></Field><Field label="Teléfono"><input type="tel" value={v.phone} onChange={set('phone')} /></Field></div>
        <Field label="Domicilio"><input type="text" value={v.address} onChange={set('address')} placeholder="Calle y número, Rosario" autoComplete="street-address" /></Field>
        {needsToken && <Field label="Código de instalación" hint="Aparece en el registro (log) del servidor al iniciarlo por primera vez, o en la variable SETUP_TOKEN."><input type="text" value={v.setupToken} onChange={set('setupToken')} autoComplete="off" /></Field>}
        <button className="btn primary" disabled={!v.name.trim() || (needsToken && !v.setupToken.trim())}>Continuar</button></form>
      : <form className="stack" onSubmit={submit}>
        <Field label="Nombre y apellido"><input type="text" autoFocus value={v.adminName} onChange={set('adminName')} autoComplete="name" /></Field>
        <Field label="Usuario" hint="Con este nombre vas a ingresar. Ej.: nombre.apellido"><input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={v.username} onChange={set('username')} autoComplete="username" /></Field>
        <PasswordInput label="Contraseña" value={v.password} onChange={p => setV({ ...v, password: p })} autoComplete="new-password" /><Strength p={v.password} />
        <PasswordInput label="Repetir contraseña" value={v.password2} onChange={p => setV({ ...v, password2: p })} autoComplete="new-password" error={v.password2 && v.password !== v.password2 ? 'No coinciden' : undefined} />
        <ErrorBox msg={err} />
        <div className="row"><button type="button" className="btn" onClick={() => { setStep(1); setErr(''); }}>Volver</button><button className="btn primary" style={{ flex: 1 }} disabled={busy || !v.adminName.trim() || !v.username.trim() || !pwOk || v.password !== v.password2}>{busy ? 'Creando…' : 'Crear empresa e ingresar'}</button></div></form>}
    </AuthShell>
  );
}

// ------------------------------------------------------------------ ingreso
function RealLogin({ onLogin, expired }: { onLogin: (u: SessionUser) => void; expired: boolean }) {
  const [username, setU] = useState(getLast()); const [password, setP] = useState(''); const [remember, setR] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [shake, setShake] = useState(0); const pw = useRef<HTMLDivElement>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<{ token: string; user: SessionUser }>('POST', '/api/auth/login', { username, password, remember }); setToken(r.token, remember); try { localStorage.setItem(LAST_USER, username.trim().toLowerCase()); } catch { /* ignorar */ } onLogin(r.user); }
    catch (x) { setErr(x instanceof ApiError ? (x.status === 0 ? x.errors.join(' ') : x.errors.join(' ')) : 'No se pudo iniciar sesión'); setP(''); setShake(n => n + 1); setTimeout(() => pw.current?.querySelector('input')?.focus(), 0); } finally { setBusy(false); }
  };
  return (
    <AuthShell shake={shake} notice={expired ? <div className="banner blue" role="status"><div>Tu sesión venció o se cerró. Ingresá de nuevo para continuar.</div></div> : undefined}>
      <h2 style={{ fontSize: 22 }}>Ingresá a tu cuenta</h2>
      <form className="stack" onSubmit={submit}>
        <Field label="Usuario"><input type="text" autoFocus={!username} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={e => setU(e.target.value)} /></Field>
        <div ref={pw}><PasswordInput value={password} onChange={setP} autoComplete="current-password" /></div>
        <ErrorBox msg={err} />
        <label className="check"><input type="checkbox" checked={remember} onChange={e => setR(e.target.checked)} /> Recordarme en este dispositivo <span className="muted small">(30 días)</span></label>
        <button className="btn primary big-btn" style={{ minHeight: 48, fontSize: 16 }} disabled={busy || !username.trim() || !password}><LockKeyhole size={16} /> {busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="muted small" style={{ margin: 0 }}>¿Olvidaste tu contraseña? Pedile al administrador que la restablezca. En un dispositivo compartido no uses “Recordarme”.</p>
      </form>
    </AuthShell>
  );
}

/** Demostración: elegir un usuario ficticio. */
export function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [users, setUsers] = useState<SessionUser[]>([]); const [sel, setSel] = useState(''); const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [demoPin, setDemoPin] = useState('');
  useEffect(() => { api<{ users: SessionUser[]; demoPin?: string }>('GET', '/api/auth/users').then(r => { setUsers(r.users); setDemoPin(r.demoPin ?? ''); }).catch(e => setErr(e instanceof Error ? e.message : 'No se pudo conectar')); }, []);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!sel) return; setBusy(true); setErr('');
    try { const r = await api<{ token: string; user: SessionUser }>('POST', '/api/auth/login', { userId: sel, pin }); setToken(r.token, false); onLogin(r.user); }
    catch (x) { setErr(x instanceof ApiError ? x.errors.join(' ') : 'No se pudo iniciar sesión'); } finally { setBusy(false); }
  };
  const staff = users.filter(u => u.role !== 'chofer'), drivers = users.filter(u => u.role === 'chofer');
  const pick = (u: SessionUser) => (<button type="button" key={u.id} className={`truck-item ${sel === u.id ? 'on' : ''}`} onClick={() => { setSel(u.id); setErr(''); }}><b>{u.name}</b><span className="muted small">{ROLE[u.role]}</span></button>);
  return (
    <AuthShell>
      <div className="banner amber"><FlaskConical size={18} /><div><b>Demostración.</b> Elegí un usuario ficticio{demoPin ? <> e ingresá el PIN <b>{demoPin}</b></> : ''}. {STATIC ? 'Sin servidor: las sesiones y permisos corren en el navegador.' : 'Las sesiones y los permisos los valida el servidor.'}</div></div>
      {users.length > 0 ? <form className="stack" onSubmit={submit}>
        <div><div className="form-section"><UserRound size={14} style={{ verticalAlign: -2 }} /> Oficina</div><div className="panel truck-list">{staff.map(pick)}</div></div>
        <div><div className="form-section"><Truck size={14} style={{ verticalAlign: -2 }} /> Choferes (portal móvil)</div><div className="panel truck-list">{drivers.map(pick)}</div></div>
        <Field label="PIN" error={err}><input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} /></Field>
        <button className="btn primary" disabled={!sel || !pin || busy}><LockKeyhole size={16} /> {busy ? 'Ingresando…' : 'Ingresar'}</button></form> : (err ? <ErrorBox msg={err} /> : <p className="muted">Cargando…</p>)}
    </AuthShell>
  );
}

function Entry({ onLogin, expired }: { onLogin: (u: SessionUser) => void; expired: boolean }) {
  const [st, setSt] = useState<{ needsSetup: boolean; demo: boolean; needsToken: boolean } | null>(null); const [err, setErr] = useState('');
  const load = () => { setErr(''); api<{ needsSetup: boolean; demo: boolean; needsToken: boolean }>('GET', '/api/setup/status').then(setSt).catch(e => setErr(e instanceof Error ? e.message : 'No se pudo conectar con el servidor')); };
  useEffect(load, []);
  if (err) return <AuthShell><h2>No se pudo conectar</h2><ErrorBox msg={err} /><button className="btn" onClick={load}>Reintentar</button></AuthShell>;
  if (!st) return <div className="login-wrap"><p className="muted">Cargando…</p></div>;
  if (st.needsSetup) return <Setup needsToken={st.needsToken} onDone={onLogin} />;
  return st.demo ? <Login onLogin={onLogin} /> : <RealLogin onLogin={onLogin} expired={expired} />;
}

/** Puerta de entrada: sin sesión válida se muestra el ingreso; el rol decide qué aplicación se carga. */
export function Gate({ staff, driver }: { staff: ReactNode; driver: (u: SessionUser) => ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null); const [checking, setChecking] = useState(!!getToken()); const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (getToken()) api<{ user: SessionUser }>('GET', '/api/auth/me').then(r => setUser(r.user)).catch(() => { setToken(null); setExpired(true); }).finally(() => setChecking(false));
    const f = () => { setToken(null); setUser(null); setExpired(true); }; window.addEventListener('rumbo:unauthorized', f); return () => window.removeEventListener('rumbo:unauthorized', f);
  }, []);
  if (checking) return <div className="login-wrap"><p className="muted">Cargando…</p></div>;
  if (!user) return <Entry onLogin={u => { setExpired(false); setUser(u); }} expired={expired} />;
  return <>{user.role === 'chofer' ? driver(user) : staff}</>;
}
