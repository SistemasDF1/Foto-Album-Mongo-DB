// Construcción de la página de cómic.
//
// El texto NO lo escribe el modelo de imagen: los modelos dibujan las letras como
// formas y salen con faltas de ortografía. En su lugar:
//   1. Un modelo de texto parte la historia en escenas con su diálogo.
//   2. Cada viñeta se genera SIN una sola letra.
//   3. Aquí se arma la página y se rotulan los globos con tipografía real.

import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Medidas de la página (px)
// ---------------------------------------------------------------------------
const MARGEN = 70;
const CANALETA = 40;
const COLUMNAS = 2;
const FILAS = 2;
export const NUM_VINETAS = COLUMNAS * FILAS;

const ANCHO_PAGINA = 2400;

// Proporción de cada viñeta (alto / ancho). Cerca de 1 porque el modelo devuelve
// imágenes cuadradas: cuanto más se aleje, más se recorta el dibujo.
const ASPECTO_VINETA = 1.08;

const VINETA_W = Math.floor((ANCHO_PAGINA - MARGEN * 2 - CANALETA * (COLUMNAS - 1)) / COLUMNAS);
const VINETA_H = Math.round(VINETA_W * ASPECTO_VINETA);

// El alto de la página sale de la retícula, no al revés. Así, cambiar COLUMNAS o
// FILAS ajusta la página sola sin deformar ni recortar de más las viñetas.
export const PAGINA = {
  ancho: ANCHO_PAGINA,
  alto: MARGEN * 2 + FILAS * VINETA_H + CANALETA * (FILAS - 1)
};

const BORDE = 8;

// Cadenas de fuentes para la rotulacion.
//
// Sharp dibuja el texto con librsvg, que solo ve fuentes INSTALADAS en el sistema
// (no sirve un @font-face ni un archivo suelto del proyecto). Por eso la cadena
// cubre los dos entornos:
//   - Windows local: Comic Sans MS y Arial Black vienen con el sistema.
//   - Linux (Render): las instala scripts/instalar-fuentes.mjs en el postinstall,
//     y al final quedan las libres que suelen venir en cualquier distro.
const FUENTE_TEXTO = "'Comic Sans MS', 'Euclid Circular A', 'DejaVu Sans', 'Liberation Sans', sans-serif";
const FUENTE_IMPACTO = "'Arial Black', 'Euclid Circular A', 'DejaVu Sans Bold', 'Liberation Sans Narrow', sans-serif";

// Ancho medio de carácter, en fracción del tamaño de fuente.
// No se puede fijar como constante: depende de la fuente que el sistema acabe
// usando (Comic Sans en Windows, DejaVu en Linux) y si se queda corta, el texto
// se sale de los globos. Se mide una vez, de verdad, sobre la fuente activa.
let anchoChar = null;

// Margen para que el texto nunca toque el borde de la caja.
const HOLGURA = 1.06;

