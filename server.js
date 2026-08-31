import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { componerPagina, comprobarFuentes, NUM_VINETAS } from './comic.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// URL pública del servidor: es la que va dentro del QR, así que tiene que ser
// alcanzable desde el celular del asistente.
// RENDER_EXTERNAL_URL la inyecta Render automáticamente, así que en Render no hay
// nada que configurar.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

// Sirve para comprobar de un vistazo que el proceso corre el codigo actual.
// "vinetas" = guion + una imagen por vineta + rotulacion con tipografia real.
const MOTOR = 'vinetas-v20';

// Carpeta donde vive todo lo que debe sobrevivir.
// En Render el disco del contenedor se borra en cada deploy: hay que montar un
// Disk y apuntar STORAGE_DIR a su Mount Path (por ejemplo /var/data).
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : __dirname;

const UPLOAD_DIR = path.join(__dirname, 'uploads');            // temporal, no persiste
const DOWNLOAD_DIR = path.join(STORAGE_DIR, 'downloads');      // lo que sirve el QR
const HISTORIAS_DIR = path.join(STORAGE_DIR, 'historias');     // archivo permanente

for (const dir of [UPLOAD_DIR, DOWNLOAD_DIR, HISTORIAS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

// Configuración de multer para manejar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // No se usa file.originalname: viene del cliente y puede contener rutas ("../").
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + (MIME_EXT[file.mimetype] || '.bin'));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 12 * 1024 * 1024 }, // margen para fotos de cámaras de alta resolución
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG y WEBP'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(DOWNLOAD_DIR));

// Inicializar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Límites de la historia que escribe el usuario
const HISTORIA_MIN = 20;
const HISTORIA_MAX = 1200;

// Cuántas viñetas pueden llevar onomatopeya. Si salen en todas, la página se
// satura y el recurso pierde fuerza.
const MAX_ONOMATOPEYAS = Math.max(1, Math.floor(NUM_VINETAS / 2));

// Lo mismo con la narración: en exceso compite con los globos y llena la página
// de texto que repite lo que ya se ve.
const MAX_NARRACIONES = Math.max(1, Math.floor(NUM_VINETAS / 2));

// Estilos de dibujo disponibles. El id es lo que se manda al modelo.
const ESTILOS = {
  manga: 'manga japonés en blanco y negro, tramas de screentone, líneas dinámicas',
  americano: 'cómic americano de superhéroes, tinta gruesa, colores saturados, sombreado dramático',
  caricatura: 'caricatura moderna estilo serie animada, formas redondeadas, colores planos y vivos',
  acuarela: 'novela gráfica pintada en acuarela, trazo suelto, colores suaves y difuminados',
  noir: 'cómic noir en blanco y negro de alto contraste, sombras duras, estilo cine negro',
  retro: 'cómic retro años 60, puntos de semitono (ben-day dots), paleta limitada, papel envejecido',
  chibi: 'estilo chibi kawaii, personajes de cabeza grande, colores pastel, muy expresivo',
  pixar: 'ilustración 3D estilo película animada, iluminación cálida, personajes redondeados'
};

