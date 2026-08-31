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

// Globo de diálogo. La cola apunta al personaje: un globo cuya cola señala al
// vacío rompe la lectura, porque no se sabe quién habla.
function globoDialogo(texto, { cx, cy, maxChars = 20, fontSize = 46, hacia = null }) {
  const medida = medirGlobo(texto, { maxChars, fontSize });
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

// Paleta del estallido segun el tipo de sonido. Un golpe y un maullido no
// deben verse igual.
const PALETAS_SONIDO = [
  { test: /BOOM|BANG|CRASH|POW|PUM|BUM|CRACK|PLAF|ZAS|SMASH|WHAM/, estallido: '#F2B233', semitono: '#E8112D', texto: '#E8112D' },
  { test: /ZUM|SWOOSH|WHOOSH|FIU|SWISH|VROOM|ZZZ|SHH|CLIC|CLICK/,  estallido: '#F2B233', semitono: '#0A66C2', texto: '#0A66C2' },
  { test: /GUAU|MIAU|ÑAM|NAM|JAJA|AAAH|UFF|SNIF|MUA/,              estallido: '#F2B233', semitono: '#00A34A', texto: '#00A34A' }
];
const PALETA_SONIDO_DEFECTO = { estallido: '#F2B233', semitono: '#E8112D', texto: '#E8112D' };

function paletaSonido(texto) {
  const limpio = texto.toUpperCase();
  return PALETAS_SONIDO.find(p => p.test.test(limpio)) || PALETA_SONIDO_DEFECTO;
}

// Poligono en forma de estrella irregular: el estallido clasico del comic.
function estallido(rx, ry, puntas = 14) {
  const coords = [];
  for (let i = 0; i < puntas * 2; i++) {
    const angulo = (Math.PI * i) / puntas;
    const esPunta = i % 2 === 0;
    // Variacion determinista: mismo sonido, mismo estallido
    const variacion = 1 + (i % 3) * 0.08 - (i % 5) * 0.05;
    const factor = (esPunta ? 1 : 0.6) * variacion;
    coords.push(`${(Math.cos(angulo) * rx * factor).toFixed(1)},${(Math.sin(angulo) * ry * factor).toFixed(1)}`);
  }
  return coords.join(' ');
}

// Rayos de velocidad: lineas finas que salen del estallido hacia fuera.
function rayosVelocidad(rx, ry, cantidad = 18) {
  const rayos = [];
  for (let i = 0; i < cantidad; i++) {
    const angulo = (Math.PI * 2 * i) / cantidad + 0.15;
    const desde = 1.02 + (i % 3) * 0.04;
    const hasta = desde + 0.16 + (i % 4) * 0.06;
    const x1 = (Math.cos(angulo) * rx * desde).toFixed(1);
    const y1 = (Math.sin(angulo) * ry * desde).toFixed(1);
    const x2 = (Math.cos(angulo) * rx * hasta).toFixed(1);
    const y2 = (Math.sin(angulo) * ry * hasta).toFixed(1);
    rayos.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111111" stroke-width="${5 + (i % 3) * 2}" stroke-linecap="round"/>`);
  }
  return rayos.join('');
}

// Estrellita de cinco puntas, de las que rodean al estallido.
function estrella(cx, cy, radio) {
  const puntos = [];
  for (let i = 0; i < 10; i++) {
    const angulo = (Math.PI * i) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? radio : radio * 0.42;
    puntos.push(`${(cx + Math.cos(angulo) * r).toFixed(1)},${(cy + Math.sin(angulo) * r).toFixed(1)}`);
  }
  return `<polygon points="${puntos.join(' ')}" fill="#FFE212" stroke="#111111" stroke-width="4" stroke-linejoin="round"/>`;
}

// Onomatopeya estilo comic: estallido con semitono, rayos de velocidad,
// estrellas y letras de color con doble contorno.
let contadorSonido = 0;

function onomatopeya(texto, { cx, cy, rotacion = -12 }) {
  const crudo = texto.toUpperCase().slice(0, 12);
  const limpio = escaparXml(crudo);
  const paleta = paletaSonido(crudo);
  const idPatron = `semitono${contadorSonido++}`;

  const fontSize = 104;
  const anchoTexto = crudo.length * fontSize * factorAncho();
  const rx = anchoTexto / 2 + fontSize * 0.9;
  const ry = fontSize * 1.2;

  return `<g transform="translate(${cx} ${cy}) rotate(${rotacion})">
    <defs>
      <pattern id="${idPatron}" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="6" cy="6" r="5" fill="${paleta.semitono}" opacity="0.55"/>
      </pattern>
    </defs>

    ${rayosVelocidad(rx, ry)}

    <polygon points="${estallido(rx, ry)}" fill="${paleta.estallido}" stroke="#111111" stroke-width="11" stroke-linejoin="round"/>
    <polygon points="${estallido(rx, ry)}" fill="url(#${idPatron})" stroke="none"/>
    <polygon points="${estallido(rx * 0.72, ry * 0.7)}" fill="#FFFFFF" stroke="none" opacity="0.55"/>

    ${estrella(-rx * 0.92, -ry * 0.78, 26)}
    ${estrella(rx * 0.95, ry * 0.7, 22)}
    ${estrella(rx * 0.62, -ry * 0.98, 17)}

    <g transform="skewX(-9)">
      <text x="7" y="${fontSize * 0.36 + 9}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}" fill="#111111" opacity="0.5">${limpio}</text>
      <text x="0" y="${fontSize * 0.36}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}"
            fill="none" stroke="#111111" stroke-width="30" stroke-linejoin="round">${limpio}</text>
      <text x="0" y="${fontSize * 0.36}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}"
            fill="none" stroke="#FFFFFF" stroke-width="16" stroke-linejoin="round">${limpio}</text>
      <text x="0" y="${fontSize * 0.36}" text-anchor="middle" font-family="${FUENTE_IMPACTO}" font-size="${fontSize}"
            fill="${paleta.texto}">${limpio}</text>
    </g>
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

// Cuánto se pisan dos rectángulos, en píxeles cuadrados.
function areaSolapada(a, b) {
  const ancho = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const alto = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ancho > 0 && alto > 0 ? ancho * alto : 0;
}

// Localiza la cara del personaje por color de piel.
//
// Es lo único que de verdad no se puede tapar. El centro de masa del detalle no
// sirve: en un primer plano cae en el torso y deja la cara desprotegida, que es
// justo donde se estaba poniendo el globo.
//
// Se trabaja sobre una miniatura: basta para saber dónde está la cara y evita
// recorrer millones de píxeles.
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

        // Regla clásica de tono piel, algo relajada para ilustraciones
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

    // Muy pocos píxeles de piel, o demasiados (un fondo cálido): no es fiable
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
async function capaTexto(escena, arte) {
  const partes = [];
  const ocupados = [];
  const dialogo = (escena.dialogo || '').trim();
  const narracion = (escena.narracion || '').trim();
  const sonido = (escena.onomatopeya || '').trim();

  const margen = 40;
  let cartuchoAlto = 0;

  // Dónde está el personaje: de ahí depende toda la composición
  const sujeto = (dialogo || sonido) ? await localizarSujeto(arte) : null;
  const sujetoALaIzquierda = sujeto ? sujeto.x < VINETA_W / 2 : false;

  // Zonas que no se pueden tapar: la cara detectada por tono de piel (con
  // holgura generosa alrededor) y, como respaldo, la figura estimada.
  const prohibidas = [];

  if (dialogo || sonido) {
    const cara = await localizarCara(arte);
    if (cara) {
      const holguraX = cara.w * 0.5;
      const holguraY = cara.h * 0.5;
      prohibidas.push({
        x: cara.x - holguraX,
        y: cara.y - holguraY,
        w: cara.w + holguraX * 2,
        h: cara.h + holguraY * 2
      });
    }

    if (sujeto) {
      prohibidas.push({
        x: sujeto.x - VINETA_W * 0.2,
        y: sujeto.y - VINETA_H * 0.26,
        w: VINETA_W * 0.4,
        h: VINETA_H * 0.55
      });
    }
  }

  const figura = prohibidas.length ? prohibidas[0] : null;

  // La narración va arriba, en la esquina contraria al personaje
  if (narracion) {
    const provisional = cartuchoNarracion(narracion, { x: margen, y: margen, maxAncho: VINETA_W * 0.58 });
    const x = sujetoALaIzquierda ? VINETA_W - provisional.ancho - margen : margen;
    const cartucho = cartuchoNarracion(narracion, { x, y: margen, maxAncho: VINETA_W * 0.58 });

    cartuchoAlto = cartucho.alto;
    partes.push(cartucho.svg);
    ocupados.push({ x, y: margen, w: cartucho.ancho, h: cartucho.alto });
  }

  if (dialogo) {
    const medida = medirGlobo(dialogo);
    const minX = medida.rx + margen;
    const maxX = VINETA_W - medida.rx - margen;

    const SEPARACION = 46;
    const techo = margen + (cartuchoAlto ? cartuchoAlto + SEPARACION : 0);
    const arriba = techo + medida.ry;

    // Rejilla amplia de posiciones: cuantas más haya, más fácil es encontrar
    // una que no tape al personaje.
    const columnas = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const x = minX + (maxX - minX) * f;
      if (x >= minX - 1 && x <= maxX + 1) columnas.push(x);
    }

    const filas = [];
    for (const f of [0, 0.18, 0.36, 0.55]) {
      const y = arriba + (VINETA_H - arriba - medida.ry - 90) * f;
      filas.push(y);
    }

    const candidatos = [];
    for (const cy of filas) {
      for (const cx of columnas) {
        if (cy - medida.ry < margen) continue;
        if (cy + medida.ry + 70 > VINETA_H) continue;
        candidatos.push({ cx, cy });
      }
    }
    if (!candidatos.length) candidatos.push({ cx: VINETA_W / 2, cy: arriba });

    // Prohibido sobre la figura; premiado estar cerca de su cabeza
    const cabeza = { x: sujeto.x, y: Math.max(sujeto.y - VINETA_H * 0.22, margen) };
    const pos = await mejorPosicion(
      arte, medida.ancho, medida.alto, candidatos,
      [...ocupados, ...prohibidas],
      cabeza
    );

    // La cola apunta a la boca: bajo la cara si se detectó, o al torso si no
    const destino = figura
      ? { x: figura.x + figura.w / 2, y: figura.y + figura.h * 0.72 }
      : { x: sujeto.x, y: Math.max(sujeto.y - VINETA_H * 0.12, pos.cy + medida.ry + 40) };

    partes.push(globoDialogo(dialogo, { ...pos, hacia: destino }));

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

    // El estallido acompaña la acción, pero tampoco puede taparle la cara

    const candidatos = [];
    for (const fx of [0.22, 0.4, 0.6, 0.78]) {
      for (const fy of [0.58, 0.72, 0.86]) {
        const cx = Math.min(Math.max(VINETA_W * fx, media), VINETA_W - media);
        candidatos.push({ cx, cy: VINETA_H * fy });
      }
    }

    const pos = await mejorPosicion(
      arte, ancho, alto, candidatos,
      [...ocupados, ...prohibidas],
      sujeto ? { x: sujeto.x, y: VINETA_H * 0.8 } : null
    );
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
