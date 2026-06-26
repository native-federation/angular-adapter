import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInitFederation = vi.fn();
const mockUseShimImportMap = vi.fn();
const mockConsoleLogger = vi.fn();
const mockGlobalThisStorageEntry = vi.fn();

vi.mock('@softarc/native-federation-orchestrator', () => ({
  initFederation: mockInitFederation,
  NativeFederationResult: undefined,
}));

vi.mock('@softarc/native-federation-orchestrator/options', () => ({
  useShimImportMap: mockUseShimImportMap,
  consoleLogger: mockConsoleLogger,
  globalThisStorageEntry: mockGlobalThisStorageEntry,
  LogType: undefined,
}));

describe('initFederation', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInitFederation.mockReset();
    mockUseShimImportMap.mockReset();
    mockConsoleLogger.mockReset();
    mockGlobalThisStorageEntry.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes sse: true to orchestrator when options.sse is true', async () => {
    mockInitFederation.mockReturnValue(Promise.resolve({}));
    mockUseShimImportMap.mockReturnValue({});
    const { initFederation } = await import('./index.js');

    initFederation({}, { sse: true });

    const options = mockInitFederation.mock.calls[0]![1];
    expect(options.sse).toBe(true);
  });

  it('passes sse: false to orchestrator when options.sse is false', async () => {
    mockInitFederation.mockReturnValue(Promise.resolve({}));
    mockUseShimImportMap.mockReturnValue({});
    const { initFederation } = await import('./index.js');

    initFederation({}, { sse: false });

    const options = mockInitFederation.mock.calls[0]![1];
    expect(options.sse).toBe(false);
  });

  it('passes sse: undefined to orchestrator when options.sse is not set', async () => {
    mockInitFederation.mockReturnValue(Promise.resolve({}));
    mockUseShimImportMap.mockReturnValue({});
    const { initFederation } = await import('./index.js');

    initFederation({}, {});

    const options = mockInitFederation.mock.calls[0]![1];
    expect(options.sse).toBeUndefined();
  });

  it('does not pass sse when options is omitted', async () => {
    mockInitFederation.mockReturnValue(Promise.resolve({}));
    mockUseShimImportMap.mockReturnValue({});
    const { initFederation } = await import('./index.js');

    initFederation({});

    const options = mockInitFederation.mock.calls[0]![1];
    expect(options.sse).toBeUndefined();
  });
});