// Paso 1: un modelo de texto convierte la historia en un guion de viñetas.
// Se separa de la generación de imagen porque los modelos de imagen escriben
// el texto con faltas de ortografía; aquí el texto queda en datos, no en píxeles.
async function escribirGuion({ sexo, historia, foto, mimeType }) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          apariencia: { type: 'string' },
          personaje: { type: 'string' },
          escenas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                accion: { type: 'string' },
                dialogo: { type: 'string' },
                narracion: { type: 'string' },
                onomatopeya: { type: 'string' }
              },
              required: ['accion', 'dialogo', 'narracion', 'onomatopeya']
            }
          }
        },
        required: ['apariencia', 'personaje', 'escenas']
      }
    }
  });

  const esMujer = sexo === 'mujer';
  const protagonistaEs = esMujer ? 'una MUJER' : 'un HOMBRE';

  const instruccion = `Eres guionista de cómics. Adapta esta historia a un guion de EXACTAMENTE ${NUM_VINETAS} viñetas.

HISTORIA (escrita por la persona protagonista):
"""
${historia}
"""

DATO CONFIRMADO: la persona protagonista es ${protagonistaEs}. Lo indicó ella misma,
así que respétalo siempre, por encima de lo que te parezca ver en la foto.

Devuelve un JSON con:

"apariencia": ficha física del protagonista OBSERVANDO LA FOTO ADJUNTA, en una o
dos frases. Esta ficha se le pasará al ilustrador en todas las viñetas, así que
sé preciso y objetivo. Indica en este orden:
1. Empieza SIEMPRE con "${esMujer ? 'Mujer' : 'Hombre'}", porque así lo indicó la
   propia persona. No lo cambies aunque la foto te sugiera otra cosa.
2. Rango de edad aproximado.
3. Cabello: color, largo y peinado.
4. Tono de piel.
5. Si usa lentes o no.
6. ${esMujer
    ? 'Termina siempre con "sin barba ni bigote, rostro completamente rasurado".'
    : 'Si tiene barba o bigote, dilo. Si NO tiene, escribe explícitamente "sin barba ni bigote, rostro rasurado".'}
Ejemplo: "Mujer de unos 30 años, cabello castaño ondulado hasta los hombros,
piel clara, con lentes de armazón negro, sin barba ni bigote, rostro completamente rasurado."

"personaje": descripción del vestuario del protagonista en una frase corta
(por ejemplo "camisa blanca arremangada y pantalón azul oscuro"). Será la misma
ropa en todas las viñetas, así que descríbela una sola vez y de forma sencilla.
Que la ropa sea apropiada para la persona de la foto.
NO describas la cara ni el peinado aquí: eso va en "apariencia".

"escenas": arreglo de ${NUM_VINETAS} objetos, en orden narrativo, cada uno con:
- "accion": qué se VE en la viñeta, en una o dos frases. Describe encuadre
  (plano general, plano medio o primer plano), qué hace el protagonista y dónde está.
  Es una instrucción de dibujo: nada de diálogo ni de texto aquí.
- "dialogo": lo que dice el protagonista, MÁXIMO 7 palabras. Cadena vacía si no habla.
- "narracion": texto de narrador, MÁXIMO 8 palabras. Cadena vacía casi siempre.
  Úsala SOLO en la primera viñeta (para situar la historia) y en un salto de
  tiempo o de lugar. NUNCA describas lo que ya se ve en el dibujo: si la viñeta
  muestra a alguien volando, no escribas "vuela por el cielo".
  Una viñeta no debe llevar narración Y diálogo a la vez, salvo la primera.
- "onomatopeya": un solo sonido corto en mayúsculas (¡CRASH!, ¡BOOM!, ¡PUM!).
  Úsala SOLO en las viñetas con acción o sonido fuerte de verdad.
  Como MÁXIMO en ${MAX_ONOMATOPEYAS} de las ${NUM_VINETAS} viñetas; en el resto, cadena vacía.

Reglas:
- Todo el texto en español correcto, con acentos.
- MENOS TEXTO ES MEJOR: el dibujo cuenta la historia, el texto solo lo que no se ve.
- Cada viñeta lleva UNA sola caja de texto (o diálogo o narración), nunca las dos,
  salvo la primera viñeta.
- Una viñeta tranquila no necesita onomatopeya: déjala vacía.
- Si una viñeta se entiende sola, deja diálogo y narración vacíos.
- Varía los encuadres entre viñetas.
- La última viñeta debe cerrar la historia.`;

  let datos;
  try {
    const result = await model.generateContent([
      { text: instruccion },
      { inlineData: { mimeType, data: foto } }
    ]);
    datos = JSON.parse(result.response.text());
  } catch (error) {
    // Si el guionista falla (filtro de seguridad, timeout, JSON inválido) no se
    // deja al asistente sin cómic: se arma un guion mínimo con su propia historia.
    console.error('El guion falló, se usa uno de reserva:', error.message);
    datos = guionDeReserva(historia, esMujer);
  }

  // El modelo puede devolver de más o de menos: se ajusta al número de celdas.
  const escenas = (datos.escenas || []).slice(0, NUM_VINETAS);
  while (escenas.length < NUM_VINETAS) {
    escenas.push({ accion: historia, dialogo: '', narracion: '', onomatopeya: '' });
  }

  // El modelo tiende a llenar todas las viñetas de texto aunque se le pida lo
  // contrario, así que los límites se aplican aquí.

  // 1. Nada de narración y diálogo en la misma viñeta (salvo la primera): dos
  //    cajas de texto en una viñeta se ven amontonadas y suelen decir lo mismo.
  escenas.forEach((escena, i) => {
    const tieneDialogo = !!(escena.dialogo || '').trim();
    const tieneNarracion = !!(escena.narracion || '').trim();
    if (i > 0 && tieneDialogo && tieneNarracion) {
      escena.narracion = '';
    }
  });

  // 2. La narración se reserva para situar la historia: primera viñeta y, como
  //    mucho, alguna más.
  const conNarracion = escenas
    .map((e, i) => i)
    .filter(i => (escenas[i].narracion || '').trim());

  conNarracion.slice(MAX_NARRACIONES).forEach(i => {
    escenas[i].narracion = '';
  });

  // 3. Onomatopeyas salteadas: nunca en viñetas seguidas y como mucho en la
  //    mitad de la página. Si aparecen en todas, dejan de tener fuerza.
  const candidatas = escenas
    .map((e, i) => ({ i, tieneTexto: !!((e.narracion || '') + (e.dialogo || '')).trim() }))
    .filter(({ i }) => (escenas[i].onomatopeya || '').trim())
    .sort((a, b) => Number(a.tieneTexto) - Number(b.tieneTexto));

  const aceptadas = [];
  for (const { i } of candidatas) {
    if (aceptadas.length >= MAX_ONOMATOPEYAS) break;
    if (aceptadas.some(j => Math.abs(j - i) < 2)) continue;   // ni contigua
    aceptadas.push(i);
  }

  escenas.forEach((escena, i) => {
    if (!aceptadas.includes(i)) escena.onomatopeya = '';
  });

  return {
    apariencia: (datos.apariencia || '').trim(),
    personaje: datos.personaje || 'ropa casual',
    escenas
  };
}

