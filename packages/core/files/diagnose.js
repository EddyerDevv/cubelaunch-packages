/**
 * @author EddyerDevv - Linsx Studios
 * @license MIT
 */


const { Version } = require('./version');
const { MinecraftFolder } = require('./folder');
const { checksum, exists, isNotNull } = require('./utils');
const { readFile, stat } = require('fs').promises;

async function diagnoseFile({ file, expectedChecksum, role, hint, algorithm }, options) {
  let issue = false;
  let receivedChecksum = '';
  algorithm = algorithm || 'sha1';

  const checksumFunc = options && options.checksum || checksum;
  const signal = options && options.signal;
  const fileExisted = await exists(file);

  if (signal && signal.aborted) return;

  if (!fileExisted) {
    issue = true;
  } else if (expectedChecksum !== '') {
    receivedChecksum = await checksumFunc(file, algorithm);
    if (signal && signal.aborted) return;
    issue = receivedChecksum !== expectedChecksum;
  }

  const type = fileExisted ? 'corrupted' : 'missing';

  if (issue) {
    return {
      type,
      role,
      file,
      expectedChecksum,
      receivedChecksum,
      hint,
    };
  }

  return undefined;
};

async function diagnose(version, minecraftLocation, options) {
  const minecraft = MinecraftFolder.from(minecraftLocation);
  const report = {
    minecraftLocation: minecraft,
    version,
    issues: [],
  };
  const issues = report.issues;

  let resolvedVersion;
  try {
    resolvedVersion = await Version.parse(minecraft, version);
  } catch (err) {
    const e = err;
    if (e.error === 'CorruptedVersionJson') {
      issues.push({ type: 'corrupted', role: 'versionJson', file: minecraft.getVersionJson(e.version), expectedChecksum: '', receivedChecksum: '', hint: 'Re-install the minecraft!' });
    } else {
      issues.push({ type: 'missing', role: 'versionJson', file: minecraft.getVersionJson(e.version), expectedChecksum: '', receivedChecksum: '', hint: 'Re-install the minecraft!' });
    }
    return report;
  }

  const jarIssue = await diagnoseJar(resolvedVersion, minecraft);

  if (jarIssue) {
    report.issues.push(jarIssue);
  }

  const assetIndexIssue = await diagnoseAssetIndex(resolvedVersion, minecraft);

  if (assetIndexIssue) {
    report.issues.push(assetIndexIssue);
  }

  const librariesIssues = await diagnoseLibraries(resolvedVersion, minecraft, options);

  if (librariesIssues.length > 0) {
    report.issues.push(...librariesIssues);
  }

  if (!assetIndexIssue) {
    const objects = (await readFile(minecraft.getAssetsIndex(resolvedVersion.assets), 'utf-8').then((b) => JSON.parse(b.toString()))).objects;
    const assetsIssues = await diagnoseAssets(objects, minecraft, options);

    if (assetsIssues.length > 0) {
      report.issues.push(...assetsIssues);
    }
  }

  return report;
}

async function diagnoseLibraries(resolvedVersion, minecraft, options) {
  const signal = options && options.signal;
  const issues = await Promise.all(resolvedVersion.libraries.map(async (lib) => {
    if (!lib.download.path) {
      throw new TypeError(`Cannot diagnose library without path! ${JSON.stringify(lib)}`);
    }
    const libPath = minecraft.getLibraryByPath(lib.download.path);
    if (!options || !options.strict) {
      const issue = await diagnoseFile({ file: libPath, expectedChecksum: lib.download.sha1, role: 'library', hint: 'Problem on library! Please consider to use Installer.installLibraries to fix.' }, options);
      if (issue) {
        return Object.assign(issue, { library: lib });
      }
    } else {
      const size = lib.download.size;
      const { size: realSize } = await stat(libPath).catch(() => ({ size: -1 }));
      if (signal && signal.aborted) return;
      if (size !== -1 && realSize !== size) {
        const issue = await diagnoseFile({ file: libPath, expectedChecksum: lib.download.sha1, role: 'library', hint: 'Problem on library! Please consider to use Installer.installLibraries to fix.' }, options);
        if (issue) {
          return Object.assign(issue, { library: lib });
        }
      }
    }
    return undefined;
  }));
  return issues.filter(isNotNull);
}

async function diagnoseAssetIndex(resolvedVersion, minecraft) {
  const assetsIndexPath = minecraft.getAssetsIndex(resolvedVersion.assets);
  const issue = await diagnoseFile(
    { file: assetsIndexPath, expectedChecksum: resolvedVersion.assetIndex?.sha1 || '', role: 'assetIndex', hint: 'Problem on assets index file! Please consider to use Installer.installAssets to fix.' });
  if (issue) {
    return Object.assign(issue, { version: resolvedVersion.minecraftVersion });
  }
  return undefined;
}

async function diagnoseJar(resolvedVersion, minecraft, options) {
  const jarPath = minecraft.getVersionJar(resolvedVersion.minecraftVersion);
  const issue = await diagnoseFile(
    { file: jarPath, expectedChecksum: resolvedVersion.downloads.client?.sha1 || '', role: 'minecraftJar', hint: 'Problem on Minecraft jar! Please consider to use Installer.instalVersion to fix.' });
  if (issue) {
    return Object.assign(issue, { version: resolvedVersion.minecraftVersion });
  }
  return undefined;
}

async function diagnoseAssets(assetObjects, minecraft, options) {
  const signal = options && options.signal;
  const filenames = Object.keys(assetObjects);
  const issues = await Promise.all(filenames.map(async (filename) => {
    const { hash, size } = assetObjects[filename];
    const assetPath = minecraft.getAsset(hash);

    if (options && options.strict) {
      const issue = await diagnoseFile({ file: assetPath, expectedChecksum: hash, role: 'asset', hint: 'Problem on asset! Please consider to use Installer.installAssets to fix.' }, options);
      if (issue) {
        return Object.assign(issue, { asset: { name: filename, hash, size } });
      }
    } else {
      const { size: realSize } = await stat(assetPath).catch(() => ({ size: -1 }));
      if (signal && signal.aborted) return;
      if (realSize !== size) {
        const issue = await diagnoseFile({ file: assetPath, expectedChecksum: hash, role: 'asset', hint: 'Problem on asset! Please consider to use Installer.installAssets to fix.' }, options);
        if (issue) {
          return Object.assign(issue, { asset: { name: filename, hash, size } });
        }
      }
    }

    return undefined;
  }));
  return issues.filter(isNotNull);
};

module.exports = { diagnose, diagnoseAssetIndex, diagnoseAssets, diagnoseFile, diagnoseJar, diagnoseLibraries }