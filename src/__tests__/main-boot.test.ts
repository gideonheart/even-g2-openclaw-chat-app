import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../main';

function setUrlSearch(search: string): void {
  const path = search ? `/${search}` : '/';
  window.history.pushState({}, '', path);
}

describe('main runtime boot routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as any).flutter_inappwebview;
    setUrlSearch('');
  });

  afterEach(() => {
    delete (window as any).flutter_inappwebview;
    setUrlSearch('');
  });

  it('plain-browser boot: initializes hub only', async () => {
    const initHub = vi.fn().mockResolvedValue(undefined);
    const bootGlasses = vi.fn().mockResolvedValue(undefined);

    await main({ initHub, bootGlasses });

    expect(initHub).toHaveBeenCalledTimes(1);
    expect(bootGlasses).not.toHaveBeenCalled();
  });

  it('dual-boot path: boots glasses when flutter_inappwebview is present', async () => {
    Object.defineProperty(window, 'flutter_inappwebview', {
      value: {},
      configurable: true,
      writable: true,
    });

    const initHub = vi.fn().mockResolvedValue(undefined);
    const bootGlasses = vi.fn().mockResolvedValue(undefined);

    await main({ initHub, bootGlasses });

    expect(initHub).toHaveBeenCalledTimes(1);
    expect(bootGlasses).toHaveBeenCalledTimes(1);
  });

  it('boot order expectations: hub init completes before glasses boot', async () => {
    setUrlSearch('?even=1');

    const calls: string[] = [];
    const initHub = vi.fn().mockImplementation(async () => {
      calls.push('initHub:start');
      await Promise.resolve();
      calls.push('initHub:end');
    });
    const bootGlasses = vi.fn().mockImplementation(async () => {
      calls.push('boot:start');
      await Promise.resolve();
      calls.push('boot:end');
    });

    await main({ initHub, bootGlasses });

    expect(calls).toEqual(['initHub:start', 'initHub:end', 'boot:start', 'boot:end']);
  });

  it('initHub failure isolation: still proceeds to glasses boot safely', async () => {
    setUrlSearch('?even=1');

    const hubErr = new Error('hub failed');
    const initHub = vi.fn().mockRejectedValue(hubErr);
    const bootGlasses = vi.fn().mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await main({ initHub, bootGlasses });

    expect(initHub).toHaveBeenCalledTimes(1);
    expect(bootGlasses).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith('[main] Hub init failed (continuing):', hubErr);
  });
});
