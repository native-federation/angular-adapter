// Portions adapted from angular/angular-cli (packages/angular/build/src/), which @angular/build's
// exports map doesn't expose (#153). Copyright Google LLC. MIT License: https://angular.dev/license

import type { BuildOptions } from 'esbuild';
import type { ApplicationBuilderOptions } from '@angular/build';

import { normalizeOptimization, normalizeSourceMaps } from '../../utils/normalize-build-options.js';
import { findFrameworkVersion } from './find-framework-version.js';

// Everything that makes our bundles' script output follow Angular's app build (#163). Plain data,
// so the shared-bundle cache key can hash it.
export interface ScriptSettings {
  optimize: boolean;
  allowMangle: boolean;
  zoneless: boolean;
  conditions: string[];
  sourcesContent: boolean | undefined;
}

export async function resolveScriptSettings(
  builderOptions: ApplicationBuilderOptions,
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ScriptSettings> {
  const optimize = normalizeOptimization(builderOptions.optimization).scripts;
  const { polyfills } = builderOptions;

  return {
    optimize,
    // Read per build, not at module load like Angular, which also avoids the early snapshot of #107.
    allowMangle: readAllowMangle(env),
    zoneless: isZonelessApp(
      polyfills === undefined || Array.isArray(polyfills) ? polyfills : [polyfills]
    ),
    conditions: getConditions(
      optimize,
      await findFrameworkVersion(projectRoot),
      builderOptions.conditions
    ),
    sourcesContent: normalizeSourceMaps(builderOptions.sourceMap ?? false).sourcesContent,
  };
}

// upstream: angular/angular-cli packages/angular/build/src/tools/esbuild/application-code-bundle.ts @ 11dbe297f8
export function getScriptBuildOptions(
  settings: ScriptSettings,
  platform: 'browser' | 'node'
): BuildOptions & { define: Record<string, string> } {
  const { optimize } = settings;

  return {
    conditions: settings.conditions,
    mainFields:
      platform === 'node'
        ? ['es2020', 'es2015', 'module', 'main']
        : ['es2020', 'es2015', 'browser', 'module', 'main'],
    // Deviation: Angular drops these under `extractLicenses` because its license extraction
    // collects them, but that only reads Angular's own metafiles, not our bundles.
    legalComments: optimize ? 'eof' : 'inline',
    minifyIdentifiers: optimize && settings.allowMangle,
    minifySyntax: optimize,
    minifyWhitespace: optimize,
    pure: ['forwardRef'],
    sourcesContent: settings.sourcesContent,
    supported: getFeatureSupport(settings.zoneless),
    // Never 'true': Angular turns an undefined ngDevMode into an object for its debug utilities.
    define: optimize ? { ngDevMode: 'false' } : {},
  };
}

// upstream: angular/angular-cli packages/angular/build/src/tools/esbuild/application-code-bundle.ts @ 11dbe297f8
export function getConditions(
  optimize: boolean,
  frameworkVersion: string,
  customConditions: string[] | undefined
): string[] {
  // Required to support rxjs 7.x which will use es5 code if this condition is not present
  const conditions = ['es2015', 'es2020'];
  // Our bundles are never JIT, so the pre-linked package condition always applies.
  conditions.push('angular:linked-' + frameworkVersion);

  if (customConditions) {
    conditions.push(...customConditions);
  } else {
    conditions.push('module', optimize ? 'production' : 'development');
  }

  return conditions;
}

// upstream: angular/angular-cli packages/angular/build/src/tools/esbuild/utils.ts @ 11dbe297f8
export function getFeatureSupport(nativeAsyncAwait: boolean): BuildOptions['supported'] {
  return {
    // Native async/await is not supported with Zone.js. Disabling support here will cause
    // esbuild to downlevel async/await, async generators, and for await...of to a Zone.js supported form.
    'async-await': nativeAsyncAwait,
    // Workaround for an esbuild minification bug when async-await is disabled and the target is es2019+.
    // The catch binding for downleveled for-await will be incorrectly removed in this specific situation.
    ...(!nativeAsyncAwait ? { 'optional-catch-binding': false } : {}),
    // V8 currently has a performance defect involving object spread operations that can cause signficant
    // degradation in runtime performance. By not supporting the language feature here, a downlevel form
    // will be used instead which provides a workaround for the performance issue.
    // For more details: https://bugs.chromium.org/p/v8/issues/detail?id=11536
    'object-rest-spread': false,
  };
}

// upstream: angular/angular-cli packages/angular/build/src/tools/esbuild/utils.ts @ 11dbe297f8
export function isZonelessApp(polyfills: string[] | undefined): boolean {
  return !polyfills?.some(p => p === 'zone.js' || /\.[mc]?[jt]s$/.test(p));
}

const TRUTHY_VALUES = new Set(['1', 'true']);
const FALSY_VALUES = new Set(['0', 'false']);

// upstream: angular/angular-cli packages/angular/build/src/utils/environment-options.ts @ 11dbe297f8
function isPresent(variable: string | undefined): variable is string {
  return typeof variable === 'string' && variable !== '';
}

// upstream: angular/angular-cli packages/angular/build/src/utils/environment-options.ts @ 11dbe297f8
function parseTristate(variable: string | undefined): boolean | undefined {
  if (!isPresent(variable)) {
    return undefined;
  }

  const value = variable.toLowerCase();
  if (TRUTHY_VALUES.has(value)) {
    return true;
  }
  if (FALSY_VALUES.has(value)) {
    return false;
  }

  return undefined;
}

// upstream: angular/angular-cli packages/angular/build/src/utils/environment-options.ts @ 11dbe297f8
export function readAllowMangle(env: NodeJS.ProcessEnv): boolean {
  return (
    parseTristate(env['NG_BUILD_MANGLE']) ?? debugOptimizeMangle(env['NG_BUILD_DEBUG_OPTIMIZE'])
  );
}

// Only the `mangle` part of Angular's `debugOptimize`: `minify` and `beautify` are unused in 22.2.
function debugOptimizeMangle(debugOptimizeVariable: string | undefined): boolean {
  if (!isPresent(debugOptimizeVariable) || parseTristate(debugOptimizeVariable) === false) {
    return true;
  }
  if (parseTristate(debugOptimizeVariable) === true) {
    return false;
  }

  return debugOptimizeVariable.split(',').some(part => part.trim().toLowerCase() === 'mangle');
}
