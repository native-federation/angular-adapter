import * as fs from 'fs';
import * as path from 'path';

import type { Plugin, ViteDevServer, IndexHtmlTransformResult, Connect } from 'vite';
import { lookup } from 'mrmime';
import { devExternalsMixin } from './dev-externals-mixin.js';
import { filterExternals } from './externals-skip-list.js';
import {
  type BuildHelperParams,
  federationBuilder,
  type FederationInfo,
} from '@softarc/native-federation';

type FedInfoRef = { federationInfo: FederationInfo };

export const federation = (params: BuildHelperParams): Plugin => {
  return {
    ...devExternalsMixin,
    name: '@module-federation/vite', // required, will show up in warnings and errors
    async config(config, env) {
      await federationBuilder.init(params);
      if (typeof devExternalsMixin.config === 'function') {
        devExternalsMixin.config.call(this, config, env);
      }
    },
    options(o) {
      o!['external'] = filterExternals(federationBuilder.externals);
    },
    async closeBundle() {
      await federationBuilder.build();
    },
    async configureServer(server: ViteDevServer) {
      const fedInfoRef: FedInfoRef = {
        federationInfo: federationBuilder.federationInfo,
      };
      await configureDevServer(server, params, fedInfoRef);
    },
    transformIndexHtml(html: string): IndexHtmlTransformResult {
      const fragment = '<script src="polyfills.js" type="module-shim">';
      const updated = `
<script type="esms-options">
{
"shimMode": true
}
</script>
<script src="polyfills.js" type="module">
`;
      html = html.replace(/type="module"/g, 'type="module-shim"');
      return html.replace(fragment, updated);
    },
  };
};

const configureDevServer = async (
  server: ViteDevServer,
  params: BuildHelperParams,
  fedInfo: FedInfoRef
) => {
  await federationBuilder.build();

  const op = params.options;
  const dist = path.join(op.workspaceRoot, op.outputPath);
  server.middlewares.use(serveFromDist(dist, fedInfo));
};

const serveFromDist = (dist: string, fedInfoRef: FedInfoRef): Connect.NextHandleFunction => {
  const fedFiles = new Set([
    ...fedInfoRef.federationInfo.shared.map(s => path.join('/', s.outFileName)),
    ...fedInfoRef.federationInfo.exposes.map(e => path.join('/', e.outFileName)),
    '/remoteEntry.json',
  ]);

  return (req, res, next) => {
    if (!req.url || req.url.endsWith('/index.html') || !fedFiles.has(req.url)) {
      next();
      return;
    }

    const file = path.join(dist, req.url);
    if (fs.existsSync(file) && fs.lstatSync(file).isFile()) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const type = lookup(req.url) || '';
      res.setHeader('Content-Type', type);

      const content = fs.readFileSync(file, 'utf-8');
      //   const modified = enhanceFile(file, content);
      const modified = content;
      res.write(modified);
      res.end();
      return;
    }

    next();
  };
};
