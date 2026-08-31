// Instala las fuentes del repo en el sistema, para que Sharp pueda rotular los
// globos del cómic.
//
// Por qué hace falta: Sharp dibuja el texto con librsvg, que solo usa fuentes
// instaladas en el sistema. En Windows existen Comic Sans MS y Arial Black, pero
// en Linux (Render) no hay ninguna de las dos, y el texto saldría sin rotular.
// Este script se ejecuta en el `postinstall`, así que corre solo en el build.
//
// En Windows no hace nada: instalar fuentes ahí requiere tocar el registro.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN = path.join(__dirname, '..', 'public', 'fonts');

function main() {
  if (process.platform === 'win32') {
    console.log('[fuentes] Windows: se usan las fuentes del sistema, nada que instalar.');
    return;
  }

  if (!fs.existsSync(ORIGEN)) {
    console.warn(`[fuentes] No existe ${ORIGEN}, se omite.`);
    return;
  }

  const destino = path.join(os.homedir(), '.fonts');
  fs.mkdirSync(destino, { recursive: true });

  const fuentes = fs.readdirSync(ORIGEN).filter(f => /\.(ttf|otf)$/i.test(f));
  if (!fuentes.length) {
    console.warn('[fuentes] No se encontraron archivos de fuente.');
    return;
  }

  for (const fuente of fuentes) {
    fs.copyFileSync(path.join(ORIGEN, fuente), path.join(destino, fuente));
  }
  console.log(`[fuentes] ${fuentes.length} fuentes copiadas a ${destino}`);

  // Refrescar el cache de fontconfig. Si el binario no está, las fuentes en
  // ~/.fonts suelen detectarse igual al arrancar el proceso.
  try {
    execFileSync('fc-cache', ['-f'], { stdio: 'inherit' });
    console.log('[fuentes] Cache de fontconfig actualizado.');
  } catch {
    console.warn('[fuentes] fc-cache no disponible; se continúa sin refrescar el cache.');
  }
}

try {
  main();
} catch (error) {
  // Nunca romper el build por esto: el servidor arranca igual y avisa al iniciar.
  console.warn('[fuentes] No se pudieron instalar las fuentes:', error.message);
}
