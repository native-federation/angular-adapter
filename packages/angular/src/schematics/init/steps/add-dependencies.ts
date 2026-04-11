import type { SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks/index.js';
import {
  addPackageJsonDependency,
  getPackageJsonDependency,
  NodeDependencyType,
} from '@schematics/angular/utility/dependencies';

const SSR_VERSION = '4.0.0-RC9';

export function addDependencies(tree: Tree, context: SchematicContext, ssr: boolean): void {
  addPackageJsonDependency(tree, {
    name: '@angular-devkit/build-angular',
    type: NodeDependencyType.Dev,
    version: getPackageJsonDependency(tree, '@angular/build')?.version || 'latest',
    overwrite: false,
  });

  addPackageJsonDependency(tree, {
    name: 'es-module-shims',
    type: NodeDependencyType.Default,
    version: '^2.8.0',
    overwrite: false,
  });

  addPackageJsonDependency(tree, {
    name: '@softarc/native-federation-orchestrator',
    type: NodeDependencyType.Dev,
    version: '^4.0.0',
    overwrite: false,
  });

  context.addTask(new NodePackageInstallTask());

  if (ssr) {
    console.log('SSR detected ...');
    console.log('Activating CORS ...');

    addPackageJsonDependency(tree, {
      name: 'cors',
      type: NodeDependencyType.Default,
      version: '^2.8.5',
      overwrite: false,
    });

    addPackageJsonDependency(tree, {
      name: '@softarc/native-federation-node',
      type: NodeDependencyType.Default,
      version: SSR_VERSION,
      overwrite: true,
    });
  }
}
