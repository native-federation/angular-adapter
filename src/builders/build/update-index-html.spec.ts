import * as fs from 'fs';

import { updateScriptTags, updateIndexHtml } from './update-index-html.js';
import type { NfBuilderSchema } from './schema.js';

vi.mock('fs');

describe('updateScriptTags', () => {
  const nfOptions = {} as NfBuilderSchema;

  it('turns the polyfills script into a plain module', () => {
    const html = '<body><script src="polyfills-ABC.js"></script></body>';
    expect(updateScriptTags(html, nfOptions)).toContain(
      '<script type="module" src="polyfills-ABC.js"></script>'
    );
  });

  it('turns the main script into a module-shim', () => {
    const html = '<body><script src="main-XYZ.js"></script></body>';
    expect(updateScriptTags(html, nfOptions)).toContain(
      '<script type="module-shim" src="main-XYZ.js"></script>'
    );
  });

  it('keeps the main script a plain module when shimMode is disabled', () => {
    const html = '<body><script src="main-XYZ.js"></script></body>';
    const result = updateScriptTags(html, {
      esmsInitOptions: { shimMode: false },
    } as never);
    expect(result).toContain('<script type="module" src="main-XYZ.js"></script>');
    expect(result).not.toContain('module-shim');
  });

  it('replaces an existing type attribute rather than appending one', () => {
    const html = '<body><script type="text/javascript" src="main-XYZ.js"></script></body>';
    const result = updateScriptTags(html, nfOptions);
    expect(result).toContain('<script type="module-shim" src="main-XYZ.js"></script>');
    expect(result).not.toContain('text/javascript');
  });

  it('ignores scripts whose path, not file name, contains main (dev server under a base href)', () => {
    const html =
      '<head><script type="module" src="/maintenance/@vite/client"></script></head>' +
      '<body><script src="polyfills.js" type="module"></script><script src="main.js" type="module"></script></body>';
    const result = updateScriptTags(html, nfOptions);
    expect(result).toContain('<script type="module" src="/maintenance/@vite/client"></script>');
    expect(result).toContain('<script src="main.js" type="module-shim"></script>');
  });

  it('ignores scripts whose path, not file name, contains polyfills', () => {
    const html =
      '<head><script type="text/javascript" src="/polyfills-docs/@vite/client"></script></head>' +
      '<body><script src="polyfills.js"></script></body>';
    const result = updateScriptTags(html, nfOptions);
    expect(result).toContain('<script type="text/javascript" src="/polyfills-docs/@vite/client"></script>');
    expect(result).toContain('<script type="module" src="polyfills.js"></script>');
  });

  it('still matches main and polyfills scripts referenced by an absolute path', () => {
    const html = '<body><script src="/app/polyfills.js"></script><script src="/app/main.js"></script></body>';
    const result = updateScriptTags(html, nfOptions);
    expect(result).toContain('<script type="module" src="/app/polyfills.js"></script>');
    expect(result).toContain('<script type="module-shim" src="/app/main.js"></script>');
  });

  it('injects the esms-options script after the opening body tag with shimMode default', () => {
    const result = updateScriptTags('<body></body>', nfOptions);
    expect(result).toContain('<script type="esms-options">{"shimMode":true}</script>');
    // injected directly after <body>
    expect(result).toMatch(/<body>\s*<script type="esms-options">/);
  });

  it('merges esmsInitOptions and lets them override shimMode', () => {
    const result = updateScriptTags('<body></body>', {
      esmsInitOptions: { shimMode: false, polyfillEnable: ['css-modules'] },
    } as never);
    expect(result).toContain(
      '<script type="esms-options">{"shimMode":false,"polyfillEnable":["css-modules"]}</script>'
    );
  });
});

describe('updateIndexHtml', () => {
  const fedOptions = { workspaceRoot: '/ws', outputPath: 'dist/app' } as never;
  const nfOptions = {} as NfBuilderSchema;

  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('rewrites the first existing index candidate (server index preferred)', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      p => String(p).endsWith('index.server.html')
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      '<body><script src="main-1.js"></script></body>' as never
    );

    updateIndexHtml(fedOptions, nfOptions);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0]!;
    expect(String(writtenPath)).toContain('index.server.html');
    expect(String(writtenContent)).toContain('type="module-shim"');
  });

  it('falls back to the browser index.html when the server index is missing', () => {
    vi.mocked(fs.existsSync).mockImplementation(p => String(p).endsWith('index.html'));
    vi.mocked(fs.readFileSync).mockReturnValue('<body></body>' as never);

    updateIndexHtml(fedOptions, nfOptions);

    const [writtenPath] = vi.mocked(fs.writeFileSync).mock.calls[0]!;
    expect(String(writtenPath)).toContain('index.html');
  });

  it('logs an error and does not write when no index is found', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    updateIndexHtml(fedOptions, nfOptions);

    expect(errorSpy).toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
