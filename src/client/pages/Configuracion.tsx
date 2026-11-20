import { useState } from 'react';
import { Mail, Plus, Trash2, Upload, X } from 'lucide-react';
import { useApp } from '../store';
import { api } from '../api';
import { Field, Modal, NumField } from '../components/ui';
import { DocType, Settings } from '../../shared/types';
import { monthlyPool } from '../../shared/calc';
import { fmtDate } from '../../shared/format';
import { STATIC } from '../static/backend';
import { DEFAULT_PAYMENT_METHODS } from '../../shared/templates';

const ZONES = ['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Mendoza', 'America/Santiago', 'America/Montevideo', 'America/Asuncion', 'America/Sao_Paulo', 'America/Lima', 'America/Bogota', 'America/Mexico_City', 'Europe/Madrid', 'UTC'];
type St = 'Operativa' | 'Simulada' | 'Pendiente de configuración' | 'Pendiente de desarrollo';
const chip: Record<St, string> = { Operativa: 'accent', Simulada: 'blue', 'Pendiente de configuración': 'amber', 'Pendiente de desarrollo': 'gray' };

export function Configuracion() {
  const { data, run, canAdmin: canEdit, meta, toast, money, ask } = useApp();
  const [s, setS] = useState<Settings>(data.settings); const [mail, setMail] = useState('');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(x => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const save = () => run(() => api('PUT', '/api/settings', s), 'Configuración guardada');
  const logo = (f: File) => { if (!/^image\/(png|jpeg)$/.test(f.type)) { toast('El logo debe ser PNG o JPG', 'err'); return; } if (f.size > 500_000) { toast('El logo supera 500 KB', 'err'); return; } const r = new FileReader(); r.onload = () => set('logoDataUrl', String(r.result)); r.readAsDataURL(f); };
  const addMail = () => { const m = mail.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) { toast('Correo inválido', 'err'); return; } if (!s.reportRecipients.includes(m)) set('reportRecipients', [...s.reportRecipients, m]); setMail(''); };
  const features: [string, St, string][] = [
    ['Viajes, gastos, facturas y cobros', 'Operativa', 'Alta, edición y baja con validación en cliente y servidor; datos guardados en el servidor.'],
    ['Cálculos e indicadores', 'Operativa', 'Funciones compartidas por pantalla, PDF e informes; con pruebas automáticas.'],
    ['PDF por viaje en segundo plano', 'Operativa', 'Cola persistente en el servidor: estados, 3 intentos, versiones y control de duplicados.'],
    ['Informe mensual', 'Operativa', 'Generación automática por el programador del servidor, manual a pedido, vista y PDF.'],
    ['Importación CSV / Excel (.xlsx)', 'Operativa', 'Plantilla, correspondencia de columnas, validación y duplicados.'],
    ['Alertas de mantenimiento y avisos', 'Operativa', 'Según intervalos configurados; avisos del día generados por el servidor.'],
    ['Sesiones y permisos por rol', 'Operativa', meta.demoMode ? 'El servidor valida la sesión y el rol en cada operación; el chofer solo accede a sus viajes y archivos. Demo: PIN común.' : 'Usuario y contraseña con hash PBKDF2; el servidor valida sesión y rol en cada operación; el chofer solo accede a sus viajes y archivos.'],
    ['Cotizaciones, presupuesto vs. real, documentos, clientes y cobranzas', 'Operativa', 'Con historial de cambios generado por el sistema.'],
    ['Aceptación de cotizaciones', 'Operativa', 'Se registra manualmente: no existe un mecanismo para que el cliente confirme por su cuenta.'],
    ['Lectura automática de tickets (OCR)', 'Pendiente de desarrollo', 'No implementada: las fotos se adjuntan y la oficina carga o aprueba el gasto.'],
    ['Modo sin conexión del portal del chofer', 'Pendiente de desarrollo', 'No implementado: sin conexión se informa que no se guardó y se conserva el formulario.'],
    ...(meta.demoMode ? [['Datos ficticios', 'Simulada', 'Todo el conjunto de datos es de demostración.'] as [string, St, string]] : []),
    ['Envío de correo', 'Pendiente de configuración', meta.mailConfigured ? 'SMTP configurado (código no probado contra un servidor real).' : 'Falta SMTP_URL y MAIL_FROM. Mientras tanto se registra “No enviado”.'],
    ['Redacción del informe con IA', 'Pendiente de configuración', 'Contrato definido, sin conexión a un proveedor. El análisis actual usa reglas y plantillas.'],
    ['Inicio de sesión con proveedor externo (Google/Microsoft), doble factor y varias empresas', 'Pendiente de desarrollo', 'Hoy: una empresa por instalación, usuario y contraseña. Ver README.'],
    ['Base de datos y archivos', 'Operativa', 'Archivo JSON con escritura atómica, copia diaria automática (30 días) y archivos privados en disco. Para varias empresas o alta concurrencia conviene PostgreSQL (ver README).'],
  ];
  const shown = features.map(([n, st, d]): [string, St, string] => STATIC && st === 'Operativa' ? [n, /PDF|mensual|Alertas/.test(n) ? 'Simulada' : 'Operativa', 'Versión estática: ' + (/PDF|mensual|Alertas/.test(n) ? 'proceso simulado con temporizadores del navegador (no corre con la app cerrada). ' : 'los datos viven solo en esta pestaña. ') + d] : [n, st, d]);
  return (
    <>
      <div className="page-head"><div><h1>Configuración</h1><p>Datos de la empresa, criterios de cálculo, informes y envíos.</p></div>
        <div className="page-actions">{dirty && <button className="btn" onClick={() => setS(data.settings)}>Descartar</button>}<button className="btn primary" disabled={!canEdit || !dirty} onClick={save}>Guardar cambios</button></div></div>
      <div className="stack">
        <section className="panel"><div className="panel-h"><h2>Empresa</h2></div><div className="panel-b grid g2">
          <Field label="Nombre comercial"><input type="text" value={s.companyName} onChange={e => set('companyName', e.target.value)} /></Field><Field label="Razón social"><input type="text" value={s.legalName} onChange={e => set('legalName', e.target.value)} /></Field>
          <Field label="CUIT"><input type="text" value={s.cuit} onChange={e => set('cuit', e.target.value)} /></Field><Field label="Teléfono"><input type="text" value={s.phone} onChange={e => set('phone', e.target.value)} /></Field>
          <Field label="Domicilio"><input type="text" value={s.address} onChange={e => set('address', e.target.value)} /></Field><Field label="Correo de la empresa"><input type="email" value={s.email} onChange={e => set('email', e.target.value)} /></Field>
          <Field label="Logo (PNG o JPG, hasta 500 KB)" hint="Se usa en los PDF. Sin logo se muestra un monograma."><div className="row">{s.logoDataUrl ? <img src={s.logoDataUrl} alt="Logo de la empresa" style={{ height: 40, maxWidth: 120, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 4, padding: 2 }} /> : <span className="chip gray">Sin logo</span>}
            <label className="btn sm"><Upload size={14} /> Subir<input type="file" accept="image/png,image/jpeg" hidden onChange={e => e.target.files?.[0] && logo(e.target.files[0])} /></label>{s.logoDataUrl && <button className="btn sm ghost" onClick={() => set('logoDataUrl', null)}><X size={14} /> Quitar</button>}</div></Field></div></section>

        <section className="panel"><div className="panel-h"><h2>Moneda y zona horaria</h2></div><div className="panel-b grid g2">
          <Field label="Moneda"><select value={s.currency} onChange={e => set('currency', e.target.value)}><option value="ARS">Peso argentino (ARS)</option><option value="USD">Dólar estadounidense (USD)</option></select></Field>
          <Field label="Zona horaria" hint="Define el mes de cada viaje y el cierre mensual"><select value={s.timezone} onChange={e => set('timezone', e.target.value)}>{ZONES.map(z => <option key={z} value={z}>{z}</option>)}</select></Field></div></section>

        <section className="panel"><div className="panel-h"><h2>Rentabilidad y cobros</h2></div><div className="panel-b grid g2">
          <NumField label="Objetivo de margen (%)" value={s.marginTarget} onChange={v => v != null && set('marginTarget', v)} hint="Los márgenes por debajo se marcan en ámbar" />
          <Field label="Base de ingresos para rentabilidad" hint="Los cobros y saldos siempre usan el total con IVA"><select value={s.profitabilityBasis} onChange={e => set('profitabilityBasis', e.target.value as Settings['profitabilityBasis'])}><option value="net">Importe neto (sin IVA)</option><option value="gross">Importe total (con IVA)</option></select></Field>
          <Field label="IVA por defecto (%)"><input type="number" value={s.defaultIvaRate * 100} step={0.5} onChange={e => set('defaultIvaRate', Number(e.target.value) / 100)} /></Field>
          <Field label="Días para considerar “por vencer”"><input type="number" min={0} value={s.dueSoonDays} onChange={e => set('dueSoonDays', Number(e.target.value))} /></Field></div></section>

        <section className="panel"><div className="panel-h"><h2>Formas de pago</h2></div><div className="panel-b"><Field label="Opciones al registrar un cobro (separadas por coma)" hint="Ej.: Transferencia, Efectivo, Mercado Pago, Tarjeta, Cuenta corriente"><input type="text" value={(s.paymentMethods ?? DEFAULT_PAYMENT_METHODS).join(', ')} onChange={e => set('paymentMethods', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} /></Field></div></section>

        <section className="panel"><div className="panel-h"><h2>Cotizaciones y combustible</h2></div><div className="panel-b grid g2">
          <NumField label="Precio del combustible ($/litro)" prefix="$" value={s.fuelPricePerLiter} onChange={v => set('fuelPricePerLiter', v)} hint="Con el consumo de cada vehículo (Flota → Parámetros) estima el combustible de una cotización" />
          <NumField label="Vigencia por defecto de una cotización (días)" value={s.quoteValidityDays} onChange={v => v != null && set('quoteValidityDays', v)} />
          <NumField label="Desvío de costo que dispara un aviso (%)" value={s.deviationAlertPct} onChange={v => v != null && set('deviationAlertPct', v)} hint="Real contra el presupuesto de la cotización" />
          <Field label="Condiciones comerciales por defecto"><textarea value={s.quoteTerms} onChange={e => set('quoteTerms', e.target.value)} /></Field></div></section>

        <section className="panel"><div className="panel-h"><h2>Documentación y vencimientos</h2></div><div className="panel-b stack">
          <div className="grid g2"><Field label="Anticipaciones de aviso (días, separados por coma)" hint="Ej.: 30, 15, 7. Un documento pasa a “próximo a vencer” con la mayor anticipación."><input type="text" value={s.docAlertDays.join(', ')} onChange={e => set('docAlertDays', e.target.value.split(/[,\s]+/).map(Number).filter(n => n > 0))} /></Field>
            <Field label="Tramos de antigüedad de deuda (días)" hint="Ej.: 30, 60, 90"><input type="text" value={s.agingBuckets.join(', ')} onChange={e => set('agingBuckets', e.target.value.split(/[,\s]+/).map(Number).filter(n => n > 0))} /></Field></div>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Tipo de documento</th><th>Titular</th><th>Tiene vencimiento</th><th>Requerido</th><th></th></tr></thead><tbody>
            {s.documentTypes.map((t, i) => { const up = (p: Partial<DocType>) => set('documentTypes', s.documentTypes.map((x, j) => j === i ? { ...x, ...p } : x)); return <tr key={t.id}><td><input type="text" aria-label="Nombre del tipo" value={t.label} disabled={!canEdit} onChange={e => up({ label: e.target.value })} /></td>
              <td><select value={t.ownerType} disabled={!canEdit} onChange={e => up({ ownerType: e.target.value as DocType['ownerType'] })}><option value="empresa">Empresa</option><option value="vehiculo">Vehículo</option><option value="chofer">Chofer</option></select></td>
              <td><input type="checkbox" aria-label="Tiene vencimiento" disabled={!canEdit} checked={t.hasExpiry} onChange={e => up({ hasExpiry: e.target.checked })} /></td><td><input type="checkbox" aria-label="Requerido" disabled={!canEdit} checked={t.required} onChange={e => up({ required: e.target.checked })} /></td>
              <td><button className="btn icon ghost danger" aria-label="Quitar tipo" disabled={!canEdit || data.documents.some(d => d.typeId === t.id)} title={data.documents.some(d => d.typeId === t.id) ? 'Tiene documentos cargados' : ''} onClick={() => set('documentTypes', s.documentTypes.filter((_, j) => j !== i))}><Trash2 size={16} /></button></td></tr>; })}</tbody></table></div>
          <div className="row between"><button className="btn sm" disabled={!canEdit} onClick={() => set('documentTypes', [...s.documentTypes, { id: `tipo-${Date.now().toString(36)}`, label: 'Nuevo tipo', ownerType: 'vehiculo', hasExpiry: true, required: false }])}><Plus size={14} /> Agregar tipo</button><span className="muted small">“Requerido” genera un “Pendiente de cargar” hasta que exista el documento. Tener documentos cargados no implica por sí solo que la operación esté habilitada.</span></div></div></section>

        <section className="panel"><div className="panel-h"><h2>Archivos y portal del chofer</h2></div><div className="panel-b stack">
          <NumField label="Tamaño máximo por archivo (KB)" value={s.maxFileKb} onChange={v => v != null && set('maxFileKb', v)} hint="Se aceptan imágenes PNG/JPG y PDF; el servidor valida el contenido del archivo" />
          <div className="stack" style={{ gap: 8 }}><b>Información financiera visible para el chofer</b>
            <label className="check"><input type="checkbox" disabled={!canEdit} checked={s.driverPortal.showTripValue} onChange={e => set('driverPortal', { ...s.driverPortal, showTripValue: e.target.checked })} /> Mostrar el valor del servicio de sus viajes</label>
            <label className="check"><input type="checkbox" disabled={!canEdit} checked={s.driverPortal.showExpenseTotals} onChange={e => set('driverPortal', { ...s.driverPortal, showExpenseTotals: e.target.checked })} /> Mostrar los gastos cargados por la oficina y el total de gastos</label>
            <span className="muted small">Los márgenes, costos internos, presupuestos y datos de otros viajes nunca se envían al portal del chofer.</span></div></div></section>

        <Accounts />

        <section className="panel"><div className="panel-h"><h2>Parámetros de costos</h2><a href={'#/flota'}>Editar por camión en Flota</a></div>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Camión</th><th className="num">Costos operativos mensuales</th><th className="num hide-sm">Mantenimiento $/km</th><th className="hide-sm">Parámetros actualizados</th></tr></thead><tbody>
            {data.trucks.map(t => <tr key={t.id}><td>{t.name}</td><td className="num">{money(monthlyPool(t))}</td><td className="num hide-sm">{t.params.maintenancePerKm != null ? money(t.params.maintenancePerKm) : '—'}</td><td className="hide-sm">{fmtDate(t.params.updatedAt)}</td></tr>)}</tbody></table></div>
          <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Regla de asignación: los costos operativos mensuales de cada camión se reparten entre sus viajes finalizados del mes en proporción a los km. Las estimaciones de mantenimiento, neumáticos y depreciación se calculan aparte y no se suman al costo.</div></section>

        <section className="panel"><div className="panel-h"><h2>Informes y envío</h2><span className={`chip ${meta.mailConfigured ? 'accent' : 'amber'}`}><Mail size={14} /> Correo: {meta.mailConfigured ? 'SMTP configurado' : 'sin configurar'}</span></div><div className="panel-b stack">
          <Field label="Destinatarios de los informes"><div>{s.reportRecipients.map(m => <span className="tag" key={m}>{m}<button aria-label={`Quitar ${m}`} onClick={() => set('reportRecipients', s.reportRecipients.filter(x => x !== m))}><X size={13} /></button></span>)}
            <div className="row" style={{ marginTop: 6 }}><input type="email" style={{ maxWidth: 320 }} value={mail} placeholder="nombre@empresa.com" onChange={e => setMail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMail()} /><button className="btn" onClick={addMail}><Plus size={14} /> Agregar</button></div></div></Field>
          <div className="grid g2"><NumField label="Día del mes de generación del informe mensual" value={s.monthlyReportDay} onChange={v => v != null && set('monthlyReportDay', v)} hint="Entre 1 y 28. Se genera el informe del mes anterior." /><NumField label="Hora de generación (0–23)" value={s.monthlyReportHour} onChange={v => v != null && set('monthlyReportHour', v)} /></div>
          <div className="stack" style={{ gap: 8 }}><label className="check"><input type="checkbox" checked={s.emailOnTripReport} onChange={e => set('emailOnTripReport', e.target.checked)} /> Enviar por correo cada ficha de viaje al generarse</label>
            <label className="check"><input type="checkbox" checked={s.emailOnMonthlyReport} onChange={e => set('emailOnMonthlyReport', e.target.checked)} /> Enviar por correo el informe mensual (resumen y enlace con acceso autorizado)</label>
            <label className="check"><input type="checkbox" checked={s.emailOverdueDigest} onChange={e => set('emailOverdueDigest', e.target.checked)} /> Enviar resumen diario de avisos (cobros vencidos, datos pendientes, servicios)</label>
            <label className="check" style={{ opacity: .7 }}><input type="checkbox" disabled checked={false} readOnly /> Redactar el análisis mensual con IA <span className="chip amber">Pendiente de configuración</span></label></div>
          {!meta.mailConfigured && <div className="banner amber">Mientras falte la configuración SMTP del servidor, los envíos quedan registrados como “No enviado”. Las vistas previas y descargas siguen funcionando.</div>}</div></section>

        <Directory />

        <section className="panel"><div className="panel-h"><h2>Estado de las funciones</h2></div><div className="panel-b"><ul className="statuslist">{shown.map(([n, st, d]) => <li key={n}><div><span className={`chip ${chip[st]}`}>{st}</span></div><div><b>{n}</b><div className="muted small">{d}</div></div></li>)}</ul></div></section>

        {meta.demoMode && <section className="panel"><div className="panel-h"><h2>Controles de demostración</h2><span className="chip demo">Solo demo</span></div><div className="panel-b row">
          <button className="btn" onClick={() => run(() => api('POST', '/api/dev/fail-next', { n: 3 }), 'Los próximos 3 intentos de PDF fallarán (simulado)')}>Simular fallo de PDF</button>
          <button className="btn danger" onClick={async () => { if (await ask('Se borrarán los cambios y se regenerarán los datos de demostración. ¿Continuar?', 'Restablecer')) run(() => api('POST', '/api/dev/reset', {}), 'Datos de demostración restablecidos'); }}>Restablecer datos de demostración</button>
          <span className="muted small">El fallo simulado sirve para mostrar estados de error, reintentos y la acción “Reintentar”.</span></div></section>}
      </div>
    </>
  );
}

const ROLES: Record<string, string> = { administrador: 'Administrador', operador: 'Operador', consulta: 'Solo consulta', chofer: 'Chofer' };
function Accounts() {
  const { data, canAdmin, meta, run, user } = useApp(); const [edit, setEdit] = useState<{ id: string | null } | null>(null); const [pw, setPw] = useState<string | null>(null); const [mine, setMine] = useState(false);
  return <>
    <section className="panel"><div className="panel-h"><h2>Mi cuenta</h2><button className="btn sm" onClick={() => setMine(true)}>Cambiar mi contraseña</button></div><div className="panel-b small muted">Sesión de {user.name} ({ROLES[user.role]}).</div></section>
    {meta.demoMode ? <section className="panel"><div className="panel-h"><h2>Usuarios</h2><span className="chip demo">Demostración</span></div><div className="panel-b muted small">En la demostración los usuarios son fijos y comparten un PIN. Una instalación real permite crear usuarios con contraseña propia.</div></section>
    : canAdmin && <section className="panel"><div className="panel-h"><h2>Usuarios</h2><button className="btn sm primary" onClick={() => setEdit({ id: null })}><Plus size={14} /> Agregar usuario</button></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>{data.users.map(u => <tr key={u.id}><td>{u.name}{u.driverId && <div className="muted small">Chofer: {data.drivers.find(d => d.id === u.driverId)?.name}</div>}</td><td>{u.username ?? '—'}</td><td>{ROLES[u.role]}</td><td>{u.active === false ? <span className="chip gray">Desactivado</span> : <span className="chip accent">Activo</span>}</td>
        <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => setEdit({ id: u.id })}>Editar</button><button className="btn sm" onClick={() => setPw(u.id)}>Restablecer contraseña</button></div></td></tr>)}</tbody></table></div>
      <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>Las contraseñas se guardan con hash (PBKDF2) y nunca se muestran. Administrador y operador gestionan; consulta solo lee; chofer solo ve el portal móvil con sus viajes. Al desactivar un usuario o cambiar su contraseña se cierran sus sesiones.</div></section>}
    {edit && <UserModal id={edit.id} onClose={() => setEdit(null)} />}{pw && <PwModal userId={pw} onClose={() => setPw(null)} />}{mine && <PwModal userId={null} onClose={() => setMine(false)} />}
  </>;
}
function UserModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, run } = useApp(); const cur = data.users.find(u => u.id === id);
  const [v, setV] = useState({ name: cur?.name ?? '', username: cur?.username ?? '', role: cur?.role ?? 'operador', driverId: cur?.driverId ?? '', active: cur?.active !== false, password: '' });
  const save = async () => { const ok = await run(() => id ? api('PUT', `/api/users/${id}`, { name: v.name, role: v.role, driverId: v.driverId || undefined, active: v.active }) : api('POST', '/api/users', v), id ? 'Usuario actualizado' : 'Usuario creado'); if (ok) onClose(); };
  return <Modal title={id ? 'Editar usuario' : 'Agregar usuario'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!v.name.trim() || (!id && (!v.username || !v.password))} onClick={save}>Guardar</button></>}>
    <div className="grid g2"><Field label="Nombre y apellido"><input type="text" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>{!id && <Field label="Usuario" hint="Letras, números, punto o guion"><input type="text" autoCapitalize="none" value={v.username} onChange={e => setV({ ...v, username: e.target.value })} /></Field>}
      <Field label="Rol"><select value={v.role} onChange={e => setV({ ...v, role: e.target.value as typeof v.role })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {v.role === 'chofer' && <Field label="Chofer asociado" hint="Debe estar cargado en la lista de choferes"><select value={v.driverId} onChange={e => setV({ ...v, driverId: e.target.value })}><option value="">Elegí…</option>{data.drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
      {!id && <Field label="Contraseña inicial" hint="Mínimo 10 caracteres, no solo números"><input type="password" autoComplete="new-password" value={v.password} onChange={e => setV({ ...v, password: e.target.value })} /></Field>}</div>
    {id && <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={v.active} onChange={e => setV({ ...v, active: e.target.checked })} /> Usuario activo</label>}</Modal>;
}
function PwModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { run } = useApp(); const [cur, setCur] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState('');
  const save = async () => { const ok = await run(() => userId ? api('POST', `/api/users/${userId}/password`, { password: a }) : api('POST', '/api/auth/password', { current: cur, next: a }), 'Contraseña actualizada'); if (ok) onClose(); };
  return <Modal title={userId ? 'Restablecer contraseña' : 'Cambiar mi contraseña'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!a || a !== b || (!userId && !cur)} onClick={save}>Guardar</button></>}>
    <div className="stack">{!userId && <Field label="Contraseña actual"><input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></Field>}
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, no solo números"><input type="password" autoComplete="new-password" value={a} onChange={e => setA(e.target.value)} /></Field><Field label="Repetir" error={b && a !== b ? 'No coinciden' : undefined}><input type="password" autoComplete="new-password" value={b} onChange={e => setB(e.target.value)} /></Field>
      {userId && <p className="muted small" style={{ margin: 0 }}>Se cerrarán las sesiones abiertas de ese usuario.</p>}</div></Modal>;
}

