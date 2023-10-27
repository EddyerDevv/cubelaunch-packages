const { open, openEntryReadStream, walkEntriesGenerator } = require('@xmcl/unzip');
const { ChildProcess, spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');
const { createWriteStream, existsSync } = require('fs');
const { link, mkdir, readFile, writeFile } = require('fs/promises');
const { EOL } = require('os');
const { delimiter, dirname, isAbsolute, join, resolve } = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { MinecraftFolder } = require('./folder');
const { getPlatform } = require('./platform');
const { checksum, validateSha1 } = require('./utils');
const { ResolvedLibrary, ResolvedVersion, Version } = require('./version');

const DEFAULT_EXTRA_JVM_ARGS = Object.freeze([
  '-Xmx2G',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
])

function format(template, args) {
  return template.replace(/\$\{(.*?)}/g, (key) => {
    const value = args[key.substring(2).substring(0, key.length - 3)];
    return value || key;
  });
};

function normalizeArguments(args, platform, features) {
  return args.map((arg) => {
    if (typeof arg === 'string') {
      return arg;
    }
    if (!Version.checkAllowed(arg.rules || [], platform, Object.keys(features))) {
      return '';
    }
    return arg.value;
  }).reduce((result, cur) => {
    if (cur instanceof Array) {
      result.push(...cur);
    } else if (cur) {
      result.push(cur);
    }
    return result;
  }, []);
};


async function generateArguments(options) {
  if (!options.version) { throw new TypeError('Version cannot be null!') }
  if (!options.isDemo) { options.isDemo = false }

  const currentPlatform = options.platform || getPlatform();
  const gamePath = !isAbsolute(options.gamePath) ? resolve(options.gamePath) : options.gamePath;
  const resourcePath = options.resourcePath || gamePath;
  const version = typeof options.version === 'string' ? await Version.parse(resourcePath, options.version) : options.version;
  const mc = MinecraftFolder.from(resourcePath);
  const cmd = [];

  const { id = randomUUID().replace(/-/g, ''), name = 'Steve' } = options.gameProfile || {};
  const accessToken = options.accessToken || randomUUID().replace(/-/g, '');
  const properties = options.properties || {};
  const userType = options.userType || 'Mojang';
  const features = options.features || {};
  const jvmArguments = normalizeArguments(version.arguments.jvm, currentPlatform, features);
  const gameArguments = normalizeArguments(version.arguments.game, currentPlatform, features);
  const featureValues = Object.values(features).filter((f) => typeof f === 'object').reduce((a, b) => ({ ...a, ...b }), {});
  const launcherName = options.launcherName || 'Launcher';
  const launcherBrand = options.launcherBrand || '0.0.1';
  const nativeRoot = options.nativeRoot || mc.getNativesRoot(version.id);

  let gameIcon = options.gameIcon;
  if (!gameIcon) {
    const index = mc.getAssetsIndex(version.assets);
    const indexContent = await readFile(index, { encoding: 'utf-8' }).then((b) => JSON.parse(b.toString()), () => ({}));
    if ('icons/minecraft.icns' in indexContent) {
      gameIcon = mc.getAsset(indexContent['icons/minecraft.icns'].hash);
    } else if ('minecraft/icons/minecraft.icns' in indexContent) {
      gameIcon = mc.getAsset(indexContent['minecraft/icons/minecraft.icns'].hash);
    } else {
      gameIcon = '';
    }
  }
  const gameName = options.gameName || 'Minecraft';

  cmd.push(options.javaPath);

  if (currentPlatform.name === 'osx') {
    cmd.push(`-Xdock:name=${gameName}`);
    if (gameIcon) {
      cmd.push(`-Xdock:icon=${gameIcon}`);
    }
  }

  if (options.minMemory) {
    cmd.push(`-Xms${options.minMemory}M`);
  }
  if (options.maxMemory) {
    cmd.push(`-Xmx${options.maxMemory}M`);
  }

  if (options.ignoreInvalidMinecraftCertificates) {
    cmd.push('-Dfml.ignoreInvalidMinecraftCertificates=true');
  }
  if (options.ignorePatchDiscrepancies) {
    cmd.push('-Dfml.ignorePatchDiscrepancies=true');
  }

  if (options.yggdrasilAgent) {
    cmd.push(`-javaagent:${options.yggdrasilAgent.jar}=${options.yggdrasilAgent.server}`);
    cmd.push('-Dauthlibinjector.side=client');
    if (options.yggdrasilAgent.prefetched) {
      cmd.push(`-Dauthlibinjector.yggdrasil.prefetched=${options.yggdrasilAgent.prefetched}`);
    }
  }

  const jvmOptions = {
    natives_directory: nativeRoot,
    launcher_name: launcherName,
    launcher_version: launcherBrand,
    classpath: [
      ...version.libraries.filter((lib) => !lib.isNative).map((lib) => mc.getLibraryByPath(lib.download.path)),
      mc.getVersionJar(version.minecraftVersion),
      ...(options.extraClassPaths || []),
    ].join(delimiter),
    library_directory: mc.getPath('libraries'),
    classpath_separator: delimiter,
    version_name: version.minecraftVersion,
    ...featureValues,
  }

  if (version.logging && version.logging.client) {
    const client = version.logging.client;
    const argument = client.argument;
    const filePath = mc.getLogConfig(client.file.id);
    if (existsSync(filePath)) {
      jvmArguments.push(argument.replace('${path}', filePath));
    }
  }

  cmd.push(...jvmArguments.map((arg) => format(arg, jvmOptions)));

  // add extra jvm args
  if (options.extraJVMArgs instanceof Array) {
    if (options.extraJVMArgs.some((v) => typeof v !== 'string')) {
      throw new TypeError('Require extraJVMArgs be all string!');
    }
    cmd.push(...options.extraJVMArgs);
  } else {
    // if options object already has `maxMemory` property, exclude the "-Xmx2G" option from the default extra jvm args
    if (options.maxMemory) {
      cmd.push(...DEFAULT_EXTRA_JVM_ARGS.filter((v) => v !== '-Xmx2G'));
    } else {
      cmd.push(...DEFAULT_EXTRA_JVM_ARGS);
    }
  }

  cmd.push(version.mainClass);
  const assetsDir = join(resourcePath, 'assets');
  const resolution = options.resolution;
  const versionName = options.versionName || version.id;
  const versionType = options.versionType || version.type;
  const mcOptions = {
    version_name: versionName,
    version_type: versionType,
    assets_root: assetsDir,
    game_assets: join(assetsDir, 'virtual', version.assets),
    assets_index_name: version.assets,
    game_directory: gamePath,
    auth_player_name: name,
    auth_uuid: id,
    auth_access_token: accessToken,
    user_properties: JSON.stringify(properties),
    user_type: userType,
    resolution_width: -1,
    resolution_height: -1,
    ...featureValues,
  }

  if (resolution) {
    mcOptions.resolution_width = resolution.width;
    mcOptions.resolution_height = resolution.height;
  }

  cmd.push(...gameArguments.map((arg) => format(arg, mcOptions)));

  if (options.extraMCArgs) {
    cmd.push(...options.extraMCArgs);
  }
  if (options.server) {
    cmd.push('--server', options.server.ip);
    if (options.server.port) {
      cmd.push('--port', options.server.port.toString());
    }
  }
  if (options.resolution && !cmd.find((a) => a === '--width')) {
    if (options.resolution.fullscreen) {
      cmd.push('--fullscreen');
    } else {
      if (options.resolution.height) {
        cmd.push('--height', options.resolution.height.toString());
      }
      if (options.resolution.width) {
        cmd.push('--width', options.resolution.width.toString());
      }
    }
  }
  return cmd;
}

function generateArgumentsServer(options) {
  const { javaPath, minMemory = 1024, maxMemory = 1024, extraJVMArgs = [], extraMCArgs = [], extraExecOption = {} } = options;
  const cmd = [
    javaPath,
    `-Xms${minMemory}M`,
    `-Xmx${maxMemory}M`,
    ...extraJVMArgs,
  ];

  if ('path' in options) {
    const mc = MinecraftFolder.from(options.path);
    const version = options.version;
    const resolvedVersion = typeof version === 'string' ? Version.parse(mc, version) : version;
    cmd.push('-jar', mc.getVersionJar(resolvedVersion.minecraftVersion, 'server'));
  } else {
    cmd.push('-jar', options.serverExectuableJarPath);
  }

  cmd.push(...extraMCArgs);

  if (options.nogui) {
    cmd.push('nogui');
  }

  return cmd;
}


async function generateArguments(options) {
  if (!options.version) { throw new TypeError('Version cannot be null!') }
  if (!options.isDemo) { options.isDemo = false }

  const currentPlatform = options.platform || getPlatform();
  const gamePath = !isAbsolute(options.gamePath) ? resolve(options.gamePath) : options.gamePath;
  const resourcePath = options.resourcePath || gamePath;
  const version = typeof options.version === 'string' ? await Version.parse(resourcePath, options.version) : options.version;
  const mc = MinecraftFolder.from(resourcePath);
  const cmd = [];

  const { id = randomUUID().replace(/-/g, ''), name = 'Steve' } = options.gameProfile || {};
  const accessToken = options.accessToken || randomUUID().replace(/-/g, '');
  const properties = options.properties || {};
  const userType = options.userType || 'Mojang';
  const features = options.features || {};
  const jvmArguments = normalizeArguments(version.arguments.jvm, currentPlatform, features);
  const gameArguments = normalizeArguments(version.arguments.game, currentPlatform, features);
  const featureValues = Object.values(features).filter((f) => typeof f === 'object').reduce((a, b) => ({ ...a, ...b }), {});
  const launcherName = options.launcherName || 'Launcher';
  const launcherBrand = options.launcherBrand || '0.0.1';
  const nativeRoot = options.nativeRoot || mc.getNativesRoot(version.id);

  let gameIcon = options.gameIcon;
  if (!gameIcon) {
    const index = mc.getAssetsIndex(version.assets);
    const indexContent = await readFile(index, { encoding: 'utf-8' }).then((b) => JSON.parse(b.toString()), () => ({}));
    if ('icons/minecraft.icns' in indexContent) {
      gameIcon = mc.getAsset(indexContent['icons/minecraft.icns'].hash);
    } else if ('minecraft/icons/minecraft.icns' in indexContent) {
      gameIcon = mc.getAsset(indexContent['minecraft/icons/minecraft.icns'].hash);
    } else {
      gameIcon = '';
    }
  }
  const gameName = options.gameName || 'Minecraft';

  cmd.push(options.javaPath);

  if (currentPlatform.name === 'osx') {
    cmd.push(`-Xdock:name=${gameName}`);
    if (gameIcon) {
      cmd.push(`-Xdock:icon=${gameIcon}`);
    }
  }

  if (options.minMemory) {
    cmd.push(`-Xms${options.minMemory}M`);
  }
  if (options.maxMemory) {
    cmd.push(`-Xmx${options.maxMemory}M`);
  }

  if (options.ignoreInvalidMinecraftCertificates) {
    cmd.push('-Dfml.ignoreInvalidMinecraftCertificates=true');
  }
  if (options.ignorePatchDiscrepancies) {
    cmd.push('-Dfml.ignorePatchDiscrepancies=true');
  }

  if (options.yggdrasilAgent) {
    cmd.push(`-javaagent:${options.yggdrasilAgent.jar}=${options.yggdrasilAgent.server}`);
    cmd.push('-Dauthlibinjector.side=client');
    if (options.yggdrasilAgent.prefetched) {
      cmd.push(`-Dauthlibinjector.yggdrasil.prefetched=${options.yggdrasilAgent.prefetched}`);
    }
  }

  const jvmOptions = {
    natives_directory: nativeRoot,
    launcher_name: launcherName,
    launcher_version: launcherBrand,
    classpath: [
      ...version.libraries.filter((lib) => !lib.isNative).map((lib) => mc.getLibraryByPath(lib.download.path)),
      mc.getVersionJar(version.minecraftVersion),
      ...(options.extraClassPaths || []),
    ].join(delimiter),
    library_directory: mc.getPath('libraries'),
    classpath_separator: delimiter,
    version_name: version.minecraftVersion,
    ...featureValues,
  }

  if (version.logging && version.logging.client) {
    const client = version.logging.client;
    const argument = client.argument;
    const filePath = mc.getLogConfig(client.file.id);
    if (existsSync(filePath)) {
      jvmArguments.push(argument.replace('${path}', filePath));
    }
  }

  cmd.push(...jvmArguments.map((arg) => format(arg, jvmOptions)));

  if (options.extraJVMArgs instanceof Array) {
    if (options.extraJVMArgs.some((v) => typeof v !== 'string')) {
      throw new TypeError('Require extraJVMArgs be all string!');
    }
    cmd.push(...options.extraJVMArgs);
  } else {
    if (options.maxMemory) {
      cmd.push(...DEFAULT_EXTRA_JVM_ARGS.filter((v) => v !== '-Xmx2G'));
    } else {
      cmd.push(...DEFAULT_EXTRA_JVM_ARGS);
    }
  }

  cmd.push(version.mainClass);
  const assetsDir = join(resourcePath, 'assets');
  const resolution = options.resolution;
  const versionName = options.versionName || version.id;
  const versionType = options.versionType || version.type;
  const mcOptions = {
    version_name: versionName,
    version_type: versionType,
    assets_root: assetsDir,
    game_assets: join(assetsDir, 'virtual', version.assets),
    assets_index_name: version.assets,
    game_directory: gamePath,
    auth_player_name: name,
    auth_uuid: id,
    auth_access_token: accessToken,
    user_properties: JSON.stringify(properties),
    user_type: userType,
    resolution_width: -1,
    resolution_height: -1,
    ...featureValues,
  }

  if (resolution) {
    mcOptions.resolution_width = resolution.width;
    mcOptions.resolution_height = resolution.height;
  }

  cmd.push(...gameArguments.map((arg) => format(arg, mcOptions)));

  if (options.extraMCArgs) {
    cmd.push(...options.extraMCArgs);
  }
  if (options.server) {
    cmd.push('--server', options.server.ip);
    if (options.server.port) {
      cmd.push('--port', options.server.port.toString());
    }
  }
  if (options.resolution && !cmd.find((a) => a === '--width')) {
    if (options.resolution.fullscreen) {
      cmd.push('--fullscreen');
    } else {
      if (options.resolution.height) {
        cmd.push('--height', options.resolution.height.toString());
      }
      if (options.resolution.width) {
        cmd.push('--width', options.resolution.width.toString());
      }
    }
  }
  return cmd;
}
