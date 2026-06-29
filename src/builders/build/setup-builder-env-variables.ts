/**
 * Disables Angular's parallel caching and allows for
 * a shared cache between the compilation steps which
 * improves performance dramatically.
 */
if (!process.env['NG_BUILD_PARALLEL_TS']) {
  process.env['NG_BUILD_PARALLEL_TS'] = '0';
}

/**
 * Disables Angular 22's chunk optimization pass (on by default, threshold 3).
 * It re-bundles esbuild output via Rollup *after* Native Federation has already
 * computed its import map, so shared externals (e.g. @angular/core) are no longer
 * resolved as singletons in the optimized chunks. This surfaces at runtime as
 * `ɵɵdefineComponent is not a function`. Setting this to '0' forces the threshold
 * to Infinity, keeping federation's chunk layout intact.
 */
process.env['NG_BUILD_OPTIMIZE_CHUNKS'] = '0';
