import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, type NormalizedFederationConfig } from '@softarc/native-federation/internal';
import { warnFlatExternals } from './warn-flat-externals.js';

const KEEP_ALL = { includeSecondaries: true };

function config({
  denseExternals = true,
  ignoreUnusedDeps = true,
  shared = { '@angular/core': KEEP_ALL, '@angular/common': KEEP_ALL } as object,
} = {}) {
  return { features: { denseExternals, ignoreUnusedDeps }, shared } as unknown as NormalizedFederationConfig;
}

describe('warnFlatExternals', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  it('stays silent with denseExternals and keepAll on every Angular package', () => {
    warnFlatExternals(config());
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when shared externals are published flat', () => {
    warnFlatExternals(config({ denseExternals: false }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('denseExternals');
  });

  // Nothing shared means nothing for the orchestrator to split.
  it('stays silent when nothing is shared', () => {
    warnFlatExternals(config({ denseExternals: false, shared: {} }));
    expect(warn).not.toHaveBeenCalled();
  });

  // Without pruning every build publishes all entrypoints, so flat externals can't mismatch.
  it('stays silent about flat externals when ignoreUnusedDeps is off', () => {
    warnFlatExternals(config({ denseExternals: false, ignoreUnusedDeps: false }));
    expect(warn).not.toHaveBeenCalled();
  });

  // Without keepAll, share-utils deletes includeSecondaries from the resolved config.
  it('warns when @angular/core is shared without keepAll', () => {
    warnFlatExternals(config({ shared: { '@angular/core': {} } }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('keepAll');
  });

  // The pre-v4 template and README only patched @angular/core.
  it('names Angular packages other than core that lack keepAll', () => {
    warnFlatExternals(config({ shared: { '@angular/core': KEEP_ALL, '@angular/common': {} } }));
    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toMatch(/^@angular\/common is shared/);
    expect(message).not.toContain('@angular/core,');
  });

  it('lists every package lacking keepAll in a single warning', () => {
    warnFlatExternals(config({ shared: { '@angular/common': {}, '@angular/router': {} } }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/^@angular\/common, @angular\/router are shared/);
  });

  // Secondaries are expanded into their own keys and don't carry includeSecondaries.
  it('ignores secondary entrypoints', () => {
    warnFlatExternals(config({ shared: { '@angular/common': KEEP_ALL, '@angular/common/http': {} } }));
    expect(warn).not.toHaveBeenCalled();
  });

  // Without pruning every secondary is published anyway.
  it('skips the keepAll hint when ignoreUnusedDeps is off', () => {
    warnFlatExternals(config({ ignoreUnusedDeps: false, shared: { '@angular/core': {} } }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips the keepAll hint when Angular is not shared', () => {
    warnFlatExternals(config({ shared: { rxjs: {} } }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives both hints at once', () => {
    warnFlatExternals(config({ denseExternals: false, shared: { '@angular/core': {} } }));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
