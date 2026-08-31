# 💥 Generador de Cómics con IA — MongoDB

Experiencia para eventos: el asistente se toma una foto, escribe su propia historia y la IA
genera **una página de cómic completa** donde él o ella es el protagonista, dibujado a mano
pero con su rostro reconocible.

Usa **Google Gemini 2.5 Flash Image** (Nano Banana) con la foto como referencia facial.

## ✨ Cómo funciona

Flujo de 4 pasos:

1. **Hombre o mujer** — lo elige la propia persona, y ese dato manda sobre lo que el modelo crea ver en la foto.
2. **Estilo de dibujo** — 8 estilos: superhéroe, manga, caricatura, acuarela, noir, retro 60s, chibi y 3D animado.
3. **Foto** — con la webcam (cuenta regresiva de 3 segundos) o subiendo un archivo.
4. **Historia** — el asistente escribe qué le pasa en el cómic (entre 20 y 1200 caracteres). Hay un botón "Dame una idea" con ejemplos.

El resultado es una página vertical (2400×3600) de 6 viñetas con globos de diálogo,
cartuchos de narración y onomatopeyas, más un **código QR** para que el asistente
descargue su cómic al celular.

## 🧩 Cómo se construye el cómic

El texto **no lo escribe el modelo de imagen**. Los modelos de imagen dibujan las letras
como formas y salen con faltas de ortografía ("PUETRA", "SUPERHÉRCE"). Por eso la
generación va en tres pasos:

1. **Guion y ficha del personaje** — `gemini-2.5-flash` recibe la historia, la foto **y el
   sexo que eligió la persona**, y devuelve un JSON con 6 escenas (acción visual, diálogo,
   narración y onomatopeya), el vestuario del protagonista y una **ficha física**: sexo, edad
   aproximada, cabello, tono de piel, lentes y si tiene o no barba. Esa ficha se le pasa al
   ilustrador en las 6 viñetas, y es lo que mantiene al personaje consistente.
   El sexo no se infiere de la foto: viene del paso 1 y se impone en la ficha y en cada viñeta.
2. **Dibujo** — se genera una imagen por viñeta con `gemini-2.5-flash-image` (3 en
   paralelo), cada una con la foto adjunta como referencia facial y con la instrucción
   explícita de **no dibujar una sola letra**.
3. **Armado** — [`comic.js`](comic.js) monta la retícula 2×3 con Sharp y rotula los
   globos con tipografía real. El texto queda perfecto siempre.

Para no taparle la cara al protagonista, cada globo se coloca midiendo la desviación
estándar de varias zonas candidatas de la viñeta: gana la más lisa (cielo, pared),
que es donde no hay ni caras ni detalle.

## 🛠️ Tecnologías

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js + Express
- **IA**: Google Generative AI (Gemini 2.5 Flash para el guion, Gemini 2.5 Flash Image para el dibujo)
- **Imagen**: Sharp (retícula, rotulación y composición de la página)
- **QR**: qrcode
- **Upload**: Multer

## 📋 Prerequisitos

