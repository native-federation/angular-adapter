import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createStaleWatchEventFilter } from './stale-watch-event-filter.js';

describe('createStaleWatchEventFilter', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-stale-filter-'));
    file = path.join(dir, 'source.ts');
    fs.writeFileSync(file, 'export const a = 1;');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drops a replayed event for a seeded, unmodified file', () => {
    const filter = createStaleWatchEventFilter();
    filter.seed(file);

    expect(filter.isRealChange(file)).toBe(false);
    expect(filter.isRealChange(file)).toBe(false);
  });

  it('passes an event through when the mtime advanced, then drops its replay', () => {
    const filter = createStaleWatchEventFilter();
    filter.seed(file);

    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(file, later, later);

    expect(filter.isRealChange(file)).toBe(true);
    expect(filter.isRealChange(file)).toBe(false);
  });

  it('treats the first event for an unseeded file as real and its replay as stale', () => {
    const filter = createStaleWatchEventFilter();

    expect(filter.isRealChange(file)).toBe(true);
    expect(filter.isRealChange(file)).toBe(false);
  });

  it('treats a deleted file as a real change', () => {
    const filter = createStaleWatchEventFilter();
    filter.seed(file);
    fs.rmSync(file);

    expect(filter.isRealChange(file)).toBe(true);
  });
});
