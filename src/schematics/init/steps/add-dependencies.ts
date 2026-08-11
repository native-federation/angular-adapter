import type { SchematicContext, Tree } from "@angular-devkit/schematics";
import { NodePackageInstallTask } from "@angular-devkit/schematics/tasks/index.js";

type DependencyType = "dependencies" | "devDependencies";
type PackageJson = Partial<Record<DependencyType, Record<string, string>>>;

export function addDependencies(
  tree: Tree,
  context: SchematicContext,
  ssr: boolean,
): void {
  const packageJson = (tree.readJson("package.json") as PackageJson) ?? {};

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

  // Angular 21's application builder still reaches into @angular-devkit/build-angular,
  // which @angular/build does not pull in on its own.
  addDependency(
    "devDependencies",
    "@angular-devkit/build-angular",
    packageJson.dependencies?.["@angular/build"] ??
      packageJson.devDependencies?.["@angular/build"] ??
      "latest",
  );

  addDependency("dependencies", "es-module-shims", "^2.8.0");

  addDependency(
    "devDependencies",
    "@softarc/native-federation-orchestrator",
    "^4.6.0",
    true,
  );

  if (ssr) {
    console.log("SSR detected ...");
    console.log("Activating CORS ...");

    addDependency("dependencies", "cors", "^2.8.5");
  }

  tree.overwrite("package.json", JSON.stringify(packageJson, null, 2));

  context.addTask(new NodePackageInstallTask());
}
