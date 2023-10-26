/**
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 */


const os = require("os");

/**
 * @typedef {Object} Platform
 * @property {'osx' | 'linux' | 'windows' | 'unknown'} name - El nombre del sistema operativo.
 * @property {string} version - La versión del sistema operativo.
 * @property {'x86' | 'x64' | string} arch - La arquitectura del sistema.
 */

/**
 * Obtiene la información de la plataforma del sistema actual.
 * @returns {Platform} - La información de la plataforma.
 */
function getPlatform() {
  const architecture = os.arch();
  const version = os.release();

  switch (os.platform()) {
    case 'darwin':
      return { name: 'osx', version, arch: architecture };
    case 'linux':
      return { name: 'linux', version, arch: architecture };
    case 'win32':
      return { name: 'windows', version, arch: architecture };
    default:
      return { name: 'unknown', version, arch: architecture };
  }
}

module.exports = getPlatform;
