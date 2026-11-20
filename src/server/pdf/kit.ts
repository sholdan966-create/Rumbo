// Utilidades de dibujo A4 para los PDF (pdfkit). Tipografía IBM Plex Sans embebida.
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Settings } from '../../shared/types';

const require_ = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require_.resolve('@fontsource/ibm-plex-sans/package.json')), 'files');
const F = (w: number) => path.join(fontDir, `ibm-plex-sans-latin-${w}-normal.woff`);

const TG_MARK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tg-mark.png');
export const C = { ink: '#172B3A', muted: '#526474', line: '#DFE5EA', bg: '#F4F6F8', accent: '#087F6F', blue: '#2563EB', amber: '#B45309', red: '#B42318', nav: '#12212D', white: '#FFFFFF' };
export const M = 40; // margen
export const W = 595.28 - M * 2; // ancho útil

export type Doc = PDFKit.PDFDocument;
export function newDoc(title: string, author: string): Doc {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: title, Author: author, Producer: 'RUMBO' } });
  doc.registerFont('R', F(400)); doc.registerFont('M', F(500)); doc.registerFont('S', F(600)); doc.registerFont('B', F(700));
  doc.font('R').fontSize(10).fillColor(C.ink);
  return doc;
}
export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); doc.end();
  });
}
export const BOTTOM = 842 - 56;
export function ensure(doc: Doc, h: number) { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = M; } }

export function drawLogo(doc: Doc, s: Settings, x: number, y: number, size: number) {
  if (s.logoDataUrl) {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(s.logoDataUrl);
    if (m) { try { doc.image(Buffer.from(m[2], 'base64'), x, y, { fit: [size * 2.2, size] }); return; } catch { /* usa monograma */ } }
  }
    try { doc.image(TG_MARK, x, y, { fit: [size, size] }); return; } catch { /* usa monograma */ }
  const initials = s.companyName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  doc.save().roundedRect(x, y, size, size, 6).fill(C.nav);
  doc.font('B').fontSize(size * 0.38).fillColor(C.white).text(initials, x, y + size * 0.3, { width: size, align: 'center' }).restore();
}

export function badge(doc: Doc, text: string, x: number, y: number, color: string) {
  doc.font('S').fontSize(8.5);
  const w = doc.widthOfString(text) + 14;
  doc.save().roundedRect(x, y, w, 17, 3).lineWidth(1).strokeColor(color).stroke();
  doc.fillColor(color).text(text, x + 7, y + 4.5, { lineBreak: false }).restore();
  return w;
}

