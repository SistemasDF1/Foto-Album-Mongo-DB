// Almacenamiento de los cómics en MongoDB.
//
// Por qué no basta con el disco: en Render el sistema de archivos del contenedor
// se borra en cada reinicio y en cada deploy. Los cómics desaparecían a los pocos
// segundos y el QR que ya se había entregado quedaba apuntando a un 404.
// Guardándolos en la base de datos sobreviven pase lo que pase.
//
// Si no hay MONGODB_URI configurada, el módulo queda inactivo y el servidor sigue
// funcionando con el disco (suficiente para desarrollo local).

import { MongoClient, Binary } from 'mongodb';

const URI = process.env.MONGODB_URI || '';
const NOMBRE_BD = process.env.MONGODB_DB || 'comics';
const NOMBRE_COLECCION = 'comics';

let cliente = null;
let coleccion = null;
let conectando = null;

export const hayMongo = !!URI;

async function conectar() {
  if (coleccion) return coleccion;
  if (!URI) return null;

  // Una sola conexión compartida, aunque varias peticiones lleguen a la vez
  if (!conectando) {
    conectando = (async () => {
      cliente = new MongoClient(URI, {
        serverSelectionTimeoutMS: 8000,
        retryWrites: true
      });
      await cliente.connect();

      const col = cliente.db(NOMBRE_BD).collection(NOMBRE_COLECCION);
      // Para listar por fecha sin recorrer toda la colección
      await col.createIndex({ fecha: -1 }).catch(() => {});
      coleccion = col;
      return col;
    })();
  }

  return conectando;
}

// Comprueba la conexión al arrancar, para avisar antes del evento y no durante.
export async function probarConexion() {
  if (!URI) return { ok: false, motivo: 'MONGODB_URI no configurada' };
  try {
    const col = await conectar();
    const total = await col.countDocuments();
    return { ok: true, total };
  } catch (error) {
    return { ok: false, motivo: error.message };
  }
}

// Guarda el cómic y todos sus datos. La imagen va como binario en el propio
// documento: ~1 MB por cómic, muy por debajo del límite de 16 MB de MongoDB.
export async function guardarComic({ id, sexo, estilo, historia, apariencia, personaje, escenas, imagen }) {
  const col = await conectar();
  if (!col) return null;

  const documento = {
    _id: id,
    fecha: new Date(),
    sexo,
    estilo,
    historia,
    personaje: { apariencia, vestuario: personaje },
    escenas,
    imagen: new Binary(imagen),
    tipo: 'image/jpeg',
    bytes: imagen.length
  };

  await col.insertOne(documento);
  return id;
}

// Devuelve solo la imagen: es lo que sirve la página del QR.
export async function obtenerImagen(id) {
  const col = await conectar();
  if (!col) return null;

  const doc = await col.findOne({ _id: id }, { projection: { imagen: 1, tipo: 1 } });
  if (!doc || !doc.imagen) return null;

  return { buffer: doc.imagen.buffer ? Buffer.from(doc.imagen.buffer) : Buffer.from(doc.imagen), tipo: doc.tipo || 'image/jpeg' };
}

// Listado para el archivo de historias, sin traerse las imágenes.
export async function listarComics(limite = 200) {
  const col = await conectar();
  if (!col) return [];

  return col
    .find({}, { projection: { imagen: 0, escenas: 0 } })
    .sort({ fecha: -1 })
    .limit(limite)
    .toArray();
}

export async function contarComics() {
  const col = await conectar();
  if (!col) return 0;
  return col.countDocuments();
}

export async function cerrar() {
  if (cliente) await cliente.close();
}