- Node.js v18 o superior
- Una API Key de [Google AI Studio](https://aistudio.google.com/app/apikey)

## 🚀 Instalación

```bash
npm install
```

Copia la plantilla de variables de entorno y edítala:

```bash
cp .env.example .env
```

```env
GOOGLE_API_KEY=tu_api_key_aqui
PORT=3000
PUBLIC_URL=http://192.168.1.50:3000
```

Arranca el servidor:

```bash
npm start
```

Y abre `http://localhost:3000`.

### ⚠️ `PUBLIC_URL` es clave en eventos

El QR contiene la URL de descarga del cómic. Si `PUBLIC_URL` está vacía se usa el host de la
petición: si abres la app en `localhost`, el QR apuntará a `localhost` y **ningún celular podrá
descargar nada**. Configura la IP de la red local o el dominio público antes del evento.

### 📷 La cámara necesita contexto seguro

`getUserMedia` solo funciona en `localhost` o bajo HTTPS. Si vas a servir la app desde otra
máquina de la red, necesitas HTTPS o los navegadores bloquearán la cámara.

## 📁 Estructura del proyecto

```
Foto_Album/
├── public/
│   ├── index.html            # Wizard completo + estilos inline
│   ├── style.css             # Estilos y tipografía de marca
│   ├── app.js                # Cámara, historia, generación, QR
│   ├── fonts/                # Euclid Circular A, MongoDB Value Serif, Source Code Pro
│   └── img/mongodb/          # Logos oficiales (SVG)
├── scripts/
│   └── instalar-fuentes.mjs  # Instala las fuentes en Linux (postinstall)
├── downloads/                # Copia que sirve el QR (se conservan los últimos 30)
├── historias/                # Archivo permanente: una carpeta por cómic
├── uploads/                  # Fotos temporales, se borran tras procesarse
├── render.yaml               # Configuración de despliegue en Render
├── comic.js                  # Retícula, globos y rotulación de la página
├── server.js                 # Servidor Express + guion + API de Gemini
├── .env.example              # Plantilla de configuración
└── README.md
```

## 🗄️ Archivo de historias

Cada cómic generado se guarda de forma permanente en `historias/`, una carpeta por cómic:

```
historias/
├── index.jsonl                    # Una línea por cómic, lo más reciente al final
└── comic_1788195516052/
    ├── comic.png                  # La página completa
    ├── historia.txt               # Lo que escribió la persona, tal cual
    └── datos.json                 # Todo: fecha, sexo, estilo, guion de las 6 viñetas
```

A diferencia de `downloads/` —que solo conserva los últimos 30 para no llenar el disco—
en `historias/` **no se borra nada**.

`GET /api/historias` devuelve el índice completo en JSON, de lo más reciente a lo más antiguo.

La ubicación se controla con `STORAGE_DIR`. Si se deja vacía, se usa la raíz del proyecto.

## ☁️ Despliegue en Render

Hay tres cosas que **hay que** tener en cuenta:

**1. El disco es efímero.** Render borra el sistema de archivos en cada deploy y en cada
reinicio. Sin un disco persistente perderías todas las historias y los QR viejos dejarían de
funcionar. Monta un **Disk** y apunta `STORAGE_DIR` a su Mount Path:

| Variable | Valor |
|---|---|
| `GOOGLE_API_KEY` | tu API key |
| `STORAGE_DIR` | `/var/data` (el Mount Path del Disk) |

El archivo [`render.yaml`](render.yaml) ya deja esto configurado.

**2. Las fuentes.** Sharp rotula los globos con fuentes instaladas en el sistema, y en Linux no
existen `Comic Sans MS` ni `Arial Black`. Como las fuentes de marca **no están en el repo**
(ver la sección siguiente), en Render la rotulación cae a `DejaVu Sans` / `Liberation Sans`,
que vienen en cualquier distro: el texto se ve correcto, solo que con otra tipografía.

Si copias las fuentes de marca a `public/fonts/` antes de desplegar, el `postinstall` ejecuta
[`scripts/instalar-fuentes.mjs`](scripts/instalar-fuentes.mjs), que las instala en `~/.fonts` y
refresca fontconfig. Al arrancar, el servidor comprueba que haya fuentes utilizables:

```
   fuentes de rotulación: OK
```

Si sale `❌ FUENTES NO DISPONIBLES`, los globos saldrían vacíos.

**3. El plan free no sirve para un evento.** Duerme tras 15 minutos de inactividad y el primer
request tarda casi un minuto en responder; además no admite discos persistentes. Usa al menos
el plan Starter.

**El QR no necesita configuración en Render**: se usa `RENDER_EXTERNAL_URL`, que Render inyecta
automáticamente con la URL pública del servicio.

## 🔧 API Endpoints

### `GET /`
Sirve la aplicación.

### `GET /api/health`
```json
{ "status": "OK", "message": "Generador de Cómics API está funcionando", "hasApiKey": true }
```

### `POST /api/generate`
Genera la página de cómic.

**Body (multipart/form-data)**:

| Campo      | Tipo    | Descripción                                              |
|------------|---------|----------------------------------------------------------|
| `image`    | archivo | Foto del protagonista (JPG, PNG o WEBP, máx. 5MB)        |
| `sexo`     | texto   | `hombre` o `mujer` (cualquier otro valor cae a `hombre`)  |
| `historia` | texto   | La historia, entre 20 y 1200 caracteres                   |
| `estilo`   | texto   | `americano`, `manga`, `caricatura`, `acuarela`, `noir`, `retro`, `chibi` o `pixar` |

**Response**:
```json
{
  "success": true,
  "image": "data:image/png;base64,...",
  "downloadUrl": "http://.../downloads/comic_1788190801382.png",
  "qrCode": "data:image/png;base64,...",
  "message": "Cómic generado exitosamente"
}
```

### `GET /api/historias`
Índice del archivo de historias, de la más reciente a la más antigua.
```json
{ "total": 12, "historias": [{ "id": "comic_...", "fecha": "...", "sexo": "hombre", "estilo": "noir", "historia": "..." }] }
```

### `GET /downloads/:filename`
Sirve el cómic generado (es la URL que va dentro del QR).

### `GET /download/:filename`
Igual, pero fuerza la descarga. El nombre se valida contra `comic_<timestamp>.png`.

## 🎨 Personalizar

- **Estilos de dibujo**: se definen en dos lugares que deben coincidir — el objeto `ESTILOS` en [`server.js`](server.js) (la descripción que recibe el modelo) y `ESTILOS_COMIC` en [`public/index.html`](public/index.html) (la tarjeta visual). Los `id` deben ser idénticos.
- **El guion y la ficha del personaje**: función `escribirGuion()` en [`server.js`](server.js) — reglas de diálogo, narración, onomatopeyas y descripción física.
- **El dibujo de cada viñeta**: función `promptVineta()` en [`server.js`](server.js) — referencia facial, vestuario y prohibición de texto.
- **Los globos**: [`comic.js`](comic.js) — tamaños, colores, fuentes y colocación.
- **Ejemplos de historia**: array `EJEMPLOS_HISTORIA` en [`public/app.js`](public/app.js).
- **Retención de archivos**: `cleanOldFiles()` en [`server.js`](server.js) conserva los últimos 30 cómics.

## 💰 Costos de la API

- ~$0.039 USD por viñeta × 6 viñetas = **~$0.24 USD por cómic**, más una llamada de
  texto para el guion (fracciones de centavo).
- Un cómic completo tarda entre 25 y 40 segundos.
- Para abaratarlo, baja el número de viñetas cambiando `COLUMNAS`/`FILAS` en
  [`comic.js`](comic.js): la retícula, el guion y el armado se ajustan solos.

## 🐛 Solución de problemas

**El QR no funciona al escanearlo** — falta configurar `PUBLIC_URL`. Ver arriba.

**Los globos salen sin texto o con una fuente rara** — revisa el log de arranque: debe decir
`fuentes de rotulación: OK`. Si no, ejecuta `npm run fuentes`. En Linux las instala el
`postinstall`; en Windows se usan las del sistema.

**Las historias desaparecieron tras un deploy en Render** — falta el disco persistente. Ver la
sección de despliegue: monta un Disk y define `STORAGE_DIR`.

**El protagonista cambia de cara entre viñetas** — cada viñeta es una llamada independiente,
así que hay algo de variación. La ficha del personaje (ver arriba) la reduce mucho. Ayuda
que la foto sea de frente, con buena luz y sin nadie más en el encuadre.

**Dibuja a una mujer como hombre, o le inventa barba** — el sexo lo elige la persona en el
paso 1, se fuerza al inicio de la ficha y el prompt de cada viñeta prohíbe explícitamente
añadir barba o rasgos masculinos a una mujer. Puedes auditarlo en la consola: la línea
`Personaje: ...` debe empezar con el sexo elegido.

**Un globo tapa algo importante** — la colocación busca la zona más lisa de la viñeta, pero
es una heurística. Vuelve a generar y saldrá distinto.

**"No se pudo generar el cómic"** — la API no devolvió imagen, normalmente porque el filtro de
seguridad de Google bloqueó la historia. Pide al asistente que la reformule.

**Error de cámara** — revisa que estés en `localhost` o HTTPS, que ninguna otra app (Zoom, Meet)
tenga la cámara tomada y que el navegador tenga el permiso concedido.

**Puerto en uso** — cambia `PORT` en el `.env`.

## 🔐 Notas de seguridad

- El endpoint `/api/generate` **no tiene autenticación ni rate limit**: quien alcance el servidor
  consume tu cuota de Gemini. En un evento cerrado no es problema; si lo expones a internet,
  añade un rate limit por IP.
- `cors()` está abierto a cualquier origen.
- Las fotos subidas se borran del disco en cuanto se procesan.
- `multer` está en la versión 1.x, que ya no recibe mantenimiento. Conviene migrar a 2.x.

## 🔤 Fuentes (no están en el repo)

Este repositorio es público, así que **las fuentes de marca no se versionan**: Euclid Circular A
es una fuente comercial con licencia y MongoDB Value Serif es propietaria. Publicarlas aquí
sería redistribuirlas.

La app funciona sin ellas —la interfaz cae a la tipografía del sistema y los globos a
`DejaVu Sans`—, pero para que se vea con la tipografía correcta hay que añadirlas a mano:

1. Copia estos archivos a `public/fonts/`:
   ```
   EuclidCircularA-Regular.ttf
   EuclidCircularA-Medium.ttf
   EuclidCircularA-RegularItalic.ttf
   EuclidCircularA-MediumItalic.ttf
   MongoDBValueSerif-Regular.ttf
   SourceCodePro-SemiBold.ttf
   ```
2. Instálalas para la rotulación:
   ```bash
   npm run fuentes
   ```

En Render, como el repo no las trae, tienes dos caminos: usar un repositorio privado que sí las
incluya, o dejarlas en el disco persistente y copiarlas a `public/fonts/` en el `buildCommand`.

## 🎨 Marca

Tipografías y logos oficiales de MongoDB, en `public/fonts/` y `public/img/mongodb/`.
Paleta: Spring Green `#00ED64`, Forest Green `#00684A`, Evergreen `#023430`, Slate Blue `#001E2B`.

## 📝 Notas adicionales

- Las imágenes generadas incluyen una marca de agua SynthID invisible de Google.
- `downloads/` conserva solo los últimos 30 cómics; los anteriores se borran y sus QR dejan de
  funcionar. La copia de `historias/` nunca se borra.