function Directory() {
  const { data, run, canEdit } = useApp(); const [c, setC] = useState(''); const [d, setD] = useState('');
  return <section className="panel"><div className="panel-h"><h2>Clientes y choferes</h2></div><div className="panel-b grid g2">
    <div><b>Clientes ({data.clients.length})</b><ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>{data.clients.map(x => <li key={x.id} className="row between" style={{ padding: '4px 0', borderBottom: '1px solid var(--line-2)' }}><span>{x.name}</span><span className="muted small">{x.paymentTermDays} días</span></li>)}</ul>
      <div className="row"><input type="text" style={{ maxWidth: 260 }} placeholder="Nuevo cliente" value={c} onChange={e => setC(e.target.value)} /><button className="btn" disabled={!canEdit || !c.trim()} onClick={async () => { const id = `C${Date.now().toString(36)}`; if (await run(() => api('PUT', `/api/clients/${id}`, { id, name: c.trim(), cuit: '', paymentTermDays: 30 }), 'Cliente agregado')) setC(''); }}><Plus size={14} /> Agregar</button></div></div>
    <div><b>Choferes ({data.drivers.length})</b><ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>{data.drivers.map(x => <li key={x.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--line-2)' }}>{x.name}</li>)}</ul>
      <div className="row"><input type="text" style={{ maxWidth: 260 }} placeholder="Nuevo chofer" value={d} onChange={e => setD(e.target.value)} /><button className="btn" disabled={!canEdit || !d.trim()} onClick={async () => { const id = `D${Date.now().toString(36)}`; if (await run(() => api('PUT', `/api/drivers/${id}`, { id, name: d.trim() }), 'Chofer agregado')) setD(''); }}><Plus size={14} /> Agregar</button></div></div></div></section>;
}
void Trash2;
