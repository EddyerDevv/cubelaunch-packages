/**
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 */

const { MinecraftFolder } = require('./folder');
const { getPlatform } = require('./platform');
const { extname } = require('path');
const { readFile } = require('fs/promises');

function resolveFromPath(path) {
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  const version = parts[parts.length - 2];
  const artifactId = parts[parts.length - 3];
  const groupId = parts.slice(0, parts.length - 3).join('.');

  const filePrefix = `${artifactId}-${version}`;
  const ext = extname(file);
  const type = ext.substring(1);

  const isSnapshot = file.startsWith(version);

  let classifier = file.substring(isSnapshot ? version.length : filePrefix.length, file.length - ext.length);

  if (classifier.startsWith('-')) {
    classifier = classifier.slice(1);
  }

  let name = `${groupId}:${artifactId}:${version}`;
  if (classifier) {
    name += `:${classifier}`;
  }
  if (type !== 'jar') {
    name += `@${type}`;
  }

  return {
    type,
    groupId,
    artifactId,
    version,
    classifier,
    name,
    path,
    isSnapshot,
  };
};

function resolve(lib) {
  const name = typeof lib === 'string' ? lib : lib.name;
  const [body, type = 'jar'] = name.split('@');
  const [groupId, artifactId, version, classifier = ''] = body.split(':');
  const isSnapshot = version.endsWith('-SNAPSHOT');

  const groupPath = groupId.replace(/\./g, '/');
  let base = `${groupPath}/${artifactId}/${version}/${artifactId}-${version}`;
  if (classifier) { base += `-${classifier}`; }
  const path = `${base}.${type}`;

  return {
    type,
    groupId,
    artifactId,
    version,
    name,
    isSnapshot,
    classifier,
    path,
  };
};


class ResolvedLibrary {
  constructor(
    name,
    info,
    download,
    isNative = false,
    checksums,
    serverreq,
    clientreq,
    extractExclude
  ) {
    const { groupId, artifactId, version, isSnapshot, type, classifier, path } = info;
    this.groupId = groupId;
    this.artifactId = artifactId;
    this.version = version;
    this.isSnapshot = isSnapshot;
    this.type = type;
    this.classifier = classifier;
    this.path = path;
    this.name = name;
    this.download = download;
    this.isNative = isNative;
    this.checksums = checksums;
    this.serverreq = serverreq;
    this.clientreq = clientreq;
    this.extractExclude = extractExclude;
  }
}

