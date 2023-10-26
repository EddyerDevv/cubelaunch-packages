/**
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 */

const yauzl = require('yauzl');
const { fromBuffer, fromFd, open: yopen } = yauzl;

/**
 * Abre un archivo zip desde diferentes fuentes.
 * @param {string | Buffer | number} target - Ruta del archivo, Buffer o descriptor de archivo.
 * @param {Object} options - Opciones para abrir el archivo zip.
 * @param {boolean} options.lazyEntries - Indica si las entradas se deben cargar de manera perezosa.
 * @param {boolean} options.autoClose - Indica si el archivo se debe cerrar automáticamente después de abrirlo.
 * @returns {Promise<ZipFile>} - Una promesa que resuelve a un objeto ZipFile.
 * @throws {Error} - Si no se puede abrir el archivo zip.
 */
export async function open(target, options = { lazyEntries: true, autoClose: false }) {
  return new Promise((resolve, reject) => {
    function handleZip(err, zipfile) {
      if (err || !zipfile) {
        reject(err || new Error('¡No se puede abrir el zip!'));
      } else {
        resolve(zipfile);
      }
    }

    if (typeof target === 'string') {
      yopen(target, options, handleZip);
    } else if (Buffer.isBuffer(target)) {
      fromBuffer(target, options, handleZip);
    } else if (typeof target === 'number') {
      fromFd(target, options, handleZip);
    } else {
      reject(new Error('Tipo de objetivo no válido. Debe ser una cadena, un Buffer o un descriptor de archivo.'));
    }
  });
};

/**
 * Abre un stream de lectura para una entrada en un archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @param {Entry} entry - Entrada a la que se abrirá el stream de lectura.
 * @param {ZipFileOptions} options - Opciones para abrir el stream de lectura (opcional).
 * @returns {Promise<Readable>} - Una promesa que resuelve a un objeto Readable.
 * @throws {Error} - Si no se puede abrir el stream de lectura.
 */
export function openEntryReadStream(zip, entry, options) {
  return new Promise((resolve, reject) => {
    function handleStream(err, stream) {
      if (err || !stream) {
        reject(err || new Error('¡No se puede abrir el stream de lectura!'));
      } else {
        resolve(stream);
      }
    }

    if (options) {
      zip.openReadStream(entry, options, handleStream);
    } else {
      zip.openReadStream(entry, handleStream);
    }
  });
};

/**
 * Lee el contenido de una entrada en un archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @param {Entry} entry - Entrada que se va a leer.
 * @param {ZipFileOptions} options - Opciones para abrir el stream de lectura (opcional).
 * @returns {Promise<Buffer>} - Una promesa que resuelve a un Buffer con el contenido de la entrada.
 * @throws {Error} - Si no se puede leer la entrada.
 */
export async function readEntry(zip, entry, options) {
  const stream = await openEntryReadStream(zip, entry, options);
  const buffers = [];

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffers.push(chunk);
    });

    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return Buffer.concat(buffers);
};

/**
 * Generador asíncrono para iterar sobre las entradas de un archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile que se va a recorrer.
 * @returns {Object} - Un objeto que actúa como generador de entradas.
 */
export function walkEntriesGenerator(zip) {
  let ended = false;
  let error;
  let resume = () => { };
  let wait = new Promise((resolve) => {
    resume = resolve;
  });

  const entries = [];

  function onEntry(entry) {
    entries.push(entry);
    resume();
  }

  function onEnd() {
    ended = true;
    resume();
  }

  function onError(e) {
    error = e;
    resume();
  }

  zip.addListener('entry', onEntry)
    .addListener('end', onEnd)
    .addListener('error', onError);

  return {
    async next() {
      while (!ended) {
        if (zip.lazyEntries) {
          zip.readEntry();
        }
        await wait;
        if (error) {
          throw error;
        }
        while (entries.length > 0 && !ended) {
          ended = yield entries.pop();
        }
        wait = new Promise((resolve) => {
          resume = resolve;
        });
      }
      return { done: true, value: undefined };
    },
    async return(value) {
      ended = true;
      zip.removeListener('entry', onEntry)
        .removeListener('end', onEnd)
        .removeListener('error', onError);
      return { done: true, value };
    },
    async throw(e) {
      ended = true;
      error = e;
      zip.removeListener('entry', onEntry)
        .removeListener('end', onEnd)
        .removeListener('error', onError);
      return { done: true, value: undefined };
    }
  };
};

/**
 * Filtra las entradas de un archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile que se va a filtrar.
 * @param {Array<string | ((entry: yauzl.Entry) => boolean)>} entries - Lista de nombres de archivo o funciones de filtrado.
 * @returns {Promise<(Entry | undefined)[]>} - Una promesa que resuelve a una lista de entradas filtradas.
 */
export async function filterEntries(zip, entries) {
  const bags = entries.map(e => [e, undefined]);

  let remaining = entries.length;

  for await (const entry of walkEntriesGenerator(zip)) {
    for (const bag of bags) {
      if (typeof bag[0] === 'string') {
        if (bag[0] === entry.fileName) {
          bag[1] = entry;
          remaining -= 1;
        }
      } else {
        if (bag[0](entry)) {
          bag[1] = entry;
          remaining -= 1;
        }
      }
      if (remaining === 0) break;
    }
  }

  return bags.map(b => b[1]);
};

/**
 * Itera sobre las entradas de un archivo zip y aplica una función de manejo a cada entrada.
 * @param {ZipFile} zip - Objeto ZipFile que se va a recorrer.
 * @param {Function} entryHandler - Función de manejo que se aplicará a cada entrada.
 * @param {boolean} lazyEntries - Indica si las entradas se deben cargar de manera perezosa.
 * @returns {Promise<void>} - Una promesa que se resuelve cuando se completa el recorrido de las entradas.
 */
export async function walkEntries(zip, entryHandler, lazyEntries = true) {
  const itr = walkEntriesGenerator(zip, lazyEntries);

  for await (const entry of itr) {
    await entryHandler(entry);
  }
};

/**
 * Crea un registro de entradas a partir de una lista de entradas.
 * @param {Entry[]} entries - Lista de entradas.
 * @returns {Record<string, Entry>} - Un registro donde las claves son los nombres de archivo y los valores son las entradas correspondientes.
 */
export function getEntriesRecord(entries) {
  const record = {};

  for (const entry of entries) {
    record[entry.fileName] = entry;
  }

  return record;
};

/**
 * Lee todas las entradas de un archivo zip.
 * @param {ZipFile} zipFile - Objeto ZipFile.
 * @returns {Promise<Entry[]>} - Una promesa que resuelve a una lista de entradas.
 */
export async function readAllEntries(zipFile) {
  const entries = [];

  for await (const entry of walkEntriesGenerator(zipFile)) {
    entries.push(entry);
  }

  return entries;
};