// Guion mínimo a partir de la historia, para cuando el modelo de texto no
// responde. Reparte las frases del usuario entre las viñetas.
function guionDeReserva(historia, esMujer) {
  const frases = historia
    .split(/(?<=[.!?])\s+/)
    .map(f => f.trim())
    .filter(Boolean);

  const escenas = [];
  for (let i = 0; i < NUM_VINETAS; i++) {
    const frase = frases[i % Math.max(1, frases.length)] || historia;
    escenas.push({
      accion: frase,
      narracion: i === 0 ? frase.slice(0, 60) : '',
      dialogo: '',
      onomatopeya: ''
    });
  }

  return {
    apariencia: esMujer
      ? 'Mujer adulta, tal como aparece en la foto, sin barba ni bigote, rostro completamente rasurado.'
      : 'Hombre adulto, tal como aparece en la foto.',
    personaje: 'ropa casual sencilla',
    escenas
  };
}

// Paso 2: prompt de UNA viñeta. La foto va adjunta como referencia facial.
function promptVineta({ sexo, apariencia, personaje, escena, estilo, indice }) {
  const descripcionEstilo = ESTILOS[estilo] || ESTILOS.americano;
  const esMujer = sexo === 'mujer';

  return `Dibuja UNA SOLA VIÑETA de cómic (imagen cuadrada, una única escena, sin subdivisiones).

ESCENA ${indice + 1}:
${escena.accion}

PROTAGONISTA (lo más importante):
La persona de la foto adjunta es el protagonista y es ${esMujer ? 'una MUJER' : 'un HOMBRE'}.

Ficha del personaje, respétala al pie de la letra:
${apariencia}

Usa ÚNICAMENTE su cara y su figura en primer plano como referencia: forma del rostro,
peinado exacto, color y largo del cabello, color de piel, cejas y sus lentes si los trae.
Debe ser reconocible como ESA MISMA PERSONA, no un personaje genérico ni un modelo
de revista: respeta su edad, su complexión y sus facciones reales, aunque la escena
sea heroica.

${esMujer
    ? `ES UNA MUJER. Dibújala como mujer en TODAS las viñetas, sin excepción.
NUNCA le pongas barba, bigote, sombra de barba, patillas, mandíbula masculina,
cuello ancho ni ningún rasgo de hombre. Su rostro va completamente rasurado y limpio.`
    : `ES UN HOMBRE. Dibújalo como hombre en todas las viñetas.
No le inventes barba ni bigote si la ficha dice que va rasurado.`}
Si en la foto usa lentes, los usa en TODAS las viñetas; si no, en ninguna.
No le cambies el peinado ni el color de pelo entre viñetas.

IGNORA POR COMPLETO el fondo de la foto: el lugar, los muebles, los objetos, la
iluminación y cualquier persona que aparezca detrás. Nada de eso debe aparecer en la viñeta.
El ambiente de la viñeta es el que describe la escena, no el de la fotografía.
Dibújalo como personaje ilustrado, NO como fotografía ni collage.
Viste al personaje con: ${personaje}. Es la misma ropa en todas las viñetas.

SIN TEXTO (obligatorio):
NO dibujes letras, palabras, globos de diálogo, cartuchos, onomatopeyas, carteles
escritos, logotipos ni firmas. La viñeta va COMPLETAMENTE MUDA.
El texto se agrega después por separado.

SIN MARCO (obligatorio):
La ilustración llena TODA la imagen, de borde a borde, a sangre.
NO dibujes marco, recuadro, borde negro, margen ni franja blanca alrededor.

COMPOSICIÓN (importante):
La cabeza del protagonista debe verse COMPLETA y dentro del encuadre, nunca
cortada por el borde superior. Deja algo de aire despejado por encima de su
cabeza (cielo, pared o fondo simple), donde después se colocará el texto.
Encuadra de forma que se le vea bien la cara.

ESTILO ARTÍSTICO:
${descripcionEstilo}.
Ilustración de alta calidad, línea limpia. Mantén exactamente este mismo estilo,
paleta y tipo de trazo en todas las viñetas.`;
}

