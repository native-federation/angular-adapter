import { createRequire } from 'node:module';
import * as path from 'node:path';
import { type SkipList, DEFAULT_SKIP_LIST } from '@softarc/native-federation/config';

const installed = new Map<string, boolean>();

function isInstalled(name: string): boolean {
  let result = installed.get(name);
  if (result === undefined) {
    try {
      createRequire(path.join(process.cwd(), 'noop.js')).resolve(`${name}/package.json`);
      result = true;
    } catch {
      result = false;
    }
    installed.set(name, result);
  }
  return result;
}

export const NG_SKIP_LIST: SkipList = [
  ...DEFAULT_SKIP_LIST,
  '@angular-architects/native-federation',
  '@angular-architects/native-federation-v4',
  '@angular-architects/native-federation-v4/config',
  '@angular-architects/native-federation-v4/internal',
  'zone.js',
  '@angular/localize',
  '@angular/localize/init',
  '@angular/localize/tools',
  /^@nx\/angular/,
  pkg => pkg.startsWith('@angular/') && !!pkg.match(/\/testing(\/|$)/),
  // Optional peers: these entry points can't build without them, but skipping them when they are
  // installed leaves a bare import nothing publishes (#187). Drop the animations entry once Angular
  // removes platform-browser/animations.
  pkg =>
    pkg.startsWith('@angular/platform-browser/animations') && !isInstalled('@angular/animations'),
  pkg => /^@angular\/(router|common)\/upgrade$/.test(pkg) && !isInstalled('@angular/upgrade'),
];
