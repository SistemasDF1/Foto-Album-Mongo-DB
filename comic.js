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
const FUENTE_TEXTO = "'Euclid Circular A', 'Comic Sans MS', 'DejaVu Sans', 'Liberation Sans', sans-serif";
const FUENTE_IMPACTO = "'Euclid Circular A', 'Arial Black', 'DejaVu Sans Bold', 'Liberation Sans', sans-serif";

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
function medirGlobo(texto, { maxChars = 20, fontSize = 46, anchoDisponible = null } = {}) {
  const anchoMaximo = anchoDisponible || (VINETA_W - 80);
  let tam = fontSize;

  for (let intento = 0; intento < 8; intento++) {
    const porLinea = Math.max(6, Math.floor(anchoMaximo / (tam * factorAncho())));
    const lineas = partirLineas(texto.toUpperCase(), Math.min(maxChars, porLinea));
    const lineH = tam * 1.25;
    const anchoTexto = Math.max(...lineas.map(l => l.length)) * tam * factorAncho();
    const rx = anchoTexto / 2 + 46;
    const ry = (lineas.length * lineH) / 2 + 40;

    if (rx * 2 <= anchoMaximo || tam <= 22) {
      return { lineas, lineH, rx, ry, ancho: rx * 2, alto: ry * 2, fontSize: tam };
    }
    tam -= 4;
  }

  // Inalcanzable en la práctica, pero deja el contrato explícito
  const lineas = partirLineas(texto.toUpperCase(), maxChars);
  return { lineas, lineH: tam * 1.25, rx: anchoMaximo / 2, ry: 60, ancho: anchoMaximo, alto: 120, fontSize: tam };
}

