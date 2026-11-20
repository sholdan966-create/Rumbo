// Presupuesto (cotización aceptada) vs. resultado real de un viaje.
import { BUDGET_CATS, BUDGET_LABEL, BudgetCat, Trip, TripCalc } from './types';

export type Tone = 'favorable' | 'desfavorable' | 'neutral' | 'sin_confirmar';
export interface Row { key: string; label: string; unit: 'money' | 'km' | 'min' | 'pct'; planned: number | null; actual: number | null; diff: number | null; pct: number | null; pctNA: boolean; tone: Tone; note?: string }
export interface BvA { rows: Row[]; totalCost: Row; revenue: Row; result: Row; margin: Row; km: Row; duration: Row; reliable: boolean; why: string[] }

/** Presupuesto vigente de un viaje: el snapshot de la cotización (histórico) si existe; si no, el presupuesto manual por categoría. */
export function plannedCosts(t: Trip): Partial<Record<BudgetCat, number>> | null {
  if (t.budgetSnapshot) return t.budgetSnapshot.costs;
  if (t.budget && Object.keys(t.budget).length) return t.budget;
  return null;
}

export function budgetVsActual(t: Trip, c: TripCalc): BvA | null {
  const snap = t.budgetSnapshot; if (!snap) return null;
  const why: string[] = [];
  if (t.status !== 'finalizado') why.push('El viaje todavía no está finalizado');
  if (!c.complete && t.status === 'finalizado') why.push(...c.missing);
  const reliable = t.status === 'finalizado' && c.complete;
  const mk = (key: string, label: string, unit: Row['unit'], planned: number | null, actual: number | null, kind: 'cost' | 'gain' | 'info', pp = false): Row => {
    const diff = planned != null && actual != null ? actual - planned : null;
    const pctNA = !pp && diff != null && planned === 0; // presupuesto cero: se informa la diferencia en dinero y el % "No aplica"
    const pct = diff != null && planned && !pp ? (diff / planned) * 100 : null;
    let tone: Tone = 'neutral';
    if (diff != null && diff !== 0 && kind !== 'info') {
      if (kind === 'cost' && !reliable && diff < 0) tone = 'sin_confirmar'; // un costo menor solo es ahorro con registros completos
      else if (kind === 'gain' && !reliable) tone = 'sin_confirmar';
      else tone = (kind === 'cost' ? diff > 0 : diff < 0) ? 'desfavorable' : 'favorable';
    }
    return { key, label, unit, planned, actual, diff, pct, pctNA, tone };
  };
  const rows = BUDGET_CATS.map(k => mk(k, BUDGET_LABEL[k], 'money', snap.costs[k], k === 'allocated' ? c.allocated : c.direct[k as Exclude<BudgetCat, 'allocated'>], 'cost'));
  const plannedCost = BUDGET_CATS.reduce((s, k) => s + snap.costs[k], 0);
  const plannedResult = snap.revenueNet - plannedCost;
  const plannedMargin = snap.revenueNet > 0 ? (plannedResult / snap.revenueNet) * 100 : null;
  const revenue = mk('revenue', 'Ingreso (neto)', 'money', snap.revenueNet, c.revenueNet, 'gain');
  const totalCost = mk('totalCost', 'Costo total', 'money', plannedCost, c.totalCost, 'cost');
  const result = mk('result', 'Resultado', 'money', plannedResult, c.result, 'gain');
  const margin = mk('margin', 'Margen (puntos porcentuales)', 'pct', plannedMargin, c.marginPct, 'gain', true);
  const km = mk('km', 'Kilómetros totales', 'km', snap.kmLoaded != null && snap.kmEmpty != null ? snap.kmLoaded + snap.kmEmpty : null, c.kmTotal, 'info');
  const duration = mk('duration', 'Duración (min)', 'min', snap.plannedHours != null ? Math.round(snap.plannedHours * 60) : null, c.durationMin, 'info');
  return { rows, totalCost, revenue, result, margin, km, duration, reliable, why };
}
export const DEVIATION_KEYS = ['totalCost', 'revenue', 'result', 'margin', ...BUDGET_CATS];
