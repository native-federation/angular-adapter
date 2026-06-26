import type { Tree } from '@angular-devkit/schematics';
import type { NormalizedOptions } from './normalize-options.js';

export function updateWorkspaceConfig(
  tree: Tree,
  options: NormalizedOptions,
  workspace: any,
  workspaceFileName: string,
  ssr: boolean
) {
  const { projectConfig, projectName, port } = options;

  if (!projectConfig?.architect?.build || !projectConfig?.architect?.serve) {
    throw new Error(`The project doesn't have a build or serve target in angular.json!`);
  }

  if (projectConfig.architect.build.builder === '@angular-architects/native-federation-v4:build') {
    console.log('native-federation builder is already set, skipping workspace setup.');
    return;
  }

  const originalBuild = projectConfig.architect.build;

  // Force the esbuild application builder. The build target Angular scaffolds is
  // either `@angular-devkit/build-angular:application` or `@angular/build:application`;
  // both normalize to the latter here.
  console.log('Switching project to the application builder using esbuild ...');
  originalBuild.builder = '@angular/build:application';
  delete originalBuild.configurations?.development?.buildOptimizer;
  delete originalBuild.configurations?.development?.vendorChunk;

  if (originalBuild.options.main) {
    const main = originalBuild.options.main;
    delete originalBuild.options.main;
    originalBuild.options.browser = main;
  }

  delete originalBuild.options.commonChunk;

  projectConfig.architect.esbuild = originalBuild;

  projectConfig.architect.build = {
    builder: '@angular-architects/native-federation-v4:build',
    options: {
      cacheExternalArtifacts: true,
    },
    configurations: {
      production: {
        target: `${projectName}:esbuild:production`,
      },
      development: {
        target: `${projectName}:esbuild:development`,
        dev: true,
      },
    },
    defaultConfiguration: 'production',
  };

  if (ssr) {
    projectConfig.architect.build.options.ssr = true;

    // Angular scaffolds `security.allowedHosts: []`, which makes @angular/ssr
    // reject the localhost Host header (SSRF guard) and silently fall back to
    // CSR. Allow localhost so SSR actually renders during local development.
    const esbuildOptions = projectConfig.architect.esbuild.options;
    esbuildOptions.security ??= {};
    if (
      !Array.isArray(esbuildOptions.security.allowedHosts) ||
      esbuildOptions.security.allowedHosts.length === 0
    ) {
      esbuildOptions.security.allowedHosts = ['localhost'];
    }
  }

  const serve = projectConfig.architect.serve;
  serve.options ??= {};
  serve.options.port = port;

  delete serve.options.commonChunk;

  const serveProd = projectConfig.architect.serve.configurations?.production;
  if (serveProd) {
    serveProd.buildTarget = `${projectName}:esbuild:production`;
    delete serveProd.browserTarget;
  }

  const serveDev = projectConfig.architect.serve.configurations?.development;
  if (serveDev) {
    serveDev.buildTarget = `${projectName}:esbuild:development`;
    delete serveDev.browserTarget;
  }

  projectConfig.architect['serve-original'] = projectConfig.architect.serve;

  projectConfig.architect.serve = {
    builder: '@angular-architects/native-federation-v4:build',
    options: {
      target: `${projectName}:serve-original:development`,
      rebuildDelay: 500,
      cacheExternalArtifacts: true,
      dev: true,
      devServer: true,
      port: 0,
    },
  };

  const serveSsr = projectConfig.architect['serve-ssr'];
  if (serveSsr && !serveSsr.options) {
    serveSsr.options = {};
  }

  if (serveSsr) {
    serveSsr.options.port = port;
  }

  tree.overwrite(workspaceFileName, JSON.stringify(workspace, null, '\t'));
}
