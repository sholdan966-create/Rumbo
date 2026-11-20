// Pequeño puente para mostrar avisos desde componentes sueltos sin depender del contexto principal (portal del chofer incluido).
export const useAppToast = () => ({ toast: (text: string, kind: 'ok' | 'err' | 'warn' = 'ok') => window.dispatchEvent(new CustomEvent('rumbo:toast', { detail: text, ...(kind === 'ok' ? {} : {}) })) });
