import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

vi.mock('@softarc/native-federation/config', () => ({ DEFAULT_SKIP_LIST: [] }));

// Each test builds a throwaway workspace with only the given packages in node_modules, and
// re-imports the module so the isInstalled memo starts empty.
let workspace: string;

function install(...names: string[]) {
  for (const name of names) {
    const dir = path.join(workspace, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '22.0.0' }));
  }
}

async function isSkipped(pkg: string): Promise<boolean> {
  const { NG_SKIP_LIST } = await import('./angular-skip-list.js');
  return NG_SKIP_LIST.some(e =>
    typeof e === 'string' ? e === pkg : typeof e === 'function' ? e(pkg) : e.test(pkg),
  );
}

beforeEach(() => {
  vi.resetModules();
  workspace = mkdtempSync(path.join(tmpdir(), 'nf-skip-list-'));
  vi.spyOn(process, 'cwd').mockReturnValue(workspace);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workspace, { recursive: true, force: true });
});

describe('NG_SKIP_LIST', () => {
  it('skips the platform-browser animations entry points when @angular/animations is missing', async () => {
    expect(await isSkipped('@angular/platform-browser/animations')).toBe(true);
    expect(await isSkipped('@angular/platform-browser/animations/async')).toBe(true);
  });

  // Skipping them here would leave a bare import nothing publishes, failing at runtime (#187).
  it('shares the animations entry points when @angular/animations is installed', async () => {
    install('@angular/animations');
    expect(await isSkipped('@angular/platform-browser/animations')).toBe(false);
    expect(await isSkipped('@angular/platform-browser/animations/async')).toBe(false);
  });

  it('skips the upgrade entry points when @angular/upgrade is missing', async () => {
    expect(await isSkipped('@angular/router/upgrade')).toBe(true);
    expect(await isSkipped('@angular/common/upgrade')).toBe(true);
  });

  it('shares the upgrade entry points when @angular/upgrade is installed', async () => {
    install('@angular/upgrade');
    expect(await isSkipped('@angular/router/upgrade')).toBe(false);
    expect(await isSkipped('@angular/common/upgrade')).toBe(false);
  });

  it('never skips the primary entry points of the affected packages', async () => {
    expect(await isSkipped('@angular/platform-browser')).toBe(false);
    expect(await isSkipped('@angular/router')).toBe(false);
    expect(await isSkipped('@angular/common')).toBe(false);
  });

  // The skip list is evaluated for every discovered secondary, so the lookup must be memoized.
  it('resolves each optional peer only once', async () => {
    const { NG_SKIP_LIST } = await import('./angular-skip-list.js');
    const fns = NG_SKIP_LIST.filter(e => typeof e === 'function');
    for (let i = 0; i < 3; i++) fns.forEach(f => f('@angular/platform-browser/animations'));
    install('@angular/animations');
    expect(fns.some(f => f('@angular/platform-browser/animations'))).toBe(true);
  });
});
