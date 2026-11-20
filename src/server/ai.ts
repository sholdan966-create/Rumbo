// Integración OPCIONAL con IA para redactar el texto del informe mensual. No está conectada.
// Contrato: recibe cifras ya calculadas y el análisis por reglas; solo puede reformular texto, nunca modificar cifras.
import { MonthlyAnalysis, MonthlyFigures } from '../shared/types';

export const aiConfigured = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);
export async function enhanceNarrative(_figures: MonthlyFigures, analysis: MonthlyAnalysis): Promise<MonthlyAnalysis> {
  // PENDIENTE: llamar a la API del proveedor con `_figures` y `analysis` como contexto y validar que las cifras citadas coincidan
  // exactamente con las calculadas antes de reemplazar el texto. Mientras no esté implementado se devuelve el análisis por reglas.
  return analysis;
}
