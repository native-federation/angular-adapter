import { createRequire } from 'module';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { rewriteModulePreloads } from './ssr';

// Angular's original, loaded by absolute file path because the exports map blocks the
// `@angular/build/src/...` specifier (#153).
const require = createRequire(import.meta.url);
const angularBuildRoot = path.dirname(require.resolve('@angular/build/package.json'));
const { augmentIndexHtml } = require(
  path.join(angularBuildRoot, 'src/utils/index-file/augment-index-html.js'),
);

const NATIVE = '<script type="esms-options">{"shimMode":false}</script>';
const SHIM = '<script type="esms-options">{"shimMode":true}</script>';

function page(esmsOptions: string, preloads: string): string {
  return (
    '<!doctype html><html><head></head><body>\n\t\t' +
    `${esmsOptions}<app-root></app-root>${preloads}</body></html>`
  );
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      // What `@angular/ssr` sends: no space, upper case.
      'content-type': 'text/html;charset=UTF-8',
      'content-length': String(new TextEncoder().encode(body).length),
      ...headers,
    },
  });
}

describe('rewriteModulePreloads', () => {
  it('turns modulepreload hints into script preloads under native import maps', async () => {
    const res = html(
      page(
        NATIVE,
        '<link rel="modulepreload" href="chunk-ABC.js">' +
          '<link rel="modulepreload" href="chunk-DEF.js">',
      ),
    );

    const out = await rewriteModulePreloads(res);
    const body = await out!.text();

    expect(body).toContain('<link rel="preload" as="script" crossorigin href="chunk-ABC.js">');
    expect(body).toContain('<link rel="preload" as="script" crossorigin href="chunk-DEF.js">');
    expect(body).not.toContain('modulepreload');
  });

  it('drops content-length, which the rewrite makes wrong, and keeps the rest', async () => {
    const res = html(page(NATIVE, '<link rel="modulepreload" href="chunk-ABC.js">'), {
      'x-custom': 'kept',
    });

    const out = await rewriteModulePreloads(res);

    expect(out!.headers.has('content-length')).toBe(false);
    expect(out!.headers.get('x-custom')).toBe('kept');
    expect(out!.headers.get('content-type')).toBe('text/html;charset=UTF-8');
    expect(out!.status).toBe(200);
  });

  it('keeps the status of an error page it rewrites', async () => {
    const body = page(NATIVE, '<link rel="modulepreload" href="chunk-ABC.js">');
    const res = new Response(body, {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'text/html' },
    });

    const out = await rewriteModulePreloads(res);

    expect(await out!.text()).toContain('rel="preload" as="script"');
    expect(out!.status).toBe(404);
    expect(out!.statusText).toBe('Not Found');
  });

  it('leaves shim mode alone, returning the same response with its body unread', async () => {
    const body = page(SHIM, '<link rel="modulepreload" href="chunk-ABC.js">');
    const res = html(body);

    const out = await rewriteModulePreloads(res);

    // The body must still be readable: writeResponseToNodeResponse streams it next.
    expect(out).toBe(res);
    expect(await out!.text()).toBe(body);
  });

  it('reads native mode from esms-options that carry other keys too', async () => {
    const options = '<script type="esms-options">{"shimMode":false,"mapOverrides":true}</script>';
    const res = html(page(options, '<link rel="modulepreload" href="chunk-ABC.js">'));

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain('<link rel="preload" as="script" crossorigin href="chunk-ABC.js">');
  });

  it('keeps the nonce that ngCspNonce adds to esms-options and to the links', async () => {
    // Angular's addNonce appends `nonce` after the attributes already there.
    const options = '<script type="esms-options" nonce="r4nd0m">{"shimMode":false}</script>';
    const res = html(
      page(options, '<link rel="modulepreload" href="chunk-ABC.js" nonce="r4nd0m">'),
    );

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain(
      '<link rel="preload" as="script" crossorigin href="chunk-ABC.js" nonce="r4nd0m">',
    );
  });

  it('rewrites a streamed body, as the engine returns for server-rendered routes', async () => {
    const source = page(NATIVE, '<link rel="modulepreload" href="chunk-ABC.js">');
    const bytes = new TextEncoder().encode(source);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 40));
        controller.enqueue(bytes.slice(40));
        controller.close();
      },
    });
    const res = new Response(stream, { headers: { 'content-type': 'text/html' } });

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain('<link rel="preload" as="script" crossorigin href="chunk-ABC.js">');
  });

  it('leaves other links and attributes alone', async () => {
    const res = html(
      page(
        NATIVE,
        '<link rel="modulepreload" href="chunk-ABC.js" integrity="sha384-x" nonce="n1">' +
          '<link rel="stylesheet" href="styles.css">' +
          '<link rel="preload" as="style" href="theme.css">' +
          '<link rel="modulepreload stylesheet" href="odd.css">' +
          '<link data-rel="modulepreload" rel="stylesheet" href="data.css">',
      ),
    );

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain(
      '<link rel="preload" as="script" crossorigin href="chunk-ABC.js" ' +
        'integrity="sha384-x" nonce="n1">',
    );
    expect(body).toContain('<link rel="stylesheet" href="styles.css">');
    expect(body).toContain('<link rel="preload" as="style" href="theme.css">');
    expect(body).toContain('<link rel="modulepreload stylesheet" href="odd.css">');
    expect(body).toContain('<link data-rel="modulepreload" rel="stylesheet" href="data.css">');
  });

  it('ignores a data-type attribute that only looks like esms-options', async () => {
    const decoy = '<script data-type="esms-options">{"shimMode":false}</script>';
    const res = html(page(decoy + SHIM, '<link rel="modulepreload" href="chunk-ABC.js">'));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('leaves custom elements whose names start with link or script alone', async () => {
    const custom =
      '<link-card rel="modulepreload" href="a.js"></link-card>' +
      '<script-runner type="esms-options">{"shimMode":true}</script-runner>';
    const res = html(page(NATIVE, custom + '<link rel="modulepreload" href="chunk-ABC.js">'));

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain(custom);
    expect(body).toContain('<link rel="preload" as="script" crossorigin href="chunk-ABC.js">');
  });

  it('leaves a page with no esms-options alone', async () => {
    const res = html(page('', '<link rel="modulepreload" href="chunk-ABC.js">'));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('needs the builder\'s exact {"shimMode":false prefix', async () => {
    const res = html(
      page(
        '<script type="esms-options">{shimMode:false</script>',
        '<link rel="modulepreload" href="chunk-ABC.js">',
      ),
    );

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('leaves non-HTML responses alone', async () => {
    // A body that would be rewritten if it were HTML, so only the content type can stop it.
    const res = new Response(page(NATIVE, '<link rel="modulepreload" href="chunk-ABC.js">'), {
      headers: { 'content-type': 'text/plain' },
    });

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('returns the same response when there is nothing to rewrite', async () => {
    const res = html(page(NATIVE, ''));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('passes null through, for routes the engine does not handle', async () => {
    expect(await rewriteModulePreloads(null)).toBeNull();
  });
});

describe("@angular/build's modulepreload hints", () => {
  // The helper matches the literal `<link rel="modulepreload"`, so `rel` has to stay first.
  it('are still written with rel first', async () => {
    const { content } = await augmentIndexHtml({
      html: '<html><head></head><body><app-root></app-root></body></html>',
      sri: false,
      files: [],
      entrypoints: [],
      loadOutputFile: async () => '',
      hints: [{ url: 'chunk-ABC.js', mode: 'modulepreload' }],
    });

    expect(content).toContain('<link rel="modulepreload" href="chunk-ABC.js">');
  });
});
