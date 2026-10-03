import { normalizeOptimization, normalizeSourceMaps } from './normalize-build-options.js';

describe('normalizeOptimization', () => {
  it('expands a boolean `true` into all-enabled options', () => {
    expect(normalizeOptimization(true)).toEqual({
      scripts: true,
      styles: { minify: true, inlineCritical: true, removeSpecialComments: true },
      fonts: { inline: true },
    });
  });

  it('expands a boolean `false` into all-disabled options', () => {
    expect(normalizeOptimization(false)).toEqual({
      scripts: false,
      styles: { minify: false, inlineCritical: false, removeSpecialComments: false },
      fonts: { inline: false },
    });
  });

  it('defaults to enabled when called without an argument', () => {
    expect(normalizeOptimization()).toEqual({
      scripts: true,
      styles: { minify: true, inlineCritical: true, removeSpecialComments: true },
      fonts: { inline: true },
    });
  });

  it('derives style/font sub-options from booleans on an object form', () => {
    expect(normalizeOptimization({ scripts: true, styles: false, fonts: true })).toEqual({
      scripts: true,
      styles: { minify: false, removeSpecialComments: false, inlineCritical: false },
      fonts: { inline: true },
    });
  });

  it('passes through object style/font sub-options verbatim', () => {
    const styles = { minify: true, inlineCritical: false, removeSpecialComments: true };
    const fonts = { inline: false };
    expect(normalizeOptimization({ scripts: false, styles, fonts })).toEqual({
      scripts: false,
      styles,
      fonts,
    });
  });
});

describe('normalizeSourceMaps', () => {
  it('expands a boolean into per-target flags with hidden/vendor disabled', () => {
    expect(normalizeSourceMaps(true)).toEqual({
      scripts: true,
      styles: true,
      sourcesContent: true,
      hidden: false,
      vendor: false,
    });
  });

  it('expands a boolean `false`', () => {
    expect(normalizeSourceMaps(false)).toEqual({
      scripts: false,
      styles: false,
      sourcesContent: false,
      hidden: false,
      vendor: false,
    });
  });

  it('reads individual fields from an object form', () => {
    expect(
      normalizeSourceMaps({
        scripts: true,
        styles: false,
        hidden: true,
        vendor: true,
        sourcesContent: false,
      })
    ).toEqual({
      scripts: true,
      styles: false,
      hidden: true,
      vendor: true,
      sourcesContent: false,
    });
  });

  it('defaults hidden/vendor to false when omitted in object form', () => {
    const result = normalizeSourceMaps({ scripts: true, styles: true });
    expect(result.hidden).toBe(false);
    expect(result.vendor).toBe(false);
  });
});
