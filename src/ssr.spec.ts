import { describe, it, expect } from 'vitest';
import { rewriteModulePreloads } from './ssr';

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
      'content-type': 'text/html; charset=utf-8',
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
    expect(out!.headers.get('content-type')).toBe('text/html; charset=utf-8');
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

  it('does not add a second crossorigin', async () => {
    const res = html(
      page(NATIVE, '<link rel="modulepreload" href="chunk-ABC.js" crossorigin="anonymous">'),
    );

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain(
      '<link rel="preload" as="script" href="chunk-ABC.js" crossorigin="anonymous">',
    );
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

  it('ignores esms-options inside an HTML comment', async () => {
    const commented = `<!-- ${NATIVE} -->`;
    const res = html(page(commented + SHIM, '<link rel="modulepreload" href="chunk-ABC.js">'));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('reads attributes, not text inside other attribute values', async () => {
    const res = html(
      page(
        NATIVE,
        '<link title="x rel=modulepreload y" rel="stylesheet" href="s.css">' +
          '<link title="no crossorigin" rel="modulepreload" href="a.js">' +
          '<link title="a>b" rel="modulepreload" href="b.js">',
      ),
    );

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain('<link title="x rel=modulepreload y" rel="stylesheet" href="s.css">');
    expect(body).toContain('<link title="no crossorigin" rel="preload" as="script" crossorigin');
    expect(body).toContain('<link title="a>b" rel="preload" as="script" crossorigin href="b.js">');
  });

  it('leaves preload markup inside a script body alone', async () => {
    const script = '<script>const tag = \'<link rel="modulepreload" href="x.js">\';</script>';
    const res = html(page(NATIVE, script + '<link rel="modulepreload" href="chunk-ABC.js">'));

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain(script);
    expect(body).toContain('<link rel="preload" as="script" crossorigin href="chunk-ABC.js">');
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

  it('keeps an existing as instead of adding a second one', async () => {
    const res = html(page(NATIVE, '<link rel="modulepreload" as="script" href="chunk-ABC.js">'));

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain('<link rel="preload" crossorigin as="script" href="chunk-ABC.js">');
  });

  it('matches case-insensitively and keeps the tag name as written', async () => {
    const options = '<SCRIPT TYPE="ESMS-OPTIONS">{"shimMode":false}</SCRIPT>';
    const res = html(page(options, '<LINK REL=" ModulePreload " HREF="a.js">'));

    const body = await (await rewriteModulePreloads(res))!.text();

    expect(body).toContain('<LINK rel="preload" as="script" crossorigin HREF="a.js">');
  });

  it('takes the mode from the first esms-options block only', async () => {
    const res = html(page(SHIM + NATIVE, '<link rel="modulepreload" href="chunk-ABC.js">'));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('treats everything after an unclosed script as its body, as browsers do', async () => {
    const res = html(page(NATIVE, '<script>let a = 1;<link rel="modulepreload" href="x.js">'));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('leaves a page in another charset alone rather than re-encoding it', async () => {
    const res = html(page(NATIVE, '<link rel="modulepreload" href="chunk-ABC.js">'), {
      'content-type': 'text/html; charset=iso-8859-1',
    });

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('leaves a page with no esms-options alone', async () => {
    const res = html(page('', '<link rel="modulepreload" href="chunk-ABC.js">'));

    expect(await rewriteModulePreloads(res)).toBe(res);
  });

  it('leaves unparsable esms-options alone', async () => {
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
