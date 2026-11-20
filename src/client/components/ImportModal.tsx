import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useApp } from '../store';
import { api, ApiError } from '../api';
import { Modal, downloadCsv } from './ui';
import { IMPORT_FIELDS, ImportResult, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS, autoMap, parseCsv } from '../../shared/import';

async function readFile(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = (await readSheet(file)) as unknown[][];
    const p = (n: number) => String(n).padStart(2, '0');
    return rows.map(r => r.map(c => c == null ? '' : c instanceof Date ? `${p(c.getUTCDate())}/${p(c.getUTCMonth() + 1)}/${c.getUTCFullYear()} ${p(c.getUTCHours())}:${p(c.getUTCMinutes())}` : String(c)));
  }
  if (/\.xls$/i.test(file.name)) throw new Error('El formato .xls antiguo no está soportado: guardá el archivo como .xlsx o .csv');
  return parseCsv(await file.text());
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { run, reload, toast } = useApp();
  const [rows, setRows] = useState<string[][] | null>(null); const [name, setName] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [res, setRes] = useState<ImportResult | null>(null); const [busy, setBusy] = useState(false); const [errs, setErrs] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const load = async (f: File) => {
    try { const r = await readFile(f); if (r.length < 2) throw new Error('El archivo no tiene filas de datos'); setRows(r); setName(f.name); setMap(autoMap(r[0])); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer el archivo', 'err'); }
  };
  useEffect(() => {
    if (!rows) return; let live = true; setErrs([]);
    api<{ result: ImportResult }>('POST', '/api/import/trips', { rows, map, commit: false }).then(r => { if (live) { setRes(r.result); } }).catch(e => { if (live) { setRes(null); setErrs(e instanceof ApiError ? e.errors : ['Error de validación']); } });
    return () => { live = false; };
  }, [rows, map]);

  const commit = async () => {
    setBusy(true);
    const r = await run(() => api<{ created: number; result: ImportResult }>('POST', '/api/import/trips', { rows, map, commit: true }));
    setBusy(false); if (r) { toast(`${r.created} viajes importados · ${r.result.rejected} filas rechazadas. Las fichas PDF se generan en segundo plano.`); onClose(); }
    void reload;
  };
  const template = () => downloadCsv('plantilla_viajes_rumbo.csv', [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]);
  const bad = res?.rows.filter(r => !r.trip) ?? [];

  return (
    <Modal title="Importar viajes" size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!res || res.accepted === 0 || busy} onClick={commit}>{busy ? 'Importando…' : `Importar ${res?.accepted ?? 0} viajes`}</button></>}>
      <div className="stack">
        <div className="row between"><div className="row"><button className="btn" onClick={() => input.current?.click()}><Upload size={16} /> Elegir archivo CSV o Excel (.xlsx)</button>
          <input ref={input} type="file" accept=".csv,.xlsx,text/csv" hidden onChange={e => e.target.files?.[0] && load(e.target.files[0])} />
          {name && <span className="chip gray"><FileSpreadsheet size={14} /> {name} · {rows!.length - 1} filas</span>}</div>
          <button className="btn" onClick={template}><Download size={16} /> Descargar plantilla</button></div>
        {!rows && <div className="banner blue"><div>Cargá un archivo con una fila por viaje. En gastos y kilómetros, una <b>celda vacía</b> se importa como dato pendiente y un <b>0</b> como valor confirmado. Los camiones deben existir en la flota; clientes y choferes nuevos se crean automáticamente. Fechas: <code>dd/mm/aaaa hh:mm</code> (hora local de la empresa).</div></div>}
        {rows && <>
          <div><h3 style={{ marginBottom: 8 }}>1. Correspondencia de columnas</h3>
            <div className="grid g3">{IMPORT_FIELDS.map(f => <div className="field" key={f.key}><label>{f.label}{f.required ? ' *' : ''}</label>
              <select value={map[f.key] ?? -1} onChange={e => setMap(m => ({ ...m, [f.key]: Number(e.target.value) }))}><option value={-1}>— No importar —</option>{rows[0].map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}</select></div>)}</div></div>
          <div><h3 style={{ marginBottom: 8 }}>2. Vista previa y validación</h3>
            {errs.length > 0 && <div className="banner red">{errs.join(' · ')}</div>}
            {res && <><div className="row" style={{ marginBottom: 10 }}><span className="chip accent">{res.accepted} aceptadas</span><span className={`chip ${res.rejected ? 'red' : 'gray'}`}>{res.rejected} rechazadas</span>{res.duplicates > 0 && <span className="chip amber">{res.duplicates} posibles duplicados</span>}
              {res.rows.some(r => r.newClient) && <span className="chip blue">Clientes nuevos: {[...new Set(res.rows.filter(r => r.newClient).map(r => r.newClient))].join(', ')}</span>}</div>
              <div className="panel"><div className="table-wrap" style={{ maxHeight: 320 }}><table className="tbl"><thead><tr><th>Fila</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>
                {[...bad, ...res.rows.filter(r => r.trip && r.warnings.length)].slice(0, 60).map(r => <tr key={r.row}><td>{r.row}</td><td>{r.trip ? <span className="chip amber">Aceptada con aviso</span> : <span className="chip red">Rechazada</span>}</td><td className="wrap small">{[...r.errors, ...r.warnings].join(' · ')}</td></tr>)}
                {res.rows.filter(r => r.trip).slice(0, 5).map(r => <tr key={`ok${r.row}`}><td>{r.row}</td><td><span className="chip accent">Aceptada</span></td><td className="small">{r.trip!.id} · {r.trip!.origin} – {r.trip!.destination} · {r.trip!.serviceValue != null ? `$ ${r.trip!.serviceValue.toLocaleString('es-AR')}` : ''}</td></tr>)}
                {res.rows.length > 0 && bad.length === 0 && <tr><td colSpan={3} className="muted small">Sin filas rechazadas. Se muestran 5 filas aceptadas como muestra.</td></tr>}</tbody></table></div></div></>}</div></>}
      </div>
    </Modal>
  );
}
