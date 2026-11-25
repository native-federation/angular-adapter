// First block wins: the builder writes it right after `<body>`; HTML comments aren't skipped.
const ESMS_OPTIONS =
  /<script\b[^>]*(?<![\w-])type\s*=\s*["']esms-options["'][^>]*>([\s\S]*?)<\/script>/i;
// Only an exact `rel` of `modulepreload`: never `data-rel`, never `rel="modulepreload foo"`.
const REL_MODULEPRELOAD = String.raw`(?<![\w-])rel\s*=\s*(["']?)modulepreload\1(?=[\s/>])`;
const MODULE_PRELOAD = new RegExp(String.raw`<link\b[^>]*${REL_MODULEPRELOAD}[^>]*>`, 'gi');
const REL_ATTRIBUTE = new RegExp(REL_MODULEPRELOAD, 'i');
const CROSSORIGIN_ATTRIBUTE = /\scrossorigin\b/i;

/** Wraps `AngularNodeAppEngine.handle()` in `server.ts` under `shimMode: false` (#171). */
export async function rewriteModulePreloads(res: Response | null): Promise<Response | null> {
  if (!res || !res.body) return res;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) return res;

  const html = await res.clone().text();
  if (!usesNativeImportMaps(html)) return res;

  const rewritten = html.replace(MODULE_PRELOAD, toScriptPreload);
  if (rewritten === html) return res;

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(rewritten, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function usesNativeImportMaps(html: string): boolean {
  const options = ESMS_OPTIONS.exec(html)?.[1];
  if (!options) return false;
  try {
    return (JSON.parse(options) as { shimMode?: unknown }).shimMode === false;
  } catch {
    return false;
  }
}

// `crossorigin` keeps the preload in CORS mode, so the module import reuses the response.
function toScriptPreload(tag: string): string {
  const replacement = CROSSORIGIN_ATTRIBUTE.test(tag)
    ? 'rel="preload" as="script"'
    : 'rel="preload" as="script" crossorigin';
  return tag.replace(REL_ATTRIBUTE, replacement);
}