/** Encabezado de documento. Devuelve el Y donde continúa el contenido. */
export function docHeader(doc: Doc, s: Settings, opts: { title: string; subtitle: string; badges: { text: string; color: string }[] }) {
  drawLogo(doc, s, M, M, 40);
  const tx = M + (s.logoDataUrl ? 100 : 52);
  doc.font('S').fontSize(12.5).fillColor(C.ink).text(s.legalName.replace(/\s*\(datos de demostración\)/, ''), tx, M + 1, { width: 250 });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text([s.cuit ? `CUIT ${s.cuit}` : '', s.address, [s.phone, s.email].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n'), tx, M + 17, { width: 250 });
  doc.font('B').fontSize(15).fillColor(C.ink).text(opts.title, 300, M, { width: W - 260, align: 'right' });
  doc.font('R').fontSize(9).fillColor(C.muted).text(opts.subtitle, 270, M + 20, { width: W - 230, align: 'right' });
  let by = M + 36;
  let bx = M + W;
  for (const b of [...opts.badges].reverse()) { doc.font('S').fontSize(8.5); const w = doc.widthOfString(b.text) + 14; bx -= w; badge(doc, b.text, bx, by, b.color); bx -= 6; }
  doc.moveTo(M, M + 66).lineTo(M + W, M + 66).lineWidth(1.2).strokeColor(C.ink).stroke();
  doc.y = M + 78;
}

export function section(doc: Doc, title: string, minSpace = 70) {
  ensure(doc, minSpace); doc.moveDown(0.5);
  doc.font('S').fontSize(10.5).fillColor(C.accent).text(title.toUpperCase(), M, doc.y, { characterSpacing: 0.6 });
  doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).lineWidth(0.7).strokeColor(C.line).stroke();
  doc.y += 8; doc.fillColor(C.ink);
}

export function para(doc: Doc, text: string, o: { color?: string; size?: number; indent?: number; font?: string } = {}) {
  doc.font(o.font ?? 'R').fontSize(o.size ?? 9.5).fillColor(o.color ?? C.ink);
  const h = doc.heightOfString(text, { width: W - (o.indent ?? 0) }); ensure(doc, h + 4);
  doc.text(text, M + (o.indent ?? 0), doc.y, { width: W - (o.indent ?? 0) }); doc.moveDown(0.25);
}
export function bullet(doc: Doc, text: string, color: string = C.ink) {
  const h = doc.font('R').fontSize(9.5).heightOfString(text, { width: W - 14 }); ensure(doc, h + 4);
  const y = doc.y; doc.circle(M + 3, y + 5, 1.6).fill(color);
  doc.fillColor(C.ink).text(text, M + 14, y, { width: W - 14 }); doc.moveDown(0.2);
}

export interface Col { label: string; w: number; align?: 'left' | 'right' | 'center' }
export function table(doc: Doc, cols: Col[], rows: (string | { t: string; color?: string; bold?: boolean })[][], o: { totalRows?: number[]; fontSize?: number } = {}) {
  const fs = o.fontSize ?? 9; const pad = 5; const total = cols.reduce((s, c) => s + c.w, 0); const k = W / total;
  const widths = cols.map(c => c.w * k);
  const head = () => {
    ensure(doc, 40); const y = doc.y;
    doc.rect(M, y, W, 20).fill(C.bg);
    let x = M; doc.font('S').fontSize(8.5).fillColor(C.muted);
    cols.forEach((c, i) => { doc.text(c.label, x + pad, y + 6, { width: widths[i] - pad * 2, align: c.align ?? 'left', lineBreak: false }); x += widths[i]; });
    doc.moveTo(M, y + 20).lineTo(M + W, y + 20).lineWidth(0.8).strokeColor(C.line).stroke(); doc.y = y + 20;
  };
  head();
  rows.forEach((r, ri) => {
    const cell = (v: typeof r[number]) => (typeof v === 'string' ? { t: v } : v);
    const isTotal = o.totalRows?.includes(ri);
    doc.font(isTotal ? 'S' : 'R').fontSize(fs);
    const hs = r.map((v, i) => doc.heightOfString(cell(v).t, { width: widths[i] - pad * 2 }));
    const h = Math.max(...hs) + 9;
    if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = M; head(); }
    const y = doc.y; let x = M;
    if (isTotal) doc.rect(M, y, W, h).fill('#EEF3F2');
    r.forEach((v, i) => {
      const c = cell(v);
      doc.font(isTotal || c.bold ? 'S' : 'R').fontSize(fs).fillColor(c.color ?? C.ink)
        .text(c.t, x + pad, y + 4.5, { width: widths[i] - pad * 2, align: cols[i].align ?? 'left' });
      x += widths[i];
    });
    doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.5).strokeColor(C.line).stroke(); doc.y = y + h;
  });
  doc.y += 6; doc.x = M;
}

export function kpis(doc: Doc, items: { label: string; value: string; sub?: string; color?: string }[]) {
  ensure(doc, 62); const y = doc.y; const gap = 8; const w = (W - gap * (items.length - 1)) / items.length;
  items.forEach((k, i) => {
    const x = M + i * (w + gap);
    doc.roundedRect(x, y, w, 52, 4).lineWidth(0.8).strokeColor(C.line).stroke();
    doc.font('R').fontSize(8.5).fillColor(C.muted).text(k.label, x + 9, y + 7, { width: w - 18, lineBreak: false });
    doc.font('B').fontSize(14).fillColor(k.color ?? C.ink).text(k.value, x + 9, y + 20, { width: w - 18, lineBreak: false });
    if (k.sub) doc.font('R').fontSize(8).fillColor(C.muted).text(k.sub, x + 9, y + 38, { width: w - 18, lineBreak: false });
  });
  doc.y = y + 62; doc.x = M;
}

export function kv(doc: Doc, pairs: [string, string][], x: number, y: number, w: number, labelW = 78): number {
  let cy = y;
  for (const [k, v] of pairs) {
    doc.font('R').fontSize(9).fillColor(C.muted).text(k, x, cy, { width: labelW, lineBreak: false });
    const h = doc.font('M').fontSize(9.5).heightOfString(v, { width: w - labelW });
    doc.font('M').fontSize(9.5).fillColor(C.ink).text(v, x + labelW, cy - 0.5, { width: w - labelW });
    cy += Math.max(h, 12) + 4;
  }
  return cy;
}

/** Pie de página con numeración "Página X de Y" y marca de agua opcional (vista previa). */
export function finish(doc: Doc, left: string, watermark?: string) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bm = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    if (watermark) {
      doc.save().rotate(-35, { origin: [300, 420] }).font('B').fontSize(70).fillColor('#172B3A').fillOpacity(0.06)
        .text(watermark, 40, 380, { width: 520, align: 'center', lineBreak: false }).restore();
    }
    doc.moveTo(M, 800).lineTo(M + W, 800).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font('R').fontSize(8).fillColor(C.muted).fillOpacity(1).text(`${left}  ·  by RUMBO`, M, 808, { width: W - 90, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, M + W - 90, 808, { width: 90, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bm;
  }
}
