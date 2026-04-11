import type { Tree } from '@angular-devkit/schematics';
import {
  patchAngularBuildPackageJson,
  privateEntrySrc,
} from '../../../utils/patch-angular-build.js';
import type { PackageJson } from './normalize-options.js';

export function updatePackageJson(tree: Tree): void {
  const packageJson: PackageJson = (tree.readJson('package.json') as PackageJson) ?? {};

  const scriptCall =
    'node node_modules/@angular-architects/native-federation/src/patch-angular-build.js';

  if (!packageJson?.['scripts']) {
    packageJson['scripts'] = {};
  }

  let postInstall = (packageJson['scripts']?.['postinstall'] || '') as string;

  if (!postInstall) {
    return;
  }

  if (postInstall.includes(scriptCall)) {
    postInstall = postInstall.replace(scriptCall, '');
  }
  if (postInstall.endsWith(' && ')) {
    postInstall = postInstall.substring(0, postInstall.length - 4);
  }

  packageJson['scripts']['postinstall'] = postInstall;

  tree.overwrite('package.json', JSON.stringify(packageJson, null, 2));
}

export function patchAngularBuild(tree: Tree) {
  const packagePath = 'node_modules/@angular/build/package.json';
  const privatePath = 'node_modules/@angular/build/private.js';

  if (!tree.exists(packagePath)) {
    return;
  }

  const packageJson = JSON.parse(tree.read(packagePath)?.toString('utf8') ?? '{}');
  patchAngularBuildPackageJson(packageJson);
  tree.overwrite(packagePath, JSON.stringify(packageJson, null, 2));

  if (!tree.exists(privatePath)) {
    tree.create(privatePath, privateEntrySrc);
  } else {
    tree.overwrite(privatePath, privateEntrySrc);
  }
}
