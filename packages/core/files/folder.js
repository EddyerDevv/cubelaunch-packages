/**
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 */


const { join } = require('path');

class MinecraftFolder {
  constructor(root) {
    this.root = root;
  }

  static from(location) {
    return typeof location === 'string'
      ? new MinecraftFolder(location)
      : location instanceof MinecraftFolder
        ? location
        : new MinecraftFolder(location.root);
  }

  get mods() { return join(this.root, 'mods'); }
  get resourcepacks() { return join(this.root, 'resourcepacks'); }
  get assets() { return join(this.root, 'assets'); }
  get libraries() { return join(this.root, 'libraries'); }
  get versions() { return this.getPath('versions'); }
  get logs() { return this.getPath('logs'); }
  get options() { return this.getPath('options.txt'); }
  get launcherProfile() { return this.getPath('launcher_profiles.json'); }
  get lastestLog() { return this.getPath('logs', 'latest.log'); }
  get maps() { return this.getPath('saves'); }
  get saves() { return this.getPath('saves'); }
  get screenshots() { return this.getPath('screenshots'); }

  getNativesRoot(version) { return join(this.getVersionRoot(version), version + '-natives'); }
  getVersionRoot(version) { return join(this.versions, version); }
  getVersionJson(version) { return join(this.getVersionRoot(version), version + '.json'); }
  getVersionJar(version, type) {
    return type === 'client' || type === undefined
      ? join(this.getVersionRoot(version), version + '.jar')
      : join(this.getVersionRoot(version), `${version}-${type}.jar`);
  }
  getVersionAll(version) {
    return [
      join(this.versions, version),
      join(this.versions, version, version + '.json'),
      join(this.versions, version, version + '.jar'),
    ];
  }

  getResourcePack(fileName) { return join(this.resourcepacks, fileName); }
  getMod(fileName) { return join(this.mods, fileName); }
  getLog(fileName) { return join(this.logs, fileName); }
  getMapInfo(map) { return join(this.getPath('saves', map, 'level.dat')); }
  getMapIcon(map) { return join(this.getPath('saves', map, 'icon.png')); }
  getLibraryByPath(libraryPath) { return join(this.libraries, libraryPath); }

  getAssetsIndex(versionAssets) { return join(this.getPath('assets', 'indexes', versionAssets + '.json')); }
  getAsset(hash) { return join(this.getPath('assets', 'objects', hash.substring(0, 2), hash)); }
  getLogConfig(file) { return join(this.getPath('assets', 'log_configs', file)); }
  getPath(...path) { return join(this.root, ...path); }
}

const MinecraftPath = {
  mods: 'mods',
  resourcepacks: 'resourcepacks',
  assets: 'assets',
  libraries: 'libraries',
  versions: 'versions',
  logs: 'logs',
  options: 'options.txt',
  launcherProfile: 'launcher_profiles.json',
  lastestLog: 'logs/latest.log',
  maps: 'saves',
  saves: 'saves',
  screenshots: 'screenshots',
  getVersionRoot: function (version) { return join('versions', version); },
  getNativesRoot: function (version) { return join('versions', version, version + '-natives'); },
  getVersionJson: function (version) { return join('versions', version, version + '.json'); },
  getVersionJar: function (version, type) {
    return type === 'client' || type === undefined
      ? join('versions', version, version + '.jar')
      : join('versions', version, `${version}-${type}.jar`);
  },
  getResourcePack: function (fileName) { return join('resourcepacks', fileName); },
  getMod: function (fileName) { return join('mods', fileName); },
  getLog: function (fileName) { return join('logs', fileName); },
  getMapInfo: function (map) { return join('saves', map, 'level.dat'); },
  getMapIcon: function (map) { return join('saves', map, 'icon.png'); },
  getLibraryByPath: function (libraryPath) { return join('libraries', libraryPath); },
  getAssetsIndex: function (versionAssets) { return join('assets', 'indexes', versionAssets + '.json'); },
  getAsset: function (hash) { return join('assets', 'objects', hash.substring(0, 2), hash); },
};

const MinecraftLocation = { MinecraftFolder, MinecraftPath };

module.exports = MinecraftLocation;