// Globo de diálogo. La cola apunta al personaje: un globo cuya cola señala al
// vacío rompe la lectura, porque no se sabe quién habla.
function globoDialogo(texto, { cx, cy, maxChars = 20, fontSize = 46, hacia = null, anchoDisponible = null }) {
  const medida = medirGlobo(texto, { maxChars, fontSize, anchoDisponible });
  const { lineas, lineH, rx, ry } = medida;
  fontSize = medida.fontSize;

  // Destino de la cola: el sujeto que habla, o abajo si no se sabe dónde está
  const destinoX = hacia ? hacia.x : cx - rx * 0.35;
  const destinoY = hacia ? hacia.y : cy + ry + 90;

  // La cola arranca del borde del óvalo más cercano al destino
  const angulo = Math.atan2(destinoY - cy, destinoX - cx);
  const baseX = cx + Math.cos(angulo) * rx * 0.75;
  const baseY = cy + Math.sin(angulo) * ry * 0.9;

  // Ancho de la base, perpendicular a la dirección de la cola
  const colaBase = 34;
  const perpX = Math.cos(angulo + Math.PI / 2) * colaBase / 2;
  const perpY = Math.sin(angulo + Math.PI / 2) * colaBase / 2;

  // La punta se queda a medio camino: una cola larguísima queda fea
  const largo = Math.min(
    Math.hypot(destinoX - cx, destinoY - cy) - Math.max(rx, ry) * 0.6,
    ry * 2.2
  );
  const puntaX = baseX + Math.cos(angulo) * Math.max(largo, 40);
  const puntaY = baseY + Math.sin(angulo) * Math.max(largo, 40);

  const cola = `${baseX - perpX},${baseY - perpY} ${baseX + perpX},${baseY + perpY} ${puntaX},${puntaY}`;

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

// Aspecto del estallido según el estilo de dibujo del cómic. Un ¡BOOM! con
// colores planos y saturados desentona en una acuarela o en un noir.
const ESTILO_SONIDO = {
  americano:  { estallido: '#F2B233', semitono: '#E8112D', texto: '#E8112D', borde: '#111111', trazo: 11, rayos: true, estrellas: true, semitonoVisible: true },
  caricatura: { estallido: '#FFD23F', semitono: '#FF6B35', texto: '#E8112D', borde: '#111111', trazo: 12, rayos: true, estrellas: true, semitonoVisible: true },
  retro:      { estallido: '#F4D35E', semitono: '#EE964B', texto: '#C1121F', borde: '#3D2B1F', trazo: 10, rayos: true, estrellas: true, semitonoVisible: true },
  pixar:      { estallido: '#4CC9F0', semitono: '#4361EE', texto: '#FFFFFF', borde: '#1B2A5B', trazo: 11, rayos: true, estrellas: true, semitonoVisible: false },
  chibi:      { estallido: '#FFC8DD', semitono: '#BDE0FE', texto: '#C9184A', borde: '#7A4E68', trazo: 9,  rayos: false, estrellas: true, semitonoVisible: false },

  // Blanco y negro: el color rompería por completo la página
  manga:      { estallido: '#FFFFFF', semitono: '#000000', texto: '#111111', borde: '#111111', trazo: 10, rayos: true, estrellas: false, semitonoVisible: true },
  noir:       { estallido: '#F2F2F2', semitono: '#000000', texto: '#111111', borde: '#000000', trazo: 12, rayos: true, estrellas: false, semitonoVisible: false },

  // Acuarela: sin contornos duros ni brillos
  acuarela:   { estallido: '#CDB4DB', semitono: '#A8DADC', texto: '#3D405B', borde: '#6B705C', trazo: 6,  rayos: false, estrellas: false, semitonoVisible: false }
};

const SONIDO_POR_DEFECTO = ESTILO_SONIDO.americano;

// Poligono en forma de estrella irregular: el estallido clasico del comic.
function estallido(rx, ry, puntas = 14) {
  const coords = [];
  for (let i = 0; i < puntas * 2; i++) {
    const angulo = (Math.PI * i) / puntas;
    const esPunta = i % 2 === 0;
    const variacion = 1 + (i % 3) * 0.08 - (i % 5) * 0.05;
    const factor = (esPunta ? 1 : 0.6) * variacion;
    coords.push(`${(Math.cos(angulo) * rx * factor).toFixed(1)},${(Math.sin(angulo) * ry * factor).toFixed(1)}`);
  }
  return coords.join(' ');
}

// Nube redondeada, para los estilos sin aristas (acuarela, chibi)
function nubeSonido(rx, ry, lobulos = 11) {
  const coords = [];
  for (let i = 0; i < lobulos * 2; i++) {
    const angulo = (Math.PI * i) / lobulos;
    const factor = i % 2 === 0 ? 1 : 0.86;
    coords.push(`${(Math.cos(angulo) * rx * factor).toFixed(1)},${(Math.sin(angulo) * ry * factor).toFixed(1)}`);
  }
  return coords.join(' ');
}

// Rayos de velocidad: lineas finas que salen del estallido hacia fuera.
function rayosVelocidad(rx, ry, color = '#111111', cantidad = 18) {
  const rayos = [];
  for (let i = 0; i < cantidad; i++) {
    const angulo = (Math.PI * 2 * i) / cantidad + 0.15;
    const desde = 1.02 + (i % 3) * 0.04;
    const hasta = desde + 0.16 + (i % 4) * 0.06;
    const x1 = (Math.cos(angulo) * rx * desde).toFixed(1);
    const y1 = (Math.sin(angulo) * ry * desde).toFixed(1);
    const x2 = (Math.cos(angulo) * rx * hasta).toFixed(1);
    const y2 = (Math.sin(angulo) * ry * hasta).toFixed(1);
    rayos.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${5 + (i % 3) * 2}" stroke-linecap="round"/>`);
  }
  return rayos.join('');
}

// Estrellita de cinco puntas, de las que rodean al estallido.
function estrella(cx, cy, radio, relleno, borde) {
  const puntos = [];
  for (let i = 0; i < 10; i++) {
    const angulo = (Math.PI * i) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? radio : radio * 0.42;
    puntos.push(`${(cx + Math.cos(angulo) * r).toFixed(1)},${(cy + Math.sin(angulo) * r).toFixed(1)}`);
  }
  return `<polygon points="${puntos.join(' ')}" fill="${relleno}" stroke="${borde}" stroke-width="4" stroke-linejoin="round"/>`;
}

let contadorSonido = 0;

// Onomatopeya al gusto del estilo de dibujo elegido.
function onomatopeya(texto, { cx, cy, rotacion = -12, estilo = 'americano' }) {
  const crudo = texto.toUpperCase().slice(0, 12);
  const limpio = escaparXml(crudo);
  const paleta = ESTILO_SONIDO[estilo] || SONIDO_POR_DEFECTO;
  const idPatron = `semitono${contadorSonido++}`;

  const fontSize = 104;
  const anchoTexto = crudo.length * fontSize * factorAncho();
  const rx = anchoTexto / 2 + fontSize * 0.9;
  const ry = fontSize * 1.2;

  const forma = paleta.rayos ? estallido(rx, ry) : nubeSonido(rx, ry);
  const formaInterior = paleta.rayos ? estallido(rx * 0.72, ry * 0.7) : nubeSonido(rx * 0.72, ry * 0.7);

  const capas = [];

  if (paleta.rayos) capas.push(rayosVelocidad(rx, ry, paleta.borde));

  capas.push(`<polygon points="${forma}" fill="${paleta.estallido}" stroke="${paleta.borde}" stroke-width="${paleta.trazo}" stroke-linejoin="round"/>`);

  if (paleta.semitonoVisible) {
    capas.push(`<defs><pattern id="${idPatron}" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="6" cy="6" r="5" fill="${paleta.semitono}" opacity="0.5"/>
    </pattern></defs>`);
    capas.push(`<polygon points="${forma}" fill="url(#${idPatron})" stroke="none"/>`);
  }

  capas.push(`<polygon points="${formaInterior}" fill="#FFFFFF" stroke="none" opacity="${paleta.rayos ? 0.5 : 0.35}"/>`);

  if (paleta.estrellas) {
    capas.push(estrella(-rx * 0.92, -ry * 0.78, 26, paleta.estallido, paleta.borde));
    capas.push(estrella(rx * 0.95, ry * 0.7, 22, paleta.estallido, paleta.borde));
  }

  capas.push(`<g transform="skewX(-9)">
    <text x="7" y="${fontSize * 0.36 + 9}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}" fill="${paleta.borde}" opacity="0.45">${limpio}</text>
    <text x="0" y="${fontSize * 0.36}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}"
          fill="none" stroke="${paleta.borde}" stroke-width="${paleta.trazo * 2.6}" stroke-linejoin="round">${limpio}</text>
    <text x="0" y="${fontSize * 0.36}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}"
          fill="none" stroke="#FFFFFF" stroke-width="${paleta.trazo * 1.4}" stroke-linejoin="round">${limpio}</text>
    <text x="0" y="${fontSize * 0.36}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}"
          fill="${paleta.texto}">${limpio}</text>
  </g>`);

  return `<g transform="translate(${cx} ${cy}) rotate(${rotacion})">${capas.join('')}</g>`;
}

// Cuanto se pisan dos rectangulos, en pixeles cuadrados.
function areaSolapada(a, b) {
  const ancho = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const alto = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ancho > 0 && alto > 0 ? ancho * alto : 0;
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

// Localiza la cara por tono de piel. Solo sirve en estilos a color: en manga y
// noir devuelve null y entra en juego localizarFigura.
async function localizarCara(arte) {
  const LADO = 64;

  try {
    const { data, info } = await sharp(arte)
      .resize(LADO, LADO, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const canales = info.channels;
    let minX = LADO, minY = LADO, maxX = -1, maxY = -1, total = 0;

    for (let y = 0; y < LADO; y++) {
      for (let x = 0; x < LADO; x++) {
        const i = (y * LADO + x) * canales;
        const r = data[i], g = data[i + 1], b = data[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const esPiel =
          r > 80 && g > 35 && b > 15 &&
          max - min > 12 &&
          r > g && g >= b &&
          r - g < 90;

        if (!esPiel) continue;

        total++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const proporcion = total / (LADO * LADO);
    if (total < 12 || proporcion > 0.5 || maxX < 0) return null;

    const escalaX = VINETA_W / LADO;
    const escalaY = VINETA_H / LADO;

    return {
      x: minX * escalaX,
      y: minY * escalaY,
      w: (maxX - minX + 1) * escalaX,
      h: (maxY - minY + 1) * escalaY
    };
  } catch {
    return null;
  }
}

// Recuadro que ocupa la figura dibujada, y dentro de él la zona de la cabeza.
//
// La detección por tono de piel no sirve en manga ni en noir, que son en blanco
// y negro: ahí devolvía null y la cara quedaba sin proteger. Esto funciona en
// cualquier estilo, porque se basa en dónde se concentra el detalle del dibujo.
async function localizarFigura(arte) {
  const COLS = 12;
  const FILAS = 12;
  const anchoCelda = Math.floor(VINETA_W / COLS);
  const altoCelda = Math.floor(VINETA_H / FILAS);

  const celdas = [];
  let maximo = 0;

  for (let f = 0; f < FILAS; f++) {
    for (let c = 0; c < COLS; c++) {
      const detalle = await detalleDeZona(arte, c * anchoCelda, f * altoCelda, anchoCelda, altoCelda);
      const valor = Number.isFinite(detalle) ? detalle : 0;
      celdas.push({ c, f, valor });
      if (valor > maximo) maximo = valor;
    }
  }

  if (!maximo) return null;

  // Se quedan las celdas con detalle alto: son la figura y los objetos cercanos
  const umbral = maximo * 0.55;
  const activas = celdas.filter(x => x.valor >= umbral);
  if (activas.length < 3) return null;

  const minC = Math.min(...activas.map(x => x.c));
  const maxC = Math.max(...activas.map(x => x.c));
  const minF = Math.min(...activas.map(x => x.f));
  const maxF = Math.max(...activas.map(x => x.f));

  const cuerpo = {
    x: minC * anchoCelda,
    y: minF * altoCelda,
    w: (maxC - minC + 1) * anchoCelda,
    h: (maxF - minF + 1) * altoCelda
  };

  // La cabeza ocupa aproximadamente el tercio superior de la figura
  const cabeza = {
    x: cuerpo.x + cuerpo.w * 0.12,
    y: cuerpo.y,
    w: cuerpo.w * 0.76,
    h: Math.max(cuerpo.h * 0.38, VINETA_H * 0.18)
  };

  return { cuerpo, cabeza };
}

// Estima dónde está el personaje: la zona con más detalle del dibujo.
// Se recorre la viñeta en una cuadrícula y se toma el centro de masa del
// detalle, con más peso en la mitad inferior, que es donde el prompt pide que
// esté la figura.
async function localizarSujeto(arte) {
  const columnas = 4;
  const filas = 4;
  const anchoCelda = Math.floor(VINETA_W / columnas);
  const altoCelda = Math.floor(VINETA_H / filas);

  let sumaPeso = 0;
  let sumaX = 0;
  let sumaY = 0;

  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < columnas; c++) {
      const x = c * anchoCelda;
      const y = f * altoCelda;
      const detalle = await detalleDeZona(arte, x, y, anchoCelda, altoCelda);
      if (!Number.isFinite(detalle)) continue;

      // La franja superior suele ser cielo o pared: pesa menos
      const pesoFila = f === 0 ? 0.35 : (f === 1 ? 0.9 : 1.2);
      const peso = detalle * pesoFila;

      sumaPeso += peso;
      sumaX += (x + anchoCelda / 2) * peso;
      sumaY += (y + altoCelda / 2) * peso;
    }
  }

  if (!sumaPeso) return { x: VINETA_W / 2, y: VINETA_H * 0.6 };
  return { x: sumaX / sumaPeso, y: sumaY / sumaPeso };
}

// Elige la posición que menos detalle tapa Y que no se pise con las cajas de
// texto ya colocadas. El solapamiento pesa mucho más que el detalle del dibujo:
// antes se calculaban posiciones "que no deberían" chocar, y bastaba un cartucho
// de tres líneas para que globo y narración acabaran pegados.
async function mejorPosicion(arte, ancho, alto, candidatos, ocupados = [], cerca = null) {
  let mejor = candidatos[0];
  let mejorPuntaje = Number.POSITIVE_INFINITY;

  // Distancia máxima posible dentro de la viñeta, para normalizar la cercanía
  const diagonal = Math.hypot(VINETA_W, VINETA_H);

  for (const c of candidatos) {
    const caja = { x: c.cx - ancho / 2, y: c.cy - alto / 2, w: ancho, h: alto };

    // Margen de respiro alrededor de lo ya colocado y de la figura del personaje
    const solape = ocupados.reduce((total, o) => total + areaSolapada(caja, {
      x: o.x - 18, y: o.y - 18, w: o.w + 36, h: o.h + 36
    }), 0);

    const detalle = await detalleDeZona(arte, caja.x, caja.y, ancho, alto);

    // Tapar algo pesa muchísimo más que cualquier otra consideración
    let puntaje = detalle + (solape / (ancho * alto)) * 10000;

    // Entre las posiciones que no tapan, gana la más cercana a quien habla:
    // así el globo queda junto al personaje sin encimarse.
    if (cerca) {
      const distancia = Math.hypot(c.cx - cerca.x, c.cy - cerca.y);
      puntaje += (distancia / diagonal) * 60;
    }

    if (puntaje < mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = c;
    }
  }
  return mejor;
}

// Capa SVG con toda la rotulacion de una vineta, colocada sobre las zonas
// mas despejadas del dibujo para no taparle la cara al protagonista.
async function capaTexto(escena, arte, estilo) {
  const partes = [];
  const ocupados = [];
  const dialogo = (escena.dialogo || '').trim();
  const narracion = (escena.narracion || '').trim();
  const sonido = (escena.onomatopeya || '').trim();

  const margen = 40;
  let cartuchoAlto = 0;

  // Localizar al personaje: la figura completa y su cabeza
  let figura = null;
  let cabeza = null;

  if (dialogo || sonido) {
    const fig = await localizarFigura(arte);
    if (fig) {
      figura = fig.cuerpo;
      cabeza = fig.cabeza;
    }

    // El tono de piel afina la posición de la cara cuando el estilo es a color
    const cara = await localizarCara(arte);
    if (cara) cabeza = cara;
  }

  const centroFigura = figura ? figura.x + figura.w / 2 : VINETA_W / 2;
  const figuraALaIzquierda = centroFigura < VINETA_W / 2;

  // La narración va arriba, en la esquina contraria a la figura
  if (narracion) {
    const provisional = cartuchoNarracion(narracion, { x: margen, y: margen, maxAncho: VINETA_W * 0.58 });
    const x = figuraALaIzquierda ? VINETA_W - provisional.ancho - margen : margen;
    const cartucho = cartuchoNarracion(narracion, { x, y: margen, maxAncho: VINETA_W * 0.58 });

    cartuchoAlto = cartucho.alto;
    partes.push(cartucho.svg);
    ocupados.push({ x, y: margen, w: cartucho.ancho, h: cartucho.alto });
  }

  if (dialogo) {
    const techo = margen + (cartuchoAlto ? cartuchoAlto + 46 : 0);

    // Huecos reales a cada lado de la figura y por encima de ella
    const huecoIzq = figura ? Math.max(0, figura.x - margen) : VINETA_W / 2;
    const huecoDer = figura ? Math.max(0, VINETA_W - (figura.x + figura.w) - margen) : VINETA_W / 2;
    const huecoArriba = figura ? figura.y - techo : VINETA_H * 0.35;

    // Se prueba cada hueco midiendo el globo con ESE ancho, y se descarta el que
    // no lo admita. Sin esta comprobación el globo se desbordaba del hueco y
    // acababa igualmente sobre la cara.
    const opciones = [];

    if (huecoDer > 180) {
      const m = medirGlobo(dialogo, { anchoDisponible: huecoDer - 24 });
      if (m.ancho <= huecoDer - 10) {
        opciones.push({ medida: m, cx: figura.x + figura.w + huecoDer / 2, lateral: true });
      }
    }

    if (huecoIzq > 180) {
      const m = medirGlobo(dialogo, { anchoDisponible: huecoIzq - 24 });
      if (m.ancho <= huecoIzq - 10) {
        opciones.push({ medida: m, cx: margen + huecoIzq / 2, lateral: true });
      }
    }

    if (huecoArriba > 200) {
      const m = medirGlobo(dialogo, { anchoDisponible: VINETA_W - margen * 2 });
      if (m.alto <= huecoArriba - 20) {
        opciones.push({ medida: m, cx: VINETA_W / 2, arriba: true });
      }
    }

    // Gana el globo más grande que quepa; entre iguales, el lateral
    opciones.sort((a, b) => (b.medida.fontSize - a.medida.fontSize) || (Number(b.lateral) - Number(a.lateral)));

    let pos;
    let medida;

    if (opciones.length) {
      const elegida = opciones[0];
      medida = elegida.medida;

      let cy;
      if (elegida.arriba) {
        cy = techo + medida.ry;
      } else {
        // A la altura de la cabeza, para que la cola sea corta
        const alturaCabeza = cabeza ? cabeza.y + cabeza.h * 0.4 : VINETA_H * 0.32;
        cy = Math.min(Math.max(alturaCabeza, techo + medida.ry), VINETA_H - medida.ry - 110);
      }

      pos = {
        cx: Math.min(Math.max(elegida.cx, medida.rx + margen), VINETA_W - medida.rx - margen),
        cy
      };
    } else {
      // No hay hueco limpio: se busca por coste la posición que menos estorbe,
      // con la cara pesando mucho más que el resto del dibujo.
      medida = medirGlobo(dialogo);

      const prohibidas = [...ocupados];
      if (cabeza) {
        const hx = cabeza.w * 0.35, hy = cabeza.h * 0.35;
        prohibidas.push({ x: cabeza.x - hx, y: cabeza.y - hy, w: cabeza.w + hx * 2, h: cabeza.h + hy * 2 });
      }

      const candidatos = [];
      for (const fx of [0.16, 0.32, 0.5, 0.68, 0.84]) {
        for (const fy of [0.14, 0.3, 0.48, 0.66]) {
          const cx = Math.min(Math.max(VINETA_W * fx, medida.rx + margen), VINETA_W - medida.rx - margen);
          const cy = VINETA_H * fy;
          if (cy - medida.ry < techo) continue;
          if (cy + medida.ry + 90 > VINETA_H) continue;
          candidatos.push({ cx, cy });
        }
      }
      if (!candidatos.length) candidatos.push({ cx: VINETA_W / 2, cy: techo + medida.ry });

      pos = await mejorPosicion(
        arte, medida.ancho, medida.alto, candidatos, prohibidas,
        cabeza ? { x: cabeza.x + cabeza.w / 2, y: cabeza.y + cabeza.h } : null
      );
    }

    // La cola apunta a la cabeza, que es quien habla
    const destino = cabeza
      ? { x: cabeza.x + cabeza.w / 2, y: cabeza.y + cabeza.h * 0.75 }
      : { x: centroFigura, y: pos.cy + medida.ry + 80 };

    partes.push(globoDialogo(dialogo, {
      cx: pos.cx,
      cy: pos.cy,
      hacia: destino,
      anchoDisponible: medida.ancho + 1   // conserva el tamaño ya calculado
    }));

    ocupados.push({
      x: pos.cx - medida.rx,
      y: pos.cy - medida.ry,
      w: medida.ancho,
      h: medida.alto + 90
    });
  }

  if (sonido) {
    const ancho = sonido.length * 104 * factorAncho() + 230;
    const alto = 300;
    const media = ancho / 2 + 20;

    const prohibidas = [...ocupados];
    if (cabeza) prohibidas.push(cabeza);
    if (figura) prohibidas.push(figura);

    const candidatos = [];
    for (const fx of [0.18, 0.34, 0.5, 0.66, 0.82]) {
      for (const fy of [0.55, 0.7, 0.85]) {
        const cx = Math.min(Math.max(VINETA_W * fx, media), VINETA_W - media);
        candidatos.push({ cx, cy: VINETA_H * fy });
      }
    }

    const pos = await mejorPosicion(
      arte, ancho, alto, candidatos, prohibidas,
      { x: centroFigura, y: VINETA_H * 0.82 }
    );
    partes.push(onomatopeya(sonido, { ...pos, estilo }));
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
export async function componerPagina(vinetas, escenas, estilo = 'americano') {
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
    const texto = await capaTexto(escenas[i] || {}, arte, estilo);
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