async function medirAnchoChar() {
  if (anchoChar !== null) return anchoChar;

  const fontSize = 100;
  const muestra = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ ÁÉÍÓÚ,.¡!¿?';

  try {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="${fontSize * 2}">
        <rect width="100%" height="100%" fill="white"/>
        <text x="20" y="${fontSize * 1.3}" font-family="${FUENTE_TEXTO}" font-size="${fontSize}" font-weight="bold" fill="black">${muestra.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
      </svg>`
    );

    const { info } = await sharp(svg).trim({ threshold: 20 }).toBuffer({ resolveWithObject: true });
    const medido = info.width / muestra.length / fontSize;

    // Si la medición sale disparatada, no fiarse de ella
    anchoChar = medido > 0.3 && medido < 1.2 ? medido * HOLGURA : 0.72;
  } catch {
    anchoChar = 0.72;
  }

  return anchoChar;
}

// Valor por defecto hasta que se mida (se mide antes de rotular nada).
function factorAncho() {
  return anchoChar ?? 0.72;
}

// El modelo a veces dibuja un marco propio pese a pedirle que no: se recorta
// un poco de cada borde antes de encajar la viñeta.
const RECORTE_BORDE = 0.025;

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Reparte el texto en líneas sin cortar palabras.
function partirLineas(texto, maxChars) {
  const palabras = String(texto).trim().split(/\s+/);
  const lineas = [];
  let actual = '';

  for (const palabra of palabras) {
    if (!actual) {
      actual = palabra;
    } else if ((actual + ' ' + palabra).length <= maxChars) {
      actual += ' ' + palabra;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);

  return lineas;
}

// ---------------------------------------------------------------------------
// Rotulación: globos, cartuchos y onomatopeyas en SVG
// ---------------------------------------------------------------------------

// Calcula el tamaño que ocupará un globo, para poder ubicarlo antes de dibujarlo.
// Si con el tamaño pedido no cabría en la viñeta, reduce la fuente hasta que quepa.
function medirGlobo(texto, { maxChars = 20, fontSize = 46 } = {}) {
  const anchoMaximo = VINETA_W - 80;
  let tam = fontSize;

  for (let intento = 0; intento < 8; intento++) {
    const porLinea = Math.max(6, Math.floor(anchoMaximo / (tam * factorAncho())));
    const lineas = partirLineas(texto.toUpperCase(), Math.min(maxChars, porLinea));
    const lineH = tam * 1.25;
    const anchoTexto = Math.max(...lineas.map(l => l.length)) * tam * factorAncho();
    const rx = anchoTexto / 2 + 46;
    const ry = (lineas.length * lineH) / 2 + 40;

    if (rx * 2 <= anchoMaximo || tam <= 26) {
      return { lineas, lineH, rx, ry, ancho: rx * 2, alto: ry * 2, fontSize: tam };
    }
    tam -= 4;
  }

  // Inalcanzable en la práctica, pero deja el contrato explícito
  const lineas = partirLineas(texto.toUpperCase(), maxChars);
  return { lineas, lineH: tam * 1.25, rx: anchoMaximo / 2, ry: 60, ancho: anchoMaximo, alto: 120, fontSize: tam };
}

// Globo de diálogo ovalado con cola apuntando hacia abajo.
function globoDialogo(texto, { cx, cy, maxChars = 20, fontSize = 46 }) {
  const medida = medirGlobo(texto, { maxChars, fontSize });
  const { lineas, lineH, rx, ry } = medida;
  fontSize = medida.fontSize;

  // La cola sale del borde inferior del óvalo
  const colaBase = 34;
  const colaAlto = 58;
  const puntaX = cx - rx * 0.35;
  const cola = `${cx - colaBase / 2},${cy + ry - 6} ${cx + colaBase / 2},${cy + ry - 6} ${puntaX},${cy + ry + colaAlto}`;

  const primeraY = cy - ((lineas.length - 1) * lineH) / 2 + fontSize * 0.35;
  const tspans = lineas
    .map((l, i) => `<text x="${cx}" y="${primeraY + i * lineH}" text-anchor="middle" font-family="${FUENTE_TEXTO}" font-size="${fontSize}" font-weight="bold" fill="#111111">${escaparXml(l)}</text>`)
    .join('');

  return `<polygon points="${cola}" fill="#FFFFFF" stroke="#111111" stroke-width="6" stroke-linejoin="round"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#FFFFFF" stroke="#111111" stroke-width="6"/>
    <polygon points="${cola}" fill="#FFFFFF" stroke="none"/>
    ${tspans}`;
}

// Cartucho rectangular de narración, esquina superior izquierda.
function cartuchoNarracion(texto, { x, y, maxAncho }) {
  // Con textos largos se baja el tamaño antes que dejar que se salgan de la caja
  let fontSize = 40;
  let lineas, anchoDeChar;

  for (let intento = 0; intento < 6; intento++) {
    anchoDeChar = fontSize * factorAncho();
    const maxChars = Math.max(8, Math.floor((maxAncho - 40) / anchoDeChar));
    lineas = partirLineas(texto.toUpperCase(), maxChars);
    if (lineas.length <= 3 || fontSize <= 26) break;
    fontSize -= 3;
  }

  const lineH = fontSize * 1.24;
  const w = Math.min(maxAncho, Math.max(...lineas.map(l => l.length)) * anchoDeChar + 40);
  const h = lineas.length * lineH + 30;

  const textos = lineas
    .map((l, i) => `<text x="${x + 20}" y="${y + 26 + fontSize * 0.8 + i * lineH - fontSize * 0.2}" font-family="${FUENTE_TEXTO}" font-size="${fontSize}" font-weight="bold" fill="#111111">${escaparXml(l)}</text>`)
    .join('');

  return {
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFF4CC" stroke="#111111" stroke-width="5"/>${textos}`,
    ancho: w,
    alto: h
  };
}

// Onomatopeya: letras grandes con contorno.
function onomatopeya(texto, { cx, cy, rotacion = -8 }) {
  const limpio = escaparXml(texto.toUpperCase().slice(0, 12));
  const fontSize = 92;
  return `<g transform="translate(${cx} ${cy}) rotate(${rotacion})">
    <text x="0" y="0" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}" fill="#FFE212" stroke="#111111" stroke-width="14" stroke-linejoin="round" paint-order="stroke">${limpio}</text>
  </g>`;
}

// Que tan "cargada" esta una region del dibujo. Un valor bajo significa fondo
// liso (cielo, pared), que es donde conviene poner un globo para no tapar caras.
async function detalleDeZona(arte, left, top, width, height) {
  const region = {
    left: Math.max(0, Math.round(left)),
    top: Math.max(0, Math.round(top)),
    width: Math.min(Math.round(width), VINETA_W - Math.max(0, Math.round(left))),
    height: Math.min(Math.round(height), VINETA_H - Math.max(0, Math.round(top)))
  };
  if (region.width < 10 || region.height < 10) return Number.POSITIVE_INFINITY;

  try {
    const stats = await sharp(arte).extract(region).stats();
    const desviaciones = stats.channels.slice(0, 3).map(c => c.stdev);
    return desviaciones.reduce((a, b) => a + b, 0) / desviaciones.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// Elige, entre varias posiciones candidatas, la que menos detalle tapa.
async function mejorPosicion(arte, ancho, alto, candidatos) {
  let mejor = candidatos[0];
  let mejorPuntaje = Number.POSITIVE_INFINITY;

  for (const c of candidatos) {
    const puntaje = await detalleDeZona(arte, c.cx - ancho / 2, c.cy - alto / 2, ancho, alto);
    if (puntaje < mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = c;
    }
  }
  return mejor;
}

// Capa SVG con toda la rotulacion de una vineta, colocada sobre las zonas
// mas despejadas del dibujo para no taparle la cara al protagonista.
async function capaTexto(escena, arte) {
  const partes = [];
  const dialogo = (escena.dialogo || '').trim();
  const narracion = (escena.narracion || '').trim();
  const sonido = (escena.onomatopeya || '').trim();

  const margen = 40;
  let cartuchoAlto = 0;

  // La narracion siempre va arriba a la izquierda, como en un comic impreso.
  if (narracion) {
    const c = cartuchoNarracion(narracion, { x: margen, y: margen, maxAncho: VINETA_W * 0.6 });
    cartuchoAlto = c.alto;
    partes.push(c.svg);
  }

  if (dialogo) {
    const medida = medirGlobo(dialogo);
    const minX = medida.rx + margen;
    const maxX = VINETA_W - medida.rx - margen;
    // El globo arranca debajo del cartucho de narracion para no encimarse con el
    const techo = margen + (cartuchoAlto ? cartuchoAlto + 16 : 0);
    const filaAlta = techo + medida.ry;
    const filas = [filaAlta, filaAlta + medida.ry * 0.9];
    const columnas = [minX, VINETA_W / 2, maxX].filter(x => x >= minX - 1 && x <= maxX + 1);

    const candidatos = [];
    for (const cy of filas) {
      for (const cx of columnas) {
        candidatos.push({ cx, cy });
      }
    }
    if (!candidatos.length) candidatos.push({ cx: VINETA_W / 2, cy: filaAlta });

    const pos = await mejorPosicion(arte, medida.ancho, medida.alto, candidatos);
    partes.push(globoDialogo(dialogo, pos));
  }

  if (sonido) {
    const ancho = sonido.length * 60;
    const alto = 120;
    const candidatos = [
      { cx: VINETA_W * 0.27, cy: VINETA_H * 0.80 },
      { cx: VINETA_W * 0.73, cy: VINETA_H * 0.80 },
      { cx: VINETA_W * 0.27, cy: VINETA_H * 0.55 },
      { cx: VINETA_W * 0.73, cy: VINETA_H * 0.55 }
    ];
    const pos = await mejorPosicion(arte, ancho, alto, candidatos);
    partes.push(onomatopeya(sonido, pos));
  }

  if (!partes.length) return null;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VINETA_W}" height="${VINETA_H}">${partes.join('')}</svg>`
  );
}

// ---------------------------------------------------------------------------
// Composición de la página
// ---------------------------------------------------------------------------

// Recibe los buffers PNG de cada viñeta y devuelve la página terminada en base64.
export async function componerPagina(vinetas, escenas) {
  // Medir la fuente real antes de calcular cajas de texto
  await medirAnchoChar();

  const capas = [];

  for (let i = 0; i < vinetas.length; i++) {
    const col = i % COLUMNAS;
    const fila = Math.floor(i / COLUMNAS);
    const x = MARGEN + col * (VINETA_W + CANALETA);
    const y = MARGEN + fila * (VINETA_H + CANALETA);

    // Arte de la vineta: se recorta un poco de cada borde (por si el modelo
    // dibujo un marco pese a pedirle que no) y se encaja en la celda.
    const meta = await sharp(vinetas[i]).metadata();
    const recorteX = Math.round(meta.width * RECORTE_BORDE);
    const recorteY = Math.round(meta.height * RECORTE_BORDE);

    const arte = await sharp(vinetas[i])
      .extract({
        left: recorteX,
        top: recorteY,
        width: meta.width - recorteX * 2,
        height: meta.height - recorteY * 2
      })
      .resize(VINETA_W, VINETA_H, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

    capas.push({ input: arte, top: y, left: x });

    // Rotulacion encima del arte, esquivando las zonas con detalle
    const texto = await capaTexto(escenas[i] || {}, arte);
    if (texto) {
      capas.push({ input: await sharp(texto).png().toBuffer(), top: y, left: x });
    }

    // Marco negro de la viñeta
    const marco = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${VINETA_W}" height="${VINETA_H}">
        <rect x="${BORDE / 2}" y="${BORDE / 2}" width="${VINETA_W - BORDE}" height="${VINETA_H - BORDE}"
              fill="none" stroke="#111111" stroke-width="${BORDE}"/>
      </svg>`
    );
    capas.push({ input: await sharp(marco).png().toBuffer(), top: y, left: x });
  }

  const pagina = await sharp({
    create: {
      width: PAGINA.ancho,
      height: PAGINA.alto,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite(capas)
    // JPEG y no PNG: en PNG esta página pesa ~18 MB y el QR sería inservible
    // con datos móviles. A esta calidad el texto se mantiene nítido y baja a ~2 MB.
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return pagina.toString('base64');
}

export const MEDIDAS_VINETA = { ancho: VINETA_W, alto: VINETA_H };

// Dibuja una linea de prueba y mide cuanta tinta deja. Si el resultado sale en
// blanco, librsvg no encontro ninguna fuente y los globos saldrian sin texto.
export async function comprobarFuentes() {
  await medirAnchoChar();

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120">
      <rect width="100%" height="100%" fill="white"/>
      <text x="12" y="80" font-family="${FUENTE_TEXTO}" font-size="60" font-weight="bold" fill="black">ABC ¡Ñ! 123</text>
    </svg>`
  );

  try {
    const { channels } = await sharp(svg).png().stats();
    // Con texto negro sobre blanco la desviacion es alta; sin texto es casi cero.
    const stdev = channels[0].stdev;
    return { ok: stdev > 5, stdev: Math.round(stdev) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