// Genera una viñeta y devuelve su buffer. Reintenta una vez: los fallos
// puntuales de la API son frecuentes y perder una viñeta se nota en la página.
async function generarVineta({ model, foto, mimeType, prompt, indice = 0 }) {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType, data: foto } }
      ]);

      for (const part of result.response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }
      console.warn(`Viñeta ${indice + 1}: la API no devolvió imagen (intento ${intento})`);
    } catch (error) {
      console.warn(`Viñeta ${indice + 1} falló (intento ${intento}): ${error.message}`);
    }
  }
  return null;
}

// Ejecuta las tareas con un límite de concurrencia, conservando el orden.
async function enLotes(tareas, limite) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;

  const trabajador = async () => {
    while (siguiente < tareas.length) {
      const i = siguiente++;
      resultados[i] = await tareas[i]();
    }
  };

  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, trabajador));
  return resultados;
}

// Guarda una carpeta por cómic con la imagen y todos sus datos.
// Es el archivo permanente del evento: a diferencia de downloads/, aquí no se
// borra nada.
async function archivarHistoria({ id, sexo, estilo, historia, apariencia, personaje, escenas, imagenBase64, downloadUrl }) {
  const carpeta = path.join(HISTORIAS_DIR, id);
  fs.mkdirSync(carpeta, { recursive: true });

  const datos = {
    id,
    fecha: new Date().toISOString(),
    sexo,
    estilo,
    historia,
    personaje: { apariencia, vestuario: personaje },
    escenas,
    archivo: 'comic.jpg',
    downloadUrl
  };

  fs.writeFileSync(path.join(carpeta, 'comic.jpg'), Buffer.from(imagenBase64, 'base64'));
  fs.writeFileSync(path.join(carpeta, 'datos.json'), JSON.stringify(datos, null, 2), 'utf8');
  fs.writeFileSync(path.join(carpeta, 'historia.txt'), historia, 'utf8');

  // Índice de una línea por cómic, para revisarlo todo de un vistazo
  fs.appendFileSync(
    path.join(HISTORIAS_DIR, 'index.jsonl'),
    JSON.stringify({ id: datos.id, fecha: datos.fecha, sexo, estilo, historia }) + '\n',
    'utf8'
  );

  return carpeta;
}

