// Comprobantes, documentos con historial y registro de cambios: paneles reutilizables en cada ficha.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileImage, FileText, Paperclip, Plus, Replace, Trash2, Upload } from 'lucide-react';
import { useApp } from '../store';
import { api, saveBlob, toBase64 } from '../api';
import { useBlobUrl } from '../hooks';
import { Field, Modal } from './ui';
import { AttachKind, AuditEntry, Doc, FileMeta, OwnerType } from '../../shared/types';
import { DOC_STATUS, documentRows, documentStatus } from '../../shared/documents';
import { fmtDate, fmtDateTime } from '../../shared/format';

export function FileViewer({ file, onClose }: { file: FileMeta; onClose: () => void }) {
  const { url, error } = useBlobUrl(`/api/files/${file.id}`);
  return (
    <Modal title={file.name} onClose={onClose} size="wide" footer={<><span className="muted small" style={{ marginRight: 'auto' }}>Archivo privado · cargado por {file.uploadedBy} el {fmtDate(file.uploadedAt.slice(0, 10))}</span><button className="btn primary" onClick={() => saveBlob(`/api/files/${file.id}?download=1`, file.name)}><Download size={16} /> Descargar</button></>}>
      {error ? <div className="banner red">{error}</div> : !url ? <p className="muted">Cargando…</p>
        : file.mime === 'application/pdf' ? <iframe title={file.name} src={url} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)' }} /> : <img src={url} alt={file.description || file.name} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }} />}
      {file.description && <p className="muted" style={{ marginBottom: 0 }}>{file.description}</p>}
    </Modal>
  );
}

export const filesFor = (files: FileMeta[], type: AttachKind, id: string) => files.filter(f => (f.entityType === type && f.entityId === id) || f.links.some(l => l.type === type && l.id === id));

export function FilesPanel({ entityType, entityId, title = 'Comprobantes y archivos', links = [], extraIds = [], expenseOptions }: { entityType: AttachKind; entityId: string; title?: string; links?: { type: AttachKind; id: string }[]; extraIds?: string[]; expenseOptions?: { id: string; label: string }[] }) {
  const { data, canEdit, run, toast } = useApp(); const [view, setView] = useState<FileMeta | null>(null); const [adding, setAdding] = useState(false);
  const list = data.files.filter(f => (f.entityType === entityType && f.entityId === entityId) || f.links.some(l => l.type === entityType && l.id === entityId) || extraIds.includes(f.entityId)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return (
    <section className="panel">
      <div className="panel-h"><h2><Paperclip size={16} style={{ verticalAlign: -2 }} /> {title}</h2>{canEdit && <button className="btn sm primary" onClick={() => setAdding(true)}><Upload size={14} /> Adjuntar archivo</button>}</div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Archivo</th><th className="hide-sm">Vinculado a</th><th>Cargado</th><th className="hide-sm">Usuario</th><th></th></tr></thead><tbody>
        {list.map(f => <tr key={f.id}><td className="wrap">{f.mime === 'application/pdf' ? <FileText size={15} style={{ verticalAlign: -3 }} /> : <FileImage size={15} style={{ verticalAlign: -3 }} />} {f.name}<div className="muted small">{f.description || '—'} · {Math.round(f.size / 1024)} KB</div></td>
          <td className="hide-sm small">{[f.entityType, ...f.links.map(l => l.type)].filter((v, i, a) => a.indexOf(v) === i).join(' + ')}</td><td className="small nowrap">{fmtDate(f.uploadedAt.slice(0, 10))}</td><td className="hide-sm small">{f.uploadedBy}</td>
          <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => setView(f)}><Eye size={14} /> Ver</button><button className="btn sm" aria-label="Descargar" onClick={() => saveBlob(`/api/files/${f.id}?download=1`, f.name).catch(e => toast(e.message, 'err'))}><Download size={14} /></button>
            {canEdit && <button className="btn sm ghost danger" aria-label="Eliminar archivo" onClick={() => run(() => api('DELETE', `/api/files/${f.id}`), 'Archivo eliminado')}><Trash2 size={14} /></button>}</div></td></tr>)}
        {!list.length && <tr><td colSpan={5} className="muted">Sin archivos. Los archivos son privados y solo los ven usuarios autorizados.</td></tr>}</tbody></table></div>
      {view && <FileViewer file={view} onClose={() => setView(null)} />}
      {adding && <UploadModal entityType={entityType} entityId={entityId} links={links} expenseOptions={expenseOptions} onClose={() => setAdding(false)} />}
    </section>
  );
}

