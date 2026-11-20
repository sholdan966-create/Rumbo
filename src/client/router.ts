import { useEffect, useState } from 'react';
import { STATIC } from './static/backend';

export interface Route { path: string[]; query: URLSearchParams }
// En la versión estática (iframe aislado) la ruta vive en memoria; en la normal, en location.hash.
let mem = '#/resumen'; const listeners = new Set<() => void>();
const current = () => (STATIC ? mem : window.location.hash);
function parse(): Route {
  const h = current().replace(/^#\/?/, ''); const [p, q] = h.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? '') };
}
export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const f = () => { setR(parse()); window.scrollTo(0, 0); };
    if (STATIC) { listeners.add(f); return () => { listeners.delete(f); }; }
    window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
export function href(path: string, query?: Record<string, string | undefined | null>): string {
  const q = new URLSearchParams(); for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString(); return `#/${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`;
}
export const goto = (hash: string) => { if (STATIC) { mem = hash; listeners.forEach(f => f()); } else window.location.hash = hash.slice(1); };
export const navigate = (path: string, query?: Record<string, string | undefined | null>) => goto(href(path, query));
/** Versión estática: intercepta los enlaces internos (#/ruta). */
export function installLinkInterceptor() {
  if (!STATIC) return;
  document.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
    if (a && !e.defaultPrevented) { e.preventDefault(); goto(a.getAttribute('href')!); }
  });
}
