// Comments and `<script>` bodies are matched whole (to the end, if unclosed, as browsers do) so
// nothing inside them is read or rewritten; quoted attribute values may contain `>`.
const TAG_ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;
const MARKUP = new RegExp(
  [
    String.raw`<!--[\s\S]*?(?:-->|$)`,
    String.raw`<script(?=[\s/>])${TAG_ATTRIBUTES}>([\s\S]*?)(?:<\/script\s*>|$)`,
    String.raw`<link(?=[\s/>])${TAG_ATTRIBUTES}>`,
  ].join('|'),
  'gi',
);
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

interface Attribute {
  name: string;
  value: string;
  source: string;
  index: number;
}

/** Wraps `AngularNodeAppEngine.handle()` in `server.ts` under `shimMode: false` (#171). */
export async function rewriteModulePreloads(res: Response | null): Promise<Response | null> {
  if (!res || !res.body) return res;
  const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/html')) return res;
  // `text()` decodes as UTF-8, so a page in another charset is left alone rather than re-encoded.
  const charset = /charset\s*=\s*"?([^";\s]+)/.exec(contentType)?.[1];
  if (charset && charset !== 'utf-8' && charset !== 'utf8') return res;

  const html = await res.clone().text();
  if (!usesNativeImportMaps(html)) return res;

  const rewritten = html.replace(
    MARKUP,
    (markup, _script, _body, linkAttributes: string | undefined) =>
      linkAttributes === undefined ? markup : toScriptPreload(markup, linkAttributes),
  );
  if (rewritten === html) return res;

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(rewritten, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

// The first block wins: the builder writes it right after `<body>`.
function usesNativeImportMaps(html: string): boolean {
  for (const [, script, body] of html.matchAll(MARKUP)) {
    if (script === undefined || attributeValue(script, 'type') !== 'esms-options') continue;
    try {
      return (JSON.parse(body ?? '') as { shimMode?: unknown }).shimMode === false;
    } catch {
      return false;
    }
  }
  return false;
}

// `crossorigin` keeps the preload in CORS mode, so the module import reuses the response.
function toScriptPreload(tag: string, source: string): string {
  const attributes = parseAttributes(source);
  const rel = attributes.find((attribute) => attribute.name === 'rel');
  if (rel?.value.trim().toLowerCase() !== 'modulepreload') return tag;

  const has = (name: string) => attributes.some((attribute) => attribute.name === name);
  const replacement = [
    'rel="preload"',
    has('as') ? '' : 'as="script"',
    has('crossorigin') ? '' : 'crossorigin',
  ]
    .filter(Boolean)
    .join(' ');
  const rewritten =
    source.slice(0, rel.index) + replacement + source.slice(rel.index + rel.source.length);
  return `${tag.slice(0, '<link'.length)}${rewritten}>`;
}

function attributeValue(source: string, name: string): string | undefined {
  return parseAttributes(source)
    .find((attribute) => attribute.name === name)
    ?.value.trim()
    .toLowerCase();
}

function parseAttributes(source: string): Attribute[] {
  return [...source.matchAll(ATTRIBUTE)].map((match) => ({
    name: (match[1] ?? '').toLowerCase(),
    value: match[2] ?? match[3] ?? match[4] ?? '',
    source: match[0],
    index: match.index,
  }));
}
