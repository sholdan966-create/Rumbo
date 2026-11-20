// Persistencia en servidor. Demo: un archivo JSON con escritura atómica.
// Producción: reemplazar esta clase por una base de datos (PostgreSQL) con la misma interfaz y filtrar SIEMPRE por companyId.
import fs from 'node:fs';
import path from 'node:path';
import { CompanyData } from '../shared/types';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export class Store {
  private companies = new Map<string, CompanyData>();
  private timer: NodeJS.Timeout | null = null;
  constructor() {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Record<string, CompanyData>;
      for (const [k, v] of Object.entries(raw)) this.companies.set(k, v);
    }
  }
  has(id: string) { return this.companies.has(id); }
  ids() { return [...this.companies.keys()]; }
  /** Todo acceso a datos pasa por acá: la empresa se resuelve en el servidor, nunca desde el cuerpo de la petición. */
  get(id: string): CompanyData {
    const c = this.companies.get(id); if (!c) throw new Error(`Empresa inexistente: ${id}`); return c;
  }
  set(id: string, data: CompanyData) { this.companies.set(id, data); this.save(); }
  /** Marca cambios y persiste (agrupando escrituras cercanas). */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
  }
  flush() {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.companies)));
    fs.renameSync(tmp, DB_FILE);
  }
  /** Archivos cargados por usuarios (comprobantes, documentos): carpeta privada, nunca servida de forma estática. */
  uploadPath(companyId: string, id: string) { const dir = path.join(FILES_DIR, companyId, 'uploads'); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, path.basename(id)); }
  /** Copia diaria de la base (se conservan 30). Complementa —no reemplaza— un respaldo externo de todo el directorio de datos. */
  backupDaily() {
    try {
      const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `db-${new Date().toISOString().slice(0, 10)}.json`);
      if (fs.existsSync(DB_FILE) && !fs.existsSync(f)) fs.copyFileSync(DB_FILE, f);
      const all = fs.readdirSync(dir).filter(x => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort(); for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, old));
    } catch (e) { console.error('[backup]', e); }
  }
  filePath(companyId: string, name: string) {
    const dir = path.join(FILES_DIR, companyId); fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, path.basename(name)); return p;
  }
}
