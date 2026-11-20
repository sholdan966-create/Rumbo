import { useEffect, useState } from 'react';
import { apiBlob } from './api';

/** Carga un archivo privado con la sesión del usuario y devuelve una URL temporal para mostrarlo. */
export function useBlobUrl(path: string | null) {
  const [state, setState] = useState<{ url?: string; mime?: string; error?: string }>({});
  useEffect(() => {
    if (!path) return; let live = true; let url = ''; setState({});
    apiBlob(path).then(({ blob }) => { if (live) { url = URL.createObjectURL(blob); setState({ url, mime: blob.type }); } }).catch(e => live && setState({ error: e instanceof Error ? e.message : 'No se pudo cargar' }));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  return state;
}
