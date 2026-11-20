import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from './ui';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Botón "Instalar app": usa el instalador del navegador cuando existe; en iPhone/iPad explica el paso manual. No se muestra si ya está instalada. */
export function InstallButton({ className = 'btn sm', style }: { className?: string; style?: React.CSSProperties }) {
  const [ev, setEv] = useState<BIPEvent | null>(null); const [help, setHelp] = useState(false); const [done, setDone] = useState(standalone());
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEv(e as BIPEvent); }; const inst = () => setDone(true);
    window.addEventListener('beforeinstallprompt', on); window.addEventListener('appinstalled', inst); return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', inst); };
  }, []);
  if (done || (!ev && !ios)) return null;
  return <>
    <button className={className} style={style} onClick={async () => { if (ev) { await ev.prompt(); const r = await ev.userChoice; if (r.outcome === 'accepted') setDone(true); setEv(null); } else setHelp(true); }}><Download size={15} /> Instalar app</button>
    {help && <Modal title="Instalar RUMBO en tu iPhone o iPad" onClose={() => setHelp(false)}><ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}><li>Abrí esta página en <b>Safari</b>.</li><li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li><li>Elegí <b>“Agregar a pantalla de inicio”</b> y confirmá.</li></ol></Modal>}
  </>;
}
