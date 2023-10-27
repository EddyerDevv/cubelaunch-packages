/**
 * El paquete principal para iniciar Minecraft.
 * Proporciona la función {@link Version.parse} para analizar la versión de Minecraft,
 * y la función {@link launch} para iniciar el juego.
 *
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 * @packageDocumentation
 * @module cubelaunch-core
 */

module.exports = {
  ...require('./files/platform'),
  ...require('./files/folder'),
  ...require('./files/diagnose'),
  ...require('./files/version'),
  checksum: require('./files/utils').checksum,
  // ...require('./launch'),
};