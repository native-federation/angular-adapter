import { type SkipList, DEFAULT_SKIP_LIST } from '@softarc/native-federation/config';

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
  '@angular/router/upgrade',
  '@angular/common/upgrade',
  /^@nx\/angular/,
  pkg => pkg.startsWith('@angular/') && !!pkg.match(/\/testing(\/|$)/),
];