// Mantener solo las últimas 30 imágenes generadas
async function cleanOldFiles() {
  try {
    if (!fs.existsSync(DOWNLOAD_DIR)) return;

    const files = fs.readdirSync(DOWNLOAD_DIR)
      .filter(file => file.startsWith('comic_') && file.endsWith('.jpg'))
      .map(file => ({
        name: file,
        path: path.join(DOWNLOAD_DIR, file),
        time: fs.statSync(path.join(DOWNLOAD_DIR, file)).mtime
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 30) {
      files.slice(30).forEach(file => {
        fs.unlinkSync(file.path);
        console.log('Archivo eliminado:', file.name);
      });
    }
  } catch (error) {
    console.error('Error limpiando archivos:', error);
  }
}

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint para generar el cómic
app.post('/api/generate', upload.single('image'), async (req, res) => {
  try {
    const historia = (req.body.historia || '').trim();
    const estilo = (req.body.estilo || 'americano').trim();
    const sexo = (req.body.sexo || '').trim().toLowerCase() === 'mujer' ? 'mujer' : 'hombre';

    if (!req.file) {
      return res.status(400).json({ error: 'La foto es requerida' });
    }
    if (!historia) {
      return res.status(400).json({ error: 'La historia es requerida' });
    }
    if (historia.length < HISTORIA_MIN) {
      return res.status(400).json({ error: `La historia es muy corta (mínimo ${HISTORIA_MIN} caracteres)` });
    }
    if (historia.length > HISTORIA_MAX) {
      return res.status(400).json({ error: `La historia es muy larga (máximo ${HISTORIA_MAX} caracteres)` });
    }

    // Leer la foto del usuario
    const imagePath = req.file.path;
    const foto = fs.readFileSync(imagePath).toString('base64');
    const mimeType = req.file.mimetype;

    // El archivo temporal ya no hace falta: la foto vive en memoria
    fs.unlinkSync(imagePath);

    console.log(`Generando cómic (${sexo}, estilo: ${estilo})...`);

    // Paso 1: guion
    const { apariencia, personaje, escenas } = await escribirGuion({
      sexo,
      historia,
      foto,
      mimeType
    });
    console.log(`Guion listo: ${escenas.length} viñetas.`);
    console.log(`  Personaje: ${apariencia}`);
    console.log(`  Vestuario: ${personaje}`);

    // Paso 2: una imagen por viñeta, sin texto
    const modelImagen = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

    const vinetas = await enLotes(
      escenas.map((escena, indice) => () => generarVineta({
        model: modelImagen,
        foto,
        mimeType,
        prompt: promptVineta({ sexo, apariencia, personaje, escena, estilo, indice }),
        indice
      })),
      3
    );

    const fallidas = vinetas.filter(v => !v).length;
    if (fallidas) {
      console.warn(`${fallidas} viñeta(s) sin imagen`);
    }
    if (fallidas > vinetas.length / 2) {
      return res.status(502).json({
        error: 'No se pudo generar el cómic',
        details: 'El modelo no devolvió suficientes viñetas. Intenta reformular tu historia.'
      });
    }

    // Una viñeta fallida se sustituye por un recuadro liso para no romper la página
    const relleno = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 240, g: 240, b: 240 } }
    }).png().toBuffer();

    // Paso 3: armado de la página y rotulación con tipografía real
    const processedImageBase64 = await componerPagina(
      vinetas.map(v => v || relleno),
      escenas,
      estilo
    );

    // Copia que sirve el QR (esta carpeta sí se va rotando)
    const id = `comic_${Date.now()}`;
    const filename = `${id}.jpg`;
    fs.writeFileSync(path.join(DOWNLOAD_DIR, filename), Buffer.from(processedImageBase64, 'base64'));

    await cleanOldFiles();

    const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    // El QR apunta a una página propia del cómic, más cómoda en el celular que
    // el archivo suelto: muestra la imagen y ofrece descargarla.
    const downloadUrl = `${base}/c/${id}`;
    console.log('URL de descarga generada:', downloadUrl);

    // Copia permanente en carpeta (útil en local)
    try {
      const carpeta = await archivarHistoria({
        id,
        sexo,
        estilo,
        historia,
        apariencia,
        personaje,
        escenas,
        imagenBase64: processedImageBase64,
        downloadUrl
      });
      console.log('Historia archivada en:', carpeta);
    } catch (error) {
      // Que falle el archivado no debe dejar al asistente sin su cómic
      console.error('No se pudo archivar la historia:', error.message);
    }


    const qrCode = await QRCode.toDataURL(downloadUrl);

    // Se mandan URLs, no la imagen en base64: así la respuesta pesa unos KB en
    // vez de ~25 MB. Ojo: "image" tiene que apuntar al JPEG, no a la página
    // /c/<id>, o el <img> del navegador no puede pintarlo.
    res.json({
      success: true,
      image: `${base}/c/${id}/imagen.jpg`,
      downloadUrl,
      qrCode,
      message: 'Cómic generado exitosamente'
    });

  } catch (error) {
    console.error('Error al generar el cómic:', error?.stack || error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Mensaje accionable para quien atiende el stand
    const mensaje = /safety|blocked|policy/i.test(error.message || '')
      ? 'La IA rechazó la foto o la historia. Prueba con otra foto o cambia la historia.'
      : /quota|rate|429/i.test(error.message || '')
        ? 'Se alcanzó el límite de la API de Google. Espera un momento e inténtalo de nuevo.'
        : /timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(error.message || '')
          ? 'La conexión con la IA falló. Vuelve a intentarlo.'
          : 'Error al generar el cómic';

    res.status(500).json({
      error: mensaje,
      details: error.message
    });
  }
});

