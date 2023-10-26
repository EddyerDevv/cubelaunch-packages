/**
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 */


const { constants, createReadStream } = require('fs');
const { createHash } = require('crypto');
const { pipeline } = require('stream/promises');
const { access } = require('fs/promises');

function exists(file) {
  return access(file, constants.F_OK).then(() => true, () => false);
}

async function validateSha1(target, hash, strict = false) {
  if (await access(target).then(() => false, () => true)) {
    return false;
  }
  if (!hash) {
    return !strict;
  }
  const sha1 = await checksum(target, 'sha1');
  return sha1 === hash;
}

async function checksum(target, algorithm) {
  const hash = createHash(algorithm).setEncoding('hex');
  await pipeline(createReadStream(target), hash);
  return hash.read();
}

function isNotNull(v) {
  return v !== undefined;
}

module.exports = {
  exists,
  validateSha1,
  checksum,
  isNotNull,
};