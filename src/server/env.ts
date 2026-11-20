// Carga opcional de un archivo .env (CLAVE=valor) sin pisar variables ya definidas. Debe importarse PRIMERO:
// así funciona igual en Windows, Mac y Linux sin tener que escribir variables en la terminal.
import fs from 'node:fs';
try {
  for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim(); // ignora comentarios al final de la línea
  }
} catch { /* sin .env */ }
