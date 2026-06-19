import type { SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks/index.js';
import {
  addPackageJsonDependency,
  getPackageJsonDependency,
  NodeDependencyType,
} from '@schematics/angular/utility/dependencies';

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

  // Browser-only projects bundle the orchestrator into the app, so a dev
  // dependency suffices. For SSR it must be a runtime dependency: the generated
  // server entry imports '@softarc/native-federation-orchestrator/node' as a
  // bare specifier resolved from node_modules at runtime.
  addPackageJsonDependency(tree, {
    name: '@softarc/native-federation-orchestrator',
    type: ssr ? NodeDependencyType.Default : NodeDependencyType.Dev,
    version: '^4.2.2',
    overwrite: true,
  });

  if (ssr) {
    console.log('SSR detected ...');
    console.log('Activating CORS ...');

    addPackageJsonDependency(tree, {
      name: 'cors',
      type: NodeDependencyType.Default,
      version: '^2.8.5',
      overwrite: false,
    });
  }

  context.addTask(new NodePackageInstallTask());
}
