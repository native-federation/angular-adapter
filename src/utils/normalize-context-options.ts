import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';
import type { SourceFileCache } from '@angular/build/private';
import type {
  FederationCache,
  EntryPoint,
  NFBuildAdapterOptions,
} from '@softarc/native-federation';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { NfInternalOptions } from '../builders/build/schema';

export interface NormalizedContextOptions {
  builderOptions: ApplicationBuilderOptions & NfInternalOptions;
  context: BuilderContext;
  entryPoints: EntryPoint[];
  external: string[];
  outdir: string;
  tsConfigPath?: string;
  mappedPaths: PathToImport;
  cache: FederationCache<SourceFileCache>;
  hash: boolean;
  chunks?: boolean;
  platform?: 'browser' | 'node';
}

export function normalizeContextOptions(
  builderOptions: ApplicationBuilderOptions & NfInternalOptions,
  context: BuilderContext,
  adapterOptions: NFBuildAdapterOptions<SourceFileCache>
): NormalizedContextOptions {
  return {
    builderOptions,
    context,
    entryPoints: adapterOptions.entryPoints,
    external: adapterOptions.external,
    outdir: adapterOptions.outdir,
    tsConfigPath: adapterOptions.tsConfigPath,
    mappedPaths: adapterOptions.mappedPaths,
    cache: adapterOptions.cache,
    hash: !!adapterOptions.hash,
    chunks: adapterOptions.chunks,
    platform: adapterOptions.platform,
  };
}
