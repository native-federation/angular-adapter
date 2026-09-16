export interface NfSchematicSchema {
  project: string;
  port: string;
  type: 'host' | 'dynamic-host' | 'remote';
  webcomponent?: boolean;
}