// Endpoint de salud. Sirve para diagnosticar un despliegue sin entrar al log:
// dice si hay API key, si la rotulación tiene fuentes y si el almacenamiento
// sobrevive a un reinicio.
app.get('/api/health', async (req, res) => {
  const fuentes = await comprobarFuentes();

  let historiasGuardadas = 0;
  try {
    const indice = path.join(HISTORIAS_DIR, 'index.jsonl');
    if (fs.existsSync(indice)) {
      historiasGuardadas = fs.readFileSync(indice, 'utf8').split('\n').filter(Boolean).length;
    }
  } catch { /* si no se puede leer, se reporta 0 */ }

  res.json({
    status: 'OK',
    message: 'Generador de Cómics API está funcionando',
    motor: MOTOR,
    vinetas: NUM_VINETAS,
    hasApiKey: !!process.env.GOOGLE_API_KEY,
    fuentes: {
      ok: fuentes.ok,
      detalle: fuentes.ok
        ? 'la rotulación tiene fuentes disponibles'
        : 'SIN FUENTES: los globos saldrían vacíos'
    },
    almacenamiento: {
      dir: STORAGE_DIR,
      persistente: !!process.env.STORAGE_DIR,
      historiasGuardadas,
      detalle: process.env.STORAGE_DIR
        ? 'STORAGE_DIR configurado: los cómics sobreviven a los reinicios'
        : 'SIN STORAGE_DIR: en Render los cómics se borran al reiniciar y el QR quedará en 404'
    },
    urlPublica: PUBLIC_URL || null
  });
});

// Ruta en disco del cómic. Se busca en historias/ (permanente) y, si no está,
// en downloads/ (que se va rotando).
function rutaComic(id) {
  const permanente = path.join(HISTORIAS_DIR, id, 'comic.jpg');
  if (fs.existsSync(permanente)) return permanente;

  const temporal = path.join(DOWNLOAD_DIR, `${id}.jpg`);
  if (fs.existsSync(temporal)) return temporal;

  return null;
}

