import { CompanyData, Doc, DocType, OwnerType } from './types';
import { daysBetween } from './time';

export type DocStatus = 'vigente' | 'proximo' | 'vencido' | 'sin_vencimiento' | 'pendiente';
export const DOC_STATUS: Record<DocStatus, { label: string; cls: string }> = {
  vigente: { label: 'Vigente', cls: 'accent' }, proximo: { label: 'Próximo a vencer', cls: 'amber' }, vencido: { label: 'Vencido', cls: 'red' },
  sin_vencimiento: { label: 'Sin vencimiento', cls: 'gray' }, pendiente: { label: 'Pendiente de cargar', cls: 'amber' },
};
export const currentDocs = (d: Pick<CompanyData, 'documents'>) => d.documents.filter(x => !x.replacedBy);
/** Estado de un documento. Con la mayor anticipación configurada (p. ej. 30) pasa a "próximo a vencer". */
export function documentStatus(doc: Doc | null, type: DocType | undefined, today: string, alertDays: number[]): { status: DocStatus; days: number | null } {
  if (!doc) return { status: type?.required ? 'pendiente' : 'sin_vencimiento', days: null };
  if (!doc.expiryDate) return { status: 'sin_vencimiento', days: null };
  const days = daysBetween(today, doc.expiryDate);
  if (days < 0) return { status: 'vencido', days };
  return { status: days <= Math.max(0, ...alertDays) ? 'proximo' : 'vigente', days };
}
export const ownerLabel = (d: Pick<CompanyData, 'trucks' | 'drivers' | 'settings'>, t: OwnerType, id: string) =>
  t === 'empresa' ? d.settings.companyName : t === 'vehiculo' ? (d.trucks.find(x => x.id === id)?.name ?? id) : (d.drivers.find(x => x.id === id)?.name ?? id);
export const ownersOf = (d: Pick<CompanyData, 'trucks' | 'drivers'>, t: OwnerType): string[] => t === 'empresa' ? ['empresa'] : t === 'vehiculo' ? d.trucks.map(x => x.id) : d.drivers.map(x => x.id);

export interface DocRow { key: string; ownerType: OwnerType; ownerId: string; owner: string; type: DocType; doc: Doc | null; status: DocStatus; days: number | null }
/** Filas = documentos vigentes + faltantes requeridos por la configuración. Tener documentos cargados NO implica habilitación legal. */
export function documentRows(d: CompanyData, today: string): DocRow[] {
  const rows: DocRow[] = []; const cur = currentDocs(d);
  for (const doc of cur) { const type = d.settings.documentTypes.find(t => t.id === doc.typeId); if (!type) continue; const s = documentStatus(doc, type, today, d.settings.docAlertDays); rows.push({ key: doc.id, ownerType: doc.ownerType, ownerId: doc.ownerId, owner: ownerLabel(d, doc.ownerType, doc.ownerId), type, doc, ...s }); }
  for (const type of d.settings.documentTypes.filter(t => t.required)) for (const id of ownersOf(d, type.ownerType))
    if (!cur.some(x => x.typeId === type.id && x.ownerId === id)) rows.push({ key: `missing:${type.id}:${id}`, ownerType: type.ownerType, ownerId: id, owner: ownerLabel(d, type.ownerType, id), type, doc: null, status: 'pendiente', days: null });
  return rows;
}
export const docAttention = (d: CompanyData, today: string) => documentRows(d, today).filter(r => r.status === 'vencido' || r.status === 'proximo' || r.status === 'pendiente')
  .sort((a, b) => ({ vencido: 0, pendiente: 1, proximo: 2 } as Record<string, number>)[a.status] - ({ vencido: 0, pendiente: 1, proximo: 2 } as Record<string, number>)[b.status] || (a.days ?? 0) - (b.days ?? 0));
/** Umbral de anticipación alcanzado (el menor umbral configurado que cubre los días restantes). */
export const alertThreshold = (days: number, alertDays: number[]): number | null => { const cands = [...alertDays].sort((a, b) => a - b).filter(x => days <= x); return cands.length ? cands[0] : null; };