export function UploadModal({ entityType, entityId, links, expenseOptions, onClose, onUploaded }: { entityType: AttachKind; entityId: string; links: { type: AttachKind; id: string }[]; expenseOptions?: { id: string; label: string }[]; onClose: () => void; onUploaded?: (f: FileMeta) => void }) {
  const { data, run, toast } = useApp(); const [file, setFile] = useState<File | null>(null); const [desc, setDesc] = useState(''); const [exp, setExp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const max = data.settings.maxFileKb;
  const pick = (f: File | null) => { setErr(''); if (f && f.size > max * 1024) { setErr(`El archivo pesa ${Math.round(f.size / 1024)} KB y el límite es ${max} KB`); setFile(null); return; } if (f && !/^(image\/(png|jpeg)|application\/pdf)$/.test(f.type)) { setErr('Solo imágenes PNG/JPG o PDF'); setFile(null); return; } setFile(f); };
  const save = async () => {
    if (!file) return; setBusy(true);
    const body: any = exp ? { entityType: 'gasto', entityId: exp, links: [{ type: entityType, id: entityId }, ...links] } : { entityType, entityId, links };
    const r = await run(async () => api<{ file: FileMeta }>('POST', '/api/files', { ...body, name: file.name, description: desc, dataBase64: await toBase64(file) }));
    setBusy(false); if (r) { toast('Archivo guardado en el servidor'); onUploaded?.(r.file); onClose(); }
  };
  return (
    <Modal title="Adjuntar archivo" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!file || busy} onClick={save}>{busy ? 'Subiendo…' : 'Guardar archivo'}</button></>}>
      <div className="stack">
        <Field label={`Imagen (PNG, JPG) o PDF · hasta ${max} KB`} error={err}><input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => pick(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Descripción"><input type="text" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ej.: Ticket de peaje, remito conformado" /></Field>
        {expenseOptions && expenseOptions.length > 0 && <Field label="Vincular a" hint="Un mismo comprobante puede pertenecer a un gasto y a su viaje sin duplicar el gasto. Adjuntar un archivo no confirma ningún gasto."><select value={exp} onChange={e => setExp(e.target.value)}><option value="">Solo al viaje</option>{expenseOptions.map(o => <option key={o.id} value={o.id}>Gasto: {o.label}</option>)}</select></Field>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ historial
export function AuditTable({ entries, showEntity = false }: { entries: AuditEntry[]; showEntity?: boolean }) {
  const { tz } = useApp(); const [open, setOpen] = useState<string | null>(null);
  const fmtV = (v: unknown) => v == null ? '—' : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'object' && x ? JSON.stringify(x) : x ?? '—'}`).join(' · ') : String(v);
  return (
    <div className="table-wrap"><table className="tbl"><thead><tr><th>Fecha y hora</th><th>Quién</th>{showEntity && <th>Entidad</th>}<th>Acción</th><th>Detalle</th></tr></thead><tbody>
      {entries.map(a => <tr key={a.id} className={a.before || a.after || a.reason ? 'click' : ''} onClick={() => (a.before || a.after || a.reason) && setOpen(open === a.id ? null : a.id)}>
        <td className="nowrap small">{fmtDateTime(a.at, tz)}</td><td className="small">{a.user}{a.actorType === 'proceso' && <span className="chip gray" style={{ marginLeft: 6 }}>automático</span>}</td>{showEntity && <td className="small">{a.entity}</td>}<td className="small">{a.action}</td>
        <td className="wrap small">{a.summary}{a.reason && <div><b>Motivo:</b> {a.reason}</div>}{open === a.id && <div className="muted" style={{ marginTop: 4 }}>{a.before != null && <div><b>Antes:</b> {fmtV(a.before)}</div>}{a.after != null && <div><b>Después:</b> {fmtV(a.after)}</div>}</div>}
          {!open && !!(a.before || a.after) && <span className="muted"> · clic para ver valores</span>}</td></tr>)}
      {!entries.length && <tr><td colSpan={showEntity ? 5 : 4} className="muted">Sin modificaciones registradas.</td></tr>}</tbody></table></div>
  );
}
export function HistoryPanel({ refId, title = 'Historial de cambios', limit = 40 }: { refId: string | string[]; title?: string; limit?: number }) {
  const { data } = useApp(); const ids = Array.isArray(refId) ? refId : [refId];
  const entries = useMemo(() => data.audit.filter(a => a.refs?.some(r => ids.includes(r)) || ids.includes(a.entityId)).slice(0, limit), [data.audit, ...ids]); // eslint-disable-line
  return <section className="panel"><div className="panel-h"><h2>{title}</h2><span className="muted small">Generado por las operaciones del sistema; no se edita</span></div><AuditTable entries={entries} /></section>;
}

// ------------------------------------------------------------------ documentos con historial de reemplazos
export function DocumentsPanel({ ownerType, ownerId, title = 'Documentación' }: { ownerType: OwnerType; ownerId: string; title?: string }) {
  const { data, today, canEdit } = useApp(); const [edit, setEdit] = useState<{ doc: Doc | null; typeId?: string; replaces?: Doc } | null>(null); const [view, setView] = useState<FileMeta | null>(null);
  const rows = documentRows(data, today).filter(r => r.ownerType === ownerType && r.ownerId === ownerId);
  const history = data.documents.filter(d => d.ownerType === ownerType && d.ownerId === ownerId && d.replacedBy).sort((a, b) => (b.expiryDate ?? '').localeCompare(a.expiryDate ?? ''));
  const types = data.settings.documentTypes.filter(t => t.ownerType === ownerType);
  return (
    <section className="panel"><div className="panel-h"><h2>{title}</h2>{canEdit && types.length > 0 && <button className="btn sm primary" onClick={() => setEdit({ doc: null })}><Plus size={14} /> Cargar documento</button>}</div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Documento</th><th>Identificador</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>
        {rows.map(r => <tr key={r.key}><td>{r.type.label}{r.type.required && <span className="muted small"> · requerido</span>}</td><td>{r.doc?.identifier ?? '—'}</td><td className="nowrap">{r.doc?.expiryDate ? <>{fmtDate(r.doc.expiryDate)}{r.days != null && <div className="muted small">{r.days < 0 ? `hace ${-r.days} d` : `en ${r.days} d`}</div>}</> : '—'}</td>
          <td><span className={`chip ${DOC_STATUS[r.status].cls}`}>{DOC_STATUS[r.status].label}</span></td>
          <td className="num"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>{r.doc?.fileId && <button className="btn sm" onClick={() => setView(data.files.find(f => f.id === r.doc!.fileId) ?? null)}><Eye size={14} /> Ver</button>}
            {canEdit && (r.doc ? <button className="btn sm" onClick={() => setEdit({ doc: null, typeId: r.doc!.typeId, replaces: r.doc! })}><Replace size={14} /> Reemplazar</button> : <button className="btn sm primary" onClick={() => setEdit({ doc: null, typeId: r.type.id })}>Cargar</button>)}</div></td></tr>)}
        {!rows.length && <tr><td colSpan={5} className="muted">Sin documentos ni requisitos configurados para este titular.</td></tr>}</tbody></table></div>
      {history.length > 0 && <details style={{ borderTop: '1px solid var(--line)' }}><summary style={{ padding: '10px 16px', cursor: 'pointer' }}>Historial de documentos reemplazados ({history.length})</summary>
        <div className="table-wrap"><table className="tbl"><tbody>{history.map(h => <tr key={h.id}><td>{data.settings.documentTypes.find(t => t.id === h.typeId)?.label}</td><td>{h.identifier}</td><td>venció/vencía {fmtDate(h.expiryDate)}</td><td><span className="chip gray">Reemplazado</span></td><td className="num">{h.fileId && <button className="btn sm" onClick={() => setView(data.files.find(f => f.id === h.fileId) ?? null)}>Ver</button>}</td></tr>)}</tbody></table></div></details>}
      <div className="panel-b muted small" style={{ borderTop: '1px solid var(--line)' }}>El estado refleja solo los datos cargados. Tener documentos vigentes no implica que el vehículo o el chofer estén legalmente habilitados.</div>
      {edit && <DocModal ownerType={ownerType} ownerId={ownerId} init={edit} onClose={() => setEdit(null)} />}{view && <FileViewer file={view} onClose={() => setView(null)} />}
    </section>
  );
}
function DocModal({ ownerType, ownerId, init, onClose }: { ownerType: OwnerType; ownerId: string; init: { doc: Doc | null; typeId?: string; replaces?: Doc }; onClose: () => void }) {
  const { data, run, toast, today, reload } = useApp(); const types = data.settings.documentTypes.filter(t => t.ownerType === ownerType);
  const [typeId, setTypeId] = useState(init.typeId ?? types[0]?.id ?? ''); const type = types.find(t => t.id === typeId);
  const [identifier, setIdentifier] = useState(''); const [issue, setIssue] = useState(today); const [expiry, setExpiry] = useState(''); const [notes, setNotes] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const preview = type ? documentStatus({ expiryDate: expiry || null } as Doc, type, today, data.settings.docAlertDays).status : null;
  const save = async () => {
    setBusy(true); const id = crypto.randomUUID();
    const doc = { id, typeId, ownerType, ownerId, identifier, issueDate: issue || null, expiryDate: expiry || null, fileId: null, notes, replaces: init.replaces?.id };
    const ok = await run(() => api('PUT', `/api/documents/${id}`, doc)); if (!ok) { setBusy(false); return; }
    if (file) {
      try { const f = await api<{ file: FileMeta }>('POST', '/api/files', { entityType: 'documento', entityId: id, name: file.name, description: type?.label, dataBase64: await toBase64(file) }); await api('PUT', `/api/documents/${id}`, { ...doc, fileId: f.file.id, replaces: undefined }); }
      catch (e) { toast(`El documento se guardó, pero el archivo no: ${e instanceof Error ? e.message : 'error'}. Podés adjuntarlo reemplazando el documento.`, 'err'); await reload(); setBusy(false); onClose(); return; }
    }
    await reload(); toast(init.replaces ? 'Documento reemplazado: el anterior quedó en el historial' : 'Documento guardado'); setBusy(false); onClose();
  };
  return (
    <Modal title={init.replaces ? 'Reemplazar documento' : 'Cargar documento'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !identifier.trim() || (!!type?.hasExpiry && !expiry)} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button></>}>
      <div className="grid g2"><Field label="Tipo de documento"><select value={typeId} disabled={!!init.replaces} onChange={e => setTypeId(e.target.value)}>{types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Identificador (n.º, póliza, patente…)"><input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} /></Field>
        <Field label="Fecha de emisión"><input type="date" value={issue} onChange={e => setIssue(e.target.value)} /></Field>
        <Field label={`Fecha de vencimiento${type?.hasExpiry ? ' *' : ' (si existe)'}`} hint={preview ? `Estado resultante: ${DOC_STATUS[preview].label}` : undefined}><input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></Field>
        <Field label={`Archivo (PNG, JPG o PDF, hasta ${data.settings.maxFileKb} KB)`}><input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Observaciones"><input type="text" value={notes} onChange={e => setNotes(e.target.value)} /></Field></div>
      {init.replaces && <p className="muted small">El documento anterior ({init.replaces.identifier}) se conserva en el historial y deja de figurar como vigente.</p>}
    </Modal>
  );
}
void useRef;