// Imagen del cómic.
app.get('/c/:id/imagen.jpg', (req, res) => {
  if (!/^comic_\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Identificador inválido' });
  }

  const ruta = rutaComic(req.params.id);
  if (!ruta) return res.status(404).json({ error: 'Cómic no encontrado' });

  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Content-Disposition', `inline; filename="${req.params.id}.jpg"`);
  res.type('image/jpeg').sendFile(ruta);
});

// Página que abre el QR en el celular: el cómic y un botón para guardarlo.
app.get('/c/:id', (req, res) => {
  const id = req.params.id;
  if (!/^comic_\d+$/.test(id)) return res.status(400).send('Identificador inválido');

  try {
    if (!rutaComic(id)) {
      return res.status(404).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico?v=2" sizes="any">
        <link rel="icon" type="image/svg+xml" href="/img/mongodb/MongoDB_Logomark_SpringGreen.svg">
        <title>Cómic no encontrado</title></head>
        <body style="margin:0;min-height:100vh;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;background:#001E2B;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px;">
          <img src="/img/mongodb/MongoDB_White.svg" alt="MongoDB" style="height:42px;">
          <div><h1 style="color:#00ED64;font-size:1.3rem;">Cómic no encontrado</h1>
          <p style="opacity:.8">Puede que este enlace haya caducado.</p></div>
        </body></html>`);
    }

    res.set('Cache-Control', 'no-store');
    res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico?v=2" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/img/mongodb/MongoDB_Logomark_SpringGreen.svg">
  <link rel="apple-touch-icon" href="/img/mongodb/MongoDB_Logomark_SpringGreen.svg">
  <title>Tu cómic</title>
  <style>
    /* Tipografía de marca, servida desde public/fonts */
    @font-face {
      font-family: 'Euclid Circular A';
      src: url('/fonts/EuclidCircularA-Regular.ttf') format('truetype');
      font-weight: 400; font-display: swap;
    }
    @font-face {
      font-family: 'Euclid Circular A';
      src: url('/fonts/EuclidCircularA-Medium.ttf') format('truetype');
      font-weight: 500 900; font-display: swap;
    }
    @font-face {
      font-family: 'MongoDB Value Serif';
      src: url('/fonts/MongoDBValueSerif-Regular.ttf') format('truetype');
      font-weight: 400; font-display: swap;
    }

    :root { color-scheme: dark; }
    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: #fff;
      font-family: 'Euclid Circular A', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 22px 16px 44px;
      gap: 22px;
      position: relative;
      overflow-x: hidden;
    }

    /* Mismo fondo que la aplicación: base oscura, retícula y resplandor verde */
    body::before {
      content: '';
      position: fixed; inset: 0; z-index: -2;
      background-color: #001E2B;
      background-image:
        linear-gradient(rgba(255,255,255,0.030) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.030) 1px, transparent 1px);
      background-size: 88px 88px, 88px 88px;
      background-position: center top;
    }
    body::after {
      content: '';
      position: fixed; inset: 0; z-index: -1; pointer-events: none;
      background:
        radial-gradient(ellipse 70% 46% at 50% -4%, rgba(0,237,100,0.20), transparent 62%),
        radial-gradient(ellipse 52% 60% at 2% 34%, rgba(0,237,100,0.13), transparent 66%),
        radial-gradient(ellipse 52% 60% at 98% 34%, rgba(0,237,100,0.11), transparent 66%),
        radial-gradient(ellipse 90% 70% at 50% 52%, transparent 42%, rgba(0,10,16,0.72) 100%);
    }

    .logo { height: 46px; width: auto; filter: drop-shadow(0 2px 8px rgba(0,0,0,.5)); }

    h1 {
      font-family: 'Euclid Circular A', system-ui, -apple-system, sans-serif;
      font-size: 1.7rem; margin: 0; text-align: center; font-weight: 800;
      letter-spacing: -0.02em;
      background-image: linear-gradient(100deg, #00ED64 0%, #00D2C8 45%, #B8E986 75%, #E3F79A 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }

    .comic {
      width: 100%; max-width: 760px; height: auto;
      border-radius: 14px;
      box-shadow: 0 12px 44px rgba(0,0,0,.55);
    }

    .acciones { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 360px; }

    a.boton {
      display: block; text-align: center; text-decoration: none;
      padding: 16px 24px; border-radius: 28px;
      font-size: 1.05rem; font-weight: 700;
      background: linear-gradient(135deg, #00ED64, #00684A); color: #fff;
      box-shadow: 0 6px 20px rgba(0,237,100,.28);
    }

    p.ayuda {
      opacity: .72; font-size: .85rem; text-align: center;
      margin: 0; max-width: 360px; line-height: 1.5;
    }
  </style>
</head>
<body>
  <img class="logo" src="/img/mongodb/MongoDB_White.svg" alt="MongoDB">
  <h1>Tu cómic está listo</h1>
  <img class="comic" src="/c/${id}/imagen.jpg" alt="Tu cómic">
  <div class="acciones">
    <a class="boton" href="/c/${id}/imagen.jpg" download="${id}.jpg">Descargar imagen</a>
  </div>
  <p class="ayuda">Si el botón no guarda la imagen, mantén el dedo sobre el cómic y elige “Guardar imagen”.</p>
</body>
</html>`);
  } catch (error) {
    res.status(500).send('Error al abrir el cómic');
  }
});

