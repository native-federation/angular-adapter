const MODULE_PRELOAD = '<link rel="modulepreload"';
const NATIVE_IMPORT_MAPS = /<script type="esms-options"[^>]*>\{"shimMode":false/;

// `crossorigin` keeps the preload in CORS mode, so the module import reuses the response (#171).
export async function rewriteModulePreloads(res: Response | null): Promise<Response | null> {
  if (!res?.body || !res.headers.get('content-type')?.includes('text/html')) return res;

  const html = await res.clone().text();
  if (!NATIVE_IMPORT_MAPS.test(html) || !html.includes(MODULE_PRELOAD)) return res;

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(
    html.replaceAll(MODULE_PRELOAD, '<link rel="preload" as="script" crossorigin'),
    { status: res.status, statusText: res.statusText, headers },
  );
}
