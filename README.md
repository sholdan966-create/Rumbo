# Gestión de transporte · TRANSGODOY SRL (by RUMBO)

> Esta instalación está dedicada a **Transgodoy SRL** (Rosario): su marca aparece en el panel, el ingreso, el portal del chofer, la app instalable y los PDF, con el sello *by RUMBO* al pie.
> La marca está en `src/shared/brand.ts` y en `src/client/public/` (íconos); el logo de los PDF se puede reemplazar subiendo el logo oficial en Configuración → Empresa.

> **Instalación real o demostración.** Por defecto la aplicación arranca **vacía como instalación real**: el primer ingreso pide el código
> de instalación (se imprime en el log del servidor o se fija con `SETUP_TOKEN`) y crea la empresa y el administrador. Se entra con usuario y
> contraseña propios (mínimo 10 caracteres). Con `DEMO_MODE=1` (o `npm run demo`) se generan datos ficticios y un PIN común.

## Probarla en tu computadora (5 pasos)
1. Instalá **Node.js 22** (https://nodejs.org). 2. Descomprimí el zip y abrí una terminal en la carpeta `rumbo`.
3. Copiá `.env.example` como `.env` y elegí tu `SETUP_TOKEN`. 4. `npm install` y luego `npm run build`.
5. `npm start` y abrí **http://localhost:8787**: la primera vez te pide el código y crea tu empresa y tu administrador.
Para ver la versión con datos ficticios: `npm run build` y `npm run demo:start` (carpeta de datos aparte, `data-demo`).
Para probar el portal del chofer en tu celular (misma red wifi): abrí `http://IP-de-tu-pc:8787` desde el celular.

## Instalarla como app (PWA)
RUMBO es una app instalable: aparece un botón **Instalar app** arriba (y en el portal del chofer). En Chrome/Edge de la computadora se instala
desde ese botón o desde el ícono de la barra de direcciones; en Android desde ese botón; en iPhone/iPad, con Safari: *Compartir → Agregar a pantalla de inicio*.
Se abre en su propia ventana con su ícono. Requiere HTTPS al publicarla (en `localhost` también funciona) y **sigue necesitando conexión a internet**:
no hay modo sin conexión.

## Puesta en marcha real (transporte de cargas de Rosario)
```bash
npm install && npm run build
npm start        # lee la configuración del archivo .env (SETUP_TOKEN, DATA_DIR, APP_URL…)
```
La plantilla inicial trae: zona horaria Buenos Aires, IVA 21 %, localidades de Rosario y el Gran Rosario para autocompletar origen/destino,
tipos de documento sugeridos (seguro, RTO, cédula, licencia profesional, LiNTI, psicofísico, ART, habilitaciones, seguro de RC/carga),
rubros de costo mensual por camión (seguro, patente y tasas, rastreo, cochera, administración) en $0 y condiciones comerciales editables.
**Son valores de partida: cada empresa debe verificar qué documentación y requisitos corresponden a su operación.**
Después: cargar camiones, choferes, clientes y documentación (guía “Primeros pasos” en el Resumen) y crear usuarios en Configuración.

**Publicar en internet (HTTPS):** `Dockerfile` listo; `render.yaml` (Render) o `fly.toml` (Fly.io, región `eze`) con disco persistente en `/data`.
Variables: `DATA_DIR`, `APP_URL`, `SETUP_TOKEN`, `SMTP_URL` y `MAIL_FROM` (correo; opcional). `GET /healthz` para monitoreo.
**Respaldo:** el servidor copia `db.json` a `data/backups/` una vez por día (30 copias); además hay que respaldar todo `DATA_DIR`
(incluye `uploads/` y `files/`) fuera del servidor. Para restaurar: detener, copiar `db-AAAA-MM-DD.json` como `db.json`, iniciar.
**Límites actuales:** una empresa por instalación, un solo proceso, datos en archivo JSON con escritura atómica (adecuado para una pyme;
para varias empresas o más carga conviene PostgreSQL), sin doble factor ni inicio de sesión con terceros.

Aplicación web para empresas de transporte: cotiza viajes, registra su ejecución (con portal móvil para choferes), calcula costos y
resultados contra el presupuesto, controla documentación y cobros, y genera informes PDF por viaje y mensuales.
**Todos los datos incluidos son ficticios** (6 camiones, 3 meses, ~140 viajes, cotizaciones, documentos, clientes y cobranzas).

## Ejecutar
```bash
npm install
npm run dev        # instalación real vacía: API :8787 + interfaz http://localhost:5173
npm run demo       # con datos ficticios (DEMO_MODE=1, carpeta data-demo)
npm run build && npm start      # todo en http://localhost:8787
npm test           # 73 pruebas: cálculos, validaciones, permisos, flujos de la API
npm run build:static            # versión sin servidor (dist-static) para publicar como demo
```
Datos en `data/` (JSON + PDF + `uploads/` privados). Reiniciar la demo: borrar `data/db.json` o *Configuración → Restablecer*.
Para presentar con PDF más rápidos: `PDF_DEBOUNCE_MS=4000 npm start`.

**Usuarios de demostración** (PIN `1234` para todos): Administración, Operador de tráfico, Gerencia (solo consulta) y los 6 choferes
(portal móvil). El PIN se guarda con hash PBKDF2; las sesiones son tokens de servidor de 12 h.

## Arquitectura
```
src/shared   tipos, tiempo, CÁLCULOS, cotizador, presupuesto vs. real, documentos, cuenta de clientes, validaciones, importación, análisis
src/api      core.ts: TODA la API (sesión, roles, validación, historial). Independiente de Node/navegador
src/server   adaptador Express, almacenamiento, cola de trabajos, programador, PDF (pdfkit), correo, datos de demo
src/client   React + TypeScript: gestión (escritorio) y portal del chofer (móvil)
tests        Vitest: shared + API con sesiones reales
```
La autorización vive en `src/api/core.ts`: cada ruta declara los roles que la pueden usar. Los choferes solo llegan a `/api/driver/*`
(sus viajes asignados, con 404 para los ajenos) y a archivos vinculados a esos viajes. Una estructura de datos recortada
(`driverTrip`) **nunca** incluye costos internos, márgenes ni presupuesto; el valor del servicio y los gastos cargados por la oficina se
muestran solo si la empresa lo habilita en Configuración.

Reglas de cálculo clave: margen agregado = Σresultado ÷ Σingresos; costos mensuales por camión repartidos por km entre sus viajes
finalizados del mes (cada gasto una vez); viaje asignado al mes de su salida; gasto vacío = pendiente y `0` = confirmado; gastos
**pendientes de revisión no suman** hasta aprobarse (la aprobación cambia el estado del mismo registro: no crea otro); estimaciones de uso
no se suman al costo; “No disponible” ante divisor 0.
Cotización: costo = Σ costos incluidos; precio sugerido = costo ÷ (1 − margen/100) (costo $300.000 y margen 25 % ⇒ $400.000); margen < 100 %;
IVA por separado. Al convertir una cotización aceptada, el viaje guarda una **copia inmodificable** del presupuesto y sus supuestos.
Presupuesto vs. real: desvío = real − previsto; con presupuesto $0 el % es “No aplica”; un costo menor no es “ahorro” si los registros
están incompletos; el cambio de margen se expresa en puntos porcentuales.

## Estado de las funciones
**Operativas** (verificadas en navegador de escritorio y móvil, y con pruebas automáticas): inicio de sesión y permisos por rol en el servidor;
cotizaciones (cálculo, sugerencia de costos con su origen, duplicar, compartir con canal y fecha, aceptación/rechazo manual, PDF comercial sin
costos ni márgenes, conversión a viaje); viajes con pestañas (resumen, presupuesto y resultado, gastos, documentos, informes, historial);
revisión de gastos de choferes; comprobantes privados (PNG/JPG/PDF con validación del contenido y límite configurable); portal móvil del
chofer (salida, llegada, paradas, gastos con foto, odómetro, incidentes, terminar, correcciones con motivo y autor, confirmación explícita de
guardado, sin modo sin conexión); documentos con vencimientos, requisitos configurables, reemplazo con historial y avisos sin duplicar;
fichas de cliente con cuenta, antigüedad de deuda, gestiones y compromisos de pago, estado de cuenta PDF y borrador de recordatorio;
historial de cambios con valores anteriores/nuevos y motivo; control de concurrencia (412) para no pisar cambios ajenos;
PDF por viaje y mensual en segundo plano (cola persistente, 3 intentos, versiones, duplicados), con presupuesto vs. real, revisión de
gastos, comprobantes, incidentes, desvíos, cotizados, documentación y compromisos; importación CSV/Excel; mantenimiento por intervalos.

**Simuladas (solo demostración):** datos ficticios; PIN común; botón “Simular fallo de PDF”. En la **versión estática publicada** (sin servidor)
además: sesiones y permisos corren en el navegador (no son seguridad real), los datos se pierden al recargar, los procesos son temporizadores,
y las fichas se ven en pantalla en lugar de descargarse.

**Requieren conectar servicios externos:** correo (`SMTP_URL`, `MAIL_FROM`; sin configurar queda “No enviado” y se puede reintentar; el código
no fue probado contra un servidor real); redacción con IA (contrato en `src/server/ai.ts`, sin conexión).

**No implementadas:** lectura automática de tickets (OCR); modo sin conexión del portal del chofer; confirmación de cotizaciones por el
propio cliente; proveedor de identidad, varias empresas y gestión de usuarios.

## Pasar a producción
1. **Identidad:** reemplazar los usuarios con PIN por un proveedor de identidad (OIDC); `ctx` en `core.ts` ya recibe usuario y rol, y el
   adaptador debe resolver también la empresa. Cada tabla/colección debe filtrarse por `company_id`.
2. **Persistencia:** sustituir `Store` por PostgreSQL (misma interfaz); cola de trabajos en la base (o pg-boss/BullMQ). Control de concurrencia
   por `updatedAt` ya implementado para viajes.
3. **Archivos privados:** pasar `uploads/` y los PDF a almacenamiento privado (S3/GCS) con URLs firmadas de corta duración y antivirus.
4. **Correo:** definir `SMTP_URL`/`MAIL_FROM`, probar un envío real; los enlaces usan `APP_URL` y exigen sesión.
5. **Secretos** solo en variables de entorno del servidor. Registro de errores centralizado y alertas.
6. **Respaldo y recuperación:** copia diaria de base y archivos, restauración probada, RPO/RTO documentados.
7. **Publicación:** `npm run build && npm start` detrás de HTTPS (Render, Fly.io, Railway o VPS con Docker/Node 22).
8. Auditoría: el historial solo se escribe desde `audit()`; en producción debe ir a una tabla de solo inserción.

## Recorrido de presentación (5 minutos): cotizar → viajar → gastos → resultado → cobrar → informes
1. **Cotizar (1 min)** · *Cotizaciones → Nueva*: cliente, ruta, Camión 1, km. *Sugerir desde parámetros e historial*: cada costo muestra su
   origen. Ajustar margen a 25 %: precio sugerido y margen se recalculan, IVA aparte. Guardar → *PDF para el cliente* (sin costos ni margen).
   *Registrar envío* (canal) y *Registrar aceptación* (manual) → *Convertir en viaje*: asignar chofer y fecha. El viaje nace con el presupuesto congelado.
2. **Viajar (1 min)** · En el celular (o ventana móvil) ingresar como **Marcelo Ríos** → abrir el viaje → *Registrar salida* (odómetro) →
   *Gastos*: combustible con foto del ticket → aparece “Guardado en el servidor” y el gasto queda *Pendiente de revisión*.
3. **Gastos (45 s)** · En la oficina: pestaña *Gastos* del viaje → *Aprobar* (el mismo registro; sin duplicar). Mostrar *Rechazar* con motivo
   (lo ve el chofer). En el celular: *Registrar llegada* y *Marcar trabajo terminado*.
4. **Resultado (1 min)** · Completar peajes y chofer; pestaña *Presupuesto y resultado*: previsto vs. real, desvíos en $ y %, favorable /
   desfavorable, “No aplica” con presupuesto $0, supuestos y *Explicar* un desvío. Cambiar un parámetro del camión: el presupuesto histórico no cambia.
5. **Cobrar (45 s)** · *Informes → Fichas*: descargar el PDF (incluye la comparación). *Facturar este viaje* y registrar un cobro parcial;
   *Clientes → ficha*: saldo, antigüedad, *Registrar gestión* con compromiso de pago, *Estado de cuenta* PDF y borrador de recordatorio.
6. **Informes (30 s)** · *Informes → Informes mensuales*: viajes cotizados, desvíos, documentación, compromisos y tres prioridades;
   *Registro de cambios* con filtros. Cerrar mostrando *Resumen* (avisos enlazados) y *Configuración → Estado de las funciones*.
