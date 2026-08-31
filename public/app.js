// Elementos DOM
const cameraBtn = document.getElementById('cameraBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraVideo = document.getElementById('cameraVideo');
const captureBtn = document.getElementById('captureBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const previewContainer = document.getElementById('previewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeBtn = document.getElementById('removeBtn');
const generateBtn = document.getElementById('generateBtn');
const resultSection = document.getElementById('resultSection');
const resultImage = document.getElementById('resultImage');
const loadingOverlay = document.getElementById('loadingOverlay');
const downloadBtn = document.getElementById('downloadBtn');
const newBtn = document.getElementById('newBtn');
const toast = document.getElementById('toast');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const countdownEl = document.getElementById('countdown');
const storyCard = document.getElementById('storyCard');
const storyInput = document.getElementById('storyInput');
const storyCounter = document.getElementById('storyCounter');
const storyExampleBtn = document.getElementById('storyExampleBtn');
const loadingMsg = document.getElementById('loadingMsg');

const HISTORIA_MIN = 20;
const HISTORIA_MAX = 1200;

const EJEMPLOS_HISTORIA = [
    'Llego tarde a la oficina y descubro que mi café tiene superpoderes. Vuelo por la ciudad, salvo a un gato atrapado en un árbol y aterrizo justo a tiempo para la junta, con el café todavía caliente.',
    'Encuentro una puerta secreta en la sala de juntas. Del otro lado hay una selva llena de dinosaurios que hablan y me piden ayuda para organizar su base de datos.',
    'Mi laptop cobra vida y me reta a un duelo de código a medianoche. Peleamos entre servidores gigantes hasta que le gano con una sola línea y nos hacemos amigos.',
    'Una tormenta me deja atrapado en la azotea de la oficina. Construyo un dron con clips y cables, sobrevuelo la ciudad de noche y descubro que soy el único que sigue despierto.'
];

// El cómic tarda ~30s: se van rotando mensajes para que la espera se entienda.
const PASOS_CARGA = [
    'Leyendo tu historia...',
    'Escribiendo el guion de las viñetas...',
    'Dibujando la primera viñeta...',
    'Dibujando más viñetas...',
    'Dando color y detalle...',
    'Armando la página y rotulando los globos...',
    'Ya casi está...'
];

let cameraStream = null;
let temporizadorCarga = null;

// Event Listeners
generateBtn.addEventListener('click', generateImage);
downloadBtn.addEventListener('click', downloadImage);
newBtn.addEventListener('click', () => reiniciarProceso());
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);
cameraBtn.addEventListener('click', openCamera);
captureBtn.addEventListener('click', startCountdown);
closeCameraBtn.addEventListener('click', closeCamera);

storyInput.addEventListener('input', () => {
    storyCounter.textContent = `${storyInput.value.length} / ${HISTORIA_MAX}`;
    checkFormValid();
});

storyExampleBtn.addEventListener('click', () => {
    const ejemplo = EJEMPLOS_HISTORIA[Math.floor(Math.random() * EJEMPLOS_HISTORIA.length)];
    storyInput.value = ejemplo;
    storyInput.dispatchEvent(new Event('input'));
    storyInput.focus();
});

removeBtn.addEventListener('click', () => {
    imagePreview.src = '';
    previewContainer.style.display = 'none';
    storyCard.style.display = 'none';
    checkFormValid();
});

// Funciones
function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

function tieneFoto() {
    return !!imagePreview.src && imagePreview.src.startsWith('data:image');
}

// El botón solo se habilita con foto Y una historia de longitud suficiente
function checkFormValid() {
    const historia = storyInput.value.trim();
    generateBtn.disabled = !(tieneFoto() && historia.length >= HISTORIA_MIN);
}

// Cuando ya hay foto, se revela el paso de la historia
function mostrarPasoHistoria() {
    previewContainer.style.display = 'block';
    storyCard.style.display = 'block';
    checkFormValid();
    storyInput.focus();
}

// Manejar subida de archivo desde galería
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        imagePreview.src = ev.target.result;
        mostrarPasoHistoria();
    };
    reader.readAsDataURL(file);
}

// Iniciar cuenta regresiva
function startCountdown() {
    let count = 3;
    countdownEl.style.display = 'block';
    countdownEl.textContent = count;

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.textContent = count;
        } else {
            clearInterval(timer);
            countdownEl.style.display = 'none';
            captureImage();
        }
    }, 1000);
}

function captureImage() {
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    imagePreview.src = canvas.toDataURL('image/png');

    cameraModal.style.display = 'none';
    detenerCamara();
    mostrarPasoHistoria();
}

