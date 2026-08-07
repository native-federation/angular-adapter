import type { SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks/index.js';

type DependencyType = 'dependencies' | 'devDependencies';
type PackageJson = Partial<Record<DependencyType, Record<string, string>>>;

export function addDependencies(tree: Tree, context: SchematicContext, ssr: boolean): void {
  const packageJson = (tree.readJson('package.json') as PackageJson) ?? {};

  function addDependency(
    type: DependencyType,
    name: string,
    version: string,
    overwrite = false,
  ): void {
    const deps = (packageJson[type] ??= {});
    if (overwrite || !deps[name]) {
      deps[name] = version;
    }
  }

  addDependency('dependencies', 'es-module-shims', '^2.8.0');

  // Browser-only projects bundle the orchestrator into the app, so a dev
  // dependency suffices. For SSR it must be a runtime dependency: the generated
  // server entry imports '@softarc/native-federation-orchestrator/node' as a
  // bare specifier resolved from node_modules at runtime.
  addDependency(
    ssr ? 'dependencies' : 'devDependencies',
    '@softarc/native-federation-orchestrator',
    '^4.2.2',
    true,
  );

  if (ssr) {
    console.log('SSR detected ...');
    console.log('Activating CORS ...');

    addDependency('dependencies', 'cors', '^2.8.5');
  }

  tree.overwrite('package.json', JSON.stringify(packageJson, null, 2));

  context.addTask(new NodePackageInstallTask());
}
