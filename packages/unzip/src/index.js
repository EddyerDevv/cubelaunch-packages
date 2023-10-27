/* @Dependencias */
const { fromBuffer, fromFd, open: yopen } = require('yauzl');

/* @Exportacion */
module.exports = {
  open,
  openEntryReadStream,
  readAllEntries,
  getEntriesRecord,
  walkEntries,
  filterEntries,
  walkEntriesGenerator,
  readEntry
};

/**
 * Abre un archivo zip y retorna un objeto ZipFile.
 * @param {string|Buffer|number} target - Ruta del archivo, datos en buffer o descriptor de archivo.
 * @param {Object} options - Opciones para la apertura del archivo zip.
 * @param {boolean} options.lazyEntries - Indica si las entradas deben cargarse de manera perezosa (por defecto: true).
 * @param {boolean} options.autoClose - Indica si se debe cerrar automáticamente el archivo después de leerlo (por defecto: false).
 * @returns {Promise<ZipFile>} - Una promesa que se resuelve con el objeto ZipFile.
 */
async function open(target, options = { lazyEntries: true, autoClose: false }) {
  return new Promise((resolve, reject) => {
    function handleZip(err, zipfile) {
      if (err || !zipfile) {
        reject(err || new Error('¡No se puede abrir el zip!'));
      } else {
        resolve(zipfile);
      }
    }

    try {
      if (typeof target === 'string') {
        yopen(target, options, handleZip);
      } else if (Buffer.isBuffer(target)) {
        fromBuffer(target, options, handleZip);
      } else {
        fromFd(target, options, handleZip);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Abre un flujo de lectura para una entrada en el archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @param {Entry} entry - Entrada del archivo zip.
 * @param {ZipFileOptions} options - Opciones para abrir el flujo de lectura (opcional).
 * @returns {Promise<Readable>} - Una promesa que se resuelve con un flujo de lectura.
 */
function openEntryReadStream(zip, entry, options) {
  return new Promise((resolve, reject) => {
    function handleStream(err, stream) {
      if (err || !stream) {
        reject(err);
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
}

/**
 * Lee el contenido de una entrada en el archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @param {Entry} entry - Entrada del archivo zip.
 * @param {ZipFileOptions} options - Opciones para la lectura (opcional).
 * @returns {Promise<Buffer>} - Una promesa que se resuelve con el contenido de la entrada como un Buffer.
 */
async function readEntry(zip, entry, options) {
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
}

/**
 * Generador asíncrono para recorrer las entradas de un archivo zip.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @yields {Entry} - Una entrada del archivo zip.
 * @throws {any} - Error si ocurre algún problema.
 * @returns {AsyncGenerator<Entry, void, boolean | undefined>} - Un generador asíncrono.
 */
async function* walkEntriesGenerator(zip) {
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

  try {
    while (!ended) {
      if (zip.lazyEntries) {
        zip.readEntry();
      }
      await wait;

      if (error) {
        throw error;
      }

      while (entries.length > 0 && !ended) {
        ended = !!(yield entries.pop());
      }

      wait = new Promise((resolve) => {
        resume = resolve;
      });
    }
  } finally {
    zip.removeListener('entry', onEntry)
      .removeListener('end', onEnd)
      .removeListener('error', onError);
  }
}

/**
 * Filtra las entradas del archivo zip según los criterios proporcionados.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @param {Array<string | ((entry: Entry) => boolean)>} entries - Lista de nombres de archivo o funciones de filtro.
 * @returns {Promise<(Entry | undefined)[]>} - Una promesa que resuelve a un array de entradas o indefinidos.
 */
async function filterEntries(zip, entries) {
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
}

/**
 * Recorre las entradas del archivo zip y aplica una función de manipulación a cada una.
 * @param {ZipFile} zip - Objeto ZipFile.
 * @param {(entry: Entry) => Promise<boolean> | boolean | void} entryHandler - Función de manipulación de entradas.
 * @returns {Promise<void>} - Una promesa que se resuelve una vez completado el recorrido.
 */
async function walkEntries(zip, entryHandler) {
  const itr = walkEntriesGenerator(zip);

  for await (const entry of itr) {
    const result = await entryHandler(entry);

    if (result) {
      break;
    }
  }
}

/**
 * Crea un registro de entradas a partir de una lista de entradas.
 * @param {Entry[]} entries - Lista de entradas del archivo zip.
 * @returns {Record<string, Entry>} - Un registro de entradas con los nombres de archivo como claves.
 */
function getEntriesRecord(entries) {
  const record = {};

  for (const entry of entries) {
    record[entry.fileName] = entry;
  }

  return record;
}

/**
 * Lee todas las entradas del archivo zip y las devuelve como una lista.
 * @param {ZipFile} zipFile - Objeto ZipFile.
 * @returns {Promise<Entry[]>} - Una promesa que resuelve a una lista de entradas.
 */
async function readAllEntries(zipFile) {
  const entries = [];

  for await (const entry of walkEntriesGenerator(zipFile)) {
    entries.push(entry);
  }

  return entries;
}
