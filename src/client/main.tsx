import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import './styles.css';
import { AppProvider } from './store';
import { Layout } from './components/Layout';
import { installLinkInterceptor, useRoute } from './router';
import { Gate } from './auth';
import { DriverApp } from './pages/DriverApp';
import { Cotizaciones } from './pages/Cotizaciones';
import { Clientes } from './pages/Clientes';
import { Documentos } from './pages/Documentos';
import { Resumen } from './pages/Resumen';
import { Viajes } from './pages/Viajes';
import { Flota } from './pages/Flota';
import { Cobros } from './pages/Cobros';
import { Informes } from './pages/Informes';
import { Configuracion } from './pages/Configuracion';

function Shell() {
  const route = useRoute(); const section = route.path[0] ?? 'resumen';
  const page = section === 'viajes' ? <Viajes route={route} /> : section === 'cotizaciones' ? <Cotizaciones route={route} /> : section === 'clientes' ? <Clientes route={route} /> : section === 'documentos' ? <Documentos route={route} /> : section === 'flota' ? <Flota route={route} /> : section === 'cobros' ? <Cobros route={route} />
    : section === 'informes' ? <Informes route={route} /> : section === 'configuracion' ? <Configuracion /> : <Resumen route={route} />;
  return <Layout routeKey={route.path.slice(0, 2).join('/')} section={['viajes', 'cotizaciones', 'clientes', 'documentos', 'flota', 'cobros', 'informes', 'configuracion'].includes(section) ? section : 'resumen'}>{page}</Layout>;
}
installLinkInterceptor();
createRoot(document.getElementById('root')!).render(<Gate staff={<AppProvider><Shell /></AppProvider>} driver={u => <DriverApp user={u} />} />);
