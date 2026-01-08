export interface NfSchematicSchema {
  project: string;
  port: string;
  nxBuilders: boolean | undefined;
  type: 'host' | 'dynamic-host' | 'remote';
}