const Version = {
  checkAllowed(rules, platform = getPlatform(), features = []) {
    if (!rules || rules.length === 0) {
      return true;
    }

    let allow = false;

    for (const rule of rules) {
      const action = rule.action === 'allow';
      let apply = true;

      if ('os' in rule && rule.os) {
        apply = false;
        const osRule = rule.os;

        if (platform.name === osRule.name &&
          (!osRule.version || platform.version.match(osRule.version))) {
          apply = true;
        }
      }

      if (apply) {
        if ('features' in rule && rule.features) {
          const featureRequire = rule.features;
          apply = Object.entries(featureRequire)
            .every(([k, v]) => v ? features.indexOf(k) !== -1 : features.indexOf(k) === -1);
        }
      }

      if (apply) {
        allow = action;
      }
    }

    return allow;
  },

  async parse(minecraftPath, version, platform = getPlatform()) {
    const folder = MinecraftFolder.from(minecraftPath);
    const hierarchy = await resolveDependency(folder, version, platform);
    return this.resolve(minecraftPath, hierarchy);
  },

  resolve(minecraftPath, hierarchy) {
    const folder = MinecraftFolder.from(minecraftPath);

    const rootVersion = hierarchy[hierarchy.length - 1];
    const id = hierarchy[0].id;
    let assetIndex = rootVersion.assetIndex;
    let assets = '';

    const downloadsMap = {};
    const librariesMap = {};
    const nativesMap = {};

    let mainClass = '';
    const args = { jvm: [], game: [] };
    let minimumLauncherVersion = 0;
    let releaseTime = '';
    let time = '';
    let type = '';
    let logging;
    const minecraftVersion = rootVersion.clientVersion || rootVersion._minecraftVersion || rootVersion.id;
    let location;
    let javaVersion = { majorVersion: 8, component: 'jre-legacy' };

    const chains = hierarchy.map((j) => folder.getVersionRoot(j.id));
    const inheritances = hierarchy.map((j) => j.id);

    let json;
    do {
      json = hierarchy.pop();
      minimumLauncherVersion = Math.max(json.minimumLauncherVersion || 0, minimumLauncherVersion);
      location = json.minecraftDirectory;

      if (!json.replace) {
        args.game.push(...json.arguments.game);
        args.jvm.push(...json.arguments.jvm);
      } else {
        args.game = json.arguments.game;
        args.jvm = json.arguments.jvm;
      }

      releaseTime = json.releaseTime || releaseTime;
      time = json.time || time;
      logging = json.logging || logging;
      assets = json.assets || assets;
      type = json.type || type;
      mainClass = json.mainClass || mainClass;
      assetIndex = json.assetIndex || assetIndex;
      javaVersion = json.javaVersion || javaVersion;

      if (json.libraries) {
        json.libraries.forEach((lib) => {
          let libOrgName = `${lib.groupId}:${lib.artifactId}`;
          if (lib.classifier) {
            libOrgName += `-${lib.classifier};`;
          }
          if (lib.isNative) {
            nativesMap[libOrgName] = lib;
          } else {
            librariesMap[libOrgName] = lib;
          }
        });
      }
      if (json.downloads) {
        for (const key in json.downloads) {
          downloadsMap[key] = json.downloads[key];
        }
      }
    } while (hierarchy.length !== 0);

    if (!mainClass) {
      const error = new Error();
      error.name = 'BadVersionJson';
      throw {
        error: 'BadVersionJson',
        version: id,
        missing: 'MainClass'
      };
    }

    return {
      id,
      assetIndex,
      assets,
      minecraftVersion,
      inheritances,
      arguments: args,
      downloads: Object.values(downloadsMap),
      libraries: Object.values(librariesMap).concat(Object.values(nativesMap)),
      mainClass,
      minimumLauncherVersion,
      releaseTime,
      time,
      type,
      logging,
      pathChain: chains,
      minecraftDirectory: location,
      javaVersion,
    };
  },

  inherits(id, parent, version) {
    const launcherVersion = Math.max(parent.minimumLauncherVersion, version.minimumLauncherVersion);

    const libMap = {};
    parent.libraries.forEach((l) => { libMap[l.name] = l; });
    const libraries = version.libraries.filter((l) => libMap[l.name] === undefined);

    const result = {
      id,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: version.type,
      libraries,
      mainClass: version.mainClass,
      inheritsFrom: parent.id,
      minimumLauncherVersion: launcherVersion,
    };

    if (typeof parent.minecraftArguments === 'string') {
      if (typeof version.arguments === 'object') {
        throw new TypeError('Extends require two versions in the same format!');
      }
      result.minecraftArguments = mixinArgumentString(parent.minecraftArguments,
        version.minecraftArguments || '');
    } else if (typeof parent.arguments === 'object') {
      if (typeof version.minecraftArguments === 'string') {
        throw new TypeError('Extends require two versions in the same format!');
      }
      result.arguments = version.arguments;
    }

    return result;
  },

  mixinArgumentString(hi, lo) {
    const arrA = hi.split(' ');
    const arrB = lo.split(' ');
    const args = {};
    for (let i = 0; i < arrA.length; i++) {
      const element = arrA[i];
      if (!args[element]) { args[element] = []; }
      if (arrA[i + 1]) { args[element].push(arrA[i += 1]); }
    }
    for (let i = 0; i < arrB.length; i++) {
      const element = arrB[i];
      if (!args[element]) { args[element] = []; }
      if (arrB[i + 1]) { args[element].push(arrB[i += 1]); }
    }
    const out = [];
    for (const k of Object.keys(args)) {
      switch (k) {
        case '--tweakClass': {
          const set = {};
          for (const v of args[k]) { set[v] = 0; }
          Object.keys(set).forEach((v) => out.push(k, v));
          break;
        }
        default:
          if (args[k][0]) { out.push(k, args[k][0]); }
          break;
      }
    }
    return out.join(' ');
  },

  async resolveDependency(path, version, platform = getPlatform()) {
    const folder = MinecraftFolder.from(path);
    const stack = [];

    async function walk(versionName) {
      const jsonPath = folder.getVersionJson(versionName);
      let contentString;
      try {
        contentString = await readFile(jsonPath, 'utf-8');
      } catch (err) {
        const e = err;
        throw Object.assign(new Error(e.message), {
          name: 'MissingVersionJson',
          error: 'MissingVersionJson',
          version: versionName,
          path: jsonPath,
        });
      }
      let nextVersion;
      try {
        const versionJson = this.normalizeVersionJson(contentString, folder.root, platform);
        stack.push(versionJson);
        nextVersion = versionJson.inheritsFrom;
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw Object.assign(new Error(e.message), {
            name: 'CorruptedVersionJson',
            error: 'CorruptedVersionJson',
            version: versionName,
            json: contentString,
          });
        }
        throw e;
      }
      if (nextVersion) {
        if (stack.some((v) => v.id === nextVersion)) {
          throw Object.assign(new Error('Cannot resolve circular dependencies'), {
            name: 'CircularDependenciesError',
            error: 'CircularDependenciesError',
            version,
            chain: stack.map((v) => v.id).concat(nextVersion),
          });
        }
        await walk(nextVersion);
      }
    }
    await walk(version);

    return stack;
  },

  async resolveLibrary(lib, platform = getPlatform()) {
    if ('rules' in lib && !this.checkAllowed(lib.rules, platform)) {
      return undefined;
    }
    if ('natives' in lib) {
      if (!lib.natives[platform.name]) {
        return undefined;
      }
      const classifier = lib.natives[platform.name].replace('${arch}', platform.arch.substring(1));
      let nativeArtifact = lib.downloads?.classifiers?.[classifier];
      const info = LibraryInfo.resolve(lib.name + ':' + classifier);
      if (!nativeArtifact) {
        nativeArtifact = {
          path: info.path,
          sha1: '',
          size: -1,
          url: 'https://libraries.minecraft.net/' + info.path,
        };
      }
      return new ResolvedLibrary(lib.name + ':' + classifier, info, nativeArtifact, true, undefined, undefined, undefined, lib.extract ? (lib.extract.exclude ? lib.extract.exclude : undefined) : undefined);
    }
    const info = LibraryInfo.resolve(lib.name);
    if ('downloads' in lib) {
      if (!lib.downloads.artifact) {
        throw new Error('Corrupted library: ' + JSON.stringify(lib));
      }
      if (!lib.downloads.artifact.url) {
        lib.downloads.artifact.url = info.groupId === 'net.minecraftforge' ?
          'https://files.minecraftforge.net/maven/' + lib.downloads.artifact.path :
          'https://libraries.minecraft.net/' + lib.downloads.artifact.path;
      }
      if (info.classifier.startsWith('natives')) {
        return new ResolvedLibrary(info.name, info, lib.downloads.artifact, true);
      }
      return new ResolvedLibrary(lib.name, info, lib.downloads.artifact);
    }
    const maven = lib.url || 'https://libraries.minecraft.net/';
    const artifact = {
      size: -1,
      sha1: lib.checksums ? lib.checksums[0] : '',
      path: info.path,
      url: maven + info.path,
    };
    return new ResolvedLibrary(lib.name, info, artifact, false, lib.checksums, lib.serverreq, lib.clientreq);
  },

  async resolveLibraries(libs, platform = getPlatform()) {
    return libs.map((lib) => this.resolveLibrary(lib, platform)).filter((l) => l !== undefined);
  },

  normalizeVersionJson(versionString, root, platform = getPlatform()) {
    function processArguments(ar) {
      return ar.filter((a) => {
        if (typeof a === 'object' && a.rules?.every((r) => typeof r === 'string' || !('features' in r))) {
          return Version.checkAllowed(a.rules, platform);
        }
        return true;
      });
    }

    const parsed = JSON.parse(versionString);
    const legacyVersionJson = !parsed.arguments;
    const libraries = this.resolveLibraries(parsed.libraries || [], platform);
    const args = {
      jvm: [],
      game: []
    };

    if (!parsed.arguments) {
      args.game = parsed.minecraftArguments ? parsed.minecraftArguments.split(' ') : [];
      args.jvm = [
        {
          rules: [
            {
              action: 'allow',
              os: {
                name: 'windows',
              },
            },
          ],
          value: '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
        },
        {
          rules: [
            {
              action: 'allow',
              os: {
                name: 'windows',
                version: '^10\\.',
              },
            },
          ],
          value: [
            '-Dos.name=Windows 10',
            '-Dos.version=10.0',
          ],
        },
        '-Djava.library.path=${natives_directory}',
        '-Dminecraft.launcher.brand=${launcher_name}',
        '-Dminecraft.launcher.version=${launcher_version}',
        '-cp',
        '${classpath}',
      ];
    } else {
      args.jvm = parsed.arguments.jvm || [];
      args.game = parsed.arguments.game || [];
    }

    args.jvm = processArguments(args.jvm);

    const partial = {
      ...parsed,
      libraries,
      arguments: args,
      minecraftDirectory: root,
      replace: legacyVersionJson,
    };

    return partial;
  }
};

module.exports = { resolveFromPath, resolve, Version }