// Listado del archivo de historias, de la más reciente a la más antigua.
app.get('/api/historias', (req, res) => {
  try {
    const indice = path.join(HISTORIAS_DIR, 'index.jsonl');
    if (!fs.existsSync(indice)) return res.json({ total: 0, historias: [] });

    const historias = fs.readFileSync(indice, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(linea => { try { return JSON.parse(linea); } catch { return null; } })
      .filter(Boolean)
      .reverse();

    res.json({ total: historias.length, historias });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo leer el archivo de historias', details: error.message });
  }
});

// Descarga forzada. El nombre se valida contra un patrón fijo: viene de la URL
// y sin esto un "../" permitiría leer cualquier archivo del servidor (por ejemplo .env).
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;

  if (!/^comic_\d+\.jpg$/.test(filename)) {
    return res.status(400).json({ error: 'Nombre de archivo inválido' });
  }

  const filePath = path.join(DOWNLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

// Manejador de errores: sin esto multer devuelve HTML y el frontend revienta al
// hacer response.json() (archivo muy grande o formato no permitido).
app.use((err, req, res, next) => {
  console.error('Error de petición:', err.message);
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'La foto pesa demasiado. Vuelve a tomarla.'
      : `Error al subir la foto: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  res.status(400).json({ error: err.message || 'Petición inválida' });
});

app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`💥 Generador de Cómics con IA está listo`);
  console.log(`   motor: ${MOTOR} · ${NUM_VINETAS} viñetas · el texto lo rotula el servidor`);

  console.log(`   historias: ${HISTORIAS_DIR}`);
  console.log(`   URL pública: ${PUBLIC_URL || '(no configurada, se usa el host de la petición)'}`);

  if (!process.env.GOOGLE_API_KEY) {
    console.warn('⚠️  ADVERTENCIA: No se encontró GOOGLE_API_KEY en el archivo .env');
  }
  if (!PUBLIC_URL) {
    console.warn('⚠️  Sin PUBLIC_URL ni RENDER_EXTERNAL_URL: si abres la app en localhost, el QR no funcionará desde un celular.');
  }
  if (!process.env.STORAGE_DIR && process.env.RENDER) {
    console.warn('⚠️  Sin STORAGE_DIR: en Render los cómics se borran al reiniciar y los QR ya entregados darán 404.');
    console.warn('   Monta un Disk y apunta STORAGE_DIR a su Mount Path.');
  }
  const fuentes = await comprobarFuentes();
  if (fuentes.ok) {
    console.log('   fuentes de rotulación: OK');
  } else {
    console.error('❌ FUENTES NO DISPONIBLES: los globos saldrán sin texto.');
    console.error('   Ejecuta: npm run fuentes');
  }
});