// Generar el cómic con la foto capturada y la historia escrita
async function generateImage() {
    if (!tieneFoto()) {
        showToast('La foto es requerida', 'error');
        return;
    }

    const historia = storyInput.value.trim();
    if (historia.length < HISTORIA_MIN) {
        showToast(`Escribe un poco más tu historia (mínimo ${HISTORIA_MIN} caracteres)`, 'error');
        storyInput.focus();
        return;
    }

    loadingOverlay.style.display = 'flex';
    generateBtn.disabled = true;
    iniciarMensajesCarga();

    try {
        const formData = new FormData();
        formData.append('image', dataURLtoFile(imagePreview.src, 'captured.png'));
        formData.append('sexo', window.sexoSeleccionado || 'hombre');
        formData.append('historia', historia);
        formData.append('estilo', window.estiloSeleccionado || 'americano');

        const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al generar el cómic');
        }

        resultImage.src = data.image;
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('¡Tu cómic está listo! 🎉', 'success');

        lanzarConfeti();

        if (data.qrCode) {
            showQRCode(data.qrCode);
        }
    } catch (error) {
        console.error('Error:', error);
        showToast(error.message || 'Error al generar el cómic', 'error');
    } finally {
        detenerMensajesCarga();
        loadingOverlay.style.display = 'none';
        checkFormValid();
    }
}

function iniciarMensajesCarga() {
    let paso = 0;
    loadingMsg.textContent = PASOS_CARGA[0];
    temporizadorCarga = setInterval(() => {
        paso = Math.min(paso + 1, PASOS_CARGA.length - 1);
        loadingMsg.textContent = PASOS_CARGA[paso];
    }, 5000);
}

function detenerMensajesCarga() {
    clearInterval(temporizadorCarga);
    temporizadorCarga = null;
}

function lanzarConfeti() {
    if (!window.confetti) return;

    const scalar = 3;
    const globo = confetti.shapeFromText({ text: '💥', scalar });

    window.confetti({
        particleCount: 25,
        spread: 100,
        origin: { y: 0.6 },
        shapes: [globo],
        scalar: scalar,
        gravity: 0.7,
        ticks: 300
    });

    window.confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#00ED64', '#FFFFFF', '#001E2B'],
        shapes: ['circle'],
        gravity: 0.6
    });
}

function downloadImage() {
    const fecha = new Date();
    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const anio = fecha.getFullYear();
    const hora = String(fecha.getHours()).padStart(2, '0');
    const minuto = String(fecha.getMinutes()).padStart(2, '0');
    const segundo = String(fecha.getSeconds()).padStart(2, '0');
    const nombreArchivo = `Comic_${dia}-${mes}-${anio}_${hora}-${minuto}-${segundo}.png`;

    const link = document.createElement('a');
    link.href = resultImage.src;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Cómic descargado', 'success');
}

function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Abrir la cámara
async function openCamera() {
    cameraModal.style.display = 'block';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tu navegador no permite acceso a la cámara. Asegúrate de usar HTTPS o localhost.');
        cameraModal.style.display = 'none';
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        cameraVideo.srcObject = cameraStream;
    } catch (err) {
        console.error('Error de cámara:', err);

        let msg = 'No se pudo acceder a la cámara.';
        if (err.name === 'NotFoundError' || (err.message || '').includes('not found')) {
            msg = 'No se detectó ninguna cámara conectada. Si estás en PC, conecta una webcam.';
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            msg = 'Permiso denegado. Debes permitir el acceso a la cámara en la barra de dirección.';
        } else if (err.name === 'NotReadableError') {
            msg = 'La cámara está siendo usada por otra aplicación (Zoom, Meet, etc).';
        }

        alert(`${msg}\n\nDetalle técnico: ${err.message || err.name}`);
        cameraModal.style.display = 'none';
    }
}

function detenerCamara() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

function closeCamera() {
    cameraModal.style.display = 'none';
    detenerCamara();
}

// Verificar salud de la API al cargar
async function checkApiHealth() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();

        if (!data.hasApiKey) {
            showToast('⚠️ Configura tu GOOGLE_API_KEY en el archivo .env', 'error');
        }
    } catch (error) {
        console.error('Error al verificar la API:', error);
    }
}

// Mostrar QR de descarga
function showQRCode(qrCodeDataUrl) {
    const qrContainer = document.getElementById('qr-container');
    if (!qrContainer) return;

    qrContainer.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = 'Escanea para descargar';
    title.style.color = '#ffffff';
    title.style.fontSize = '1.1rem';
    title.style.marginBottom = '10px';
    title.style.textShadow = '0 2px 4px rgba(0,0,0,0.5)';
    qrContainer.appendChild(title);

    const qrImg = document.createElement('img');
    qrImg.src = qrCodeDataUrl;
    qrImg.alt = 'Código QR de descarga';
    qrImg.style.width = '150px';
    qrImg.style.height = '150px';
    qrImg.style.border = '2px solid #ddd';
    qrImg.style.borderRadius = '10px';
    qrContainer.appendChild(qrImg);
}

// Ejecutar al cargar la página
checkApiHealth();
