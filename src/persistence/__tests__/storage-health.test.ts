import {
  createStorageHealth,
  type StorageHealthService,
} from '../storage-health';

describe('storage-health', () => {
  let service: StorageHealthService;
  const originalStorage = navigator.storage;

  afterEach(() => {
    // Restore original navigator.storage
    Object.defineProperty(navigator, 'storage', {
      value: originalStorage,
      writable: true,
      configurable: true,
    });
  });

  // ── getQuota() ───────────────────────────────────────────

  describe('getQuota()', () => {
    it('returns correct values from estimate()', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({ usage: 1024, quota: 4096 }),
          persisted: () => Promise.resolve(true),
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.getQuota();

      expect(result.usageBytes).toBe(1024);
      expect(result.quotaBytes).toBe(4096);
      expect(result.isPersisted).toBe(true);
      expect(result.isAvailable).toBe(true);
    });

    it('returns safe defaults when navigator.storage unavailable', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.getQuota();

      expect(result.usageBytes).toBe(0);
      expect(result.quotaBytes).toBe(0);
      expect(result.usagePercent).toBe(0);
      expect(result.isPersisted).toBe(false);
      expect(result.isAvailable).toBe(false);
    });

    it('calculates usagePercent correctly', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({ usage: 800, quota: 1000 }),
          persisted: () => Promise.resolve(false),
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.getQuota();

      expect(result.usagePercent).toBe(80);
    });

    it('handles estimate() returning undefined usage/quota', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({}),
          persisted: () => Promise.resolve(false),
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.getQuota();

      expect(result.usageBytes).toBe(0);
      expect(result.quotaBytes).toBe(0);
      expect(result.usagePercent).toBe(0);
      expect(result.isAvailable).toBe(true);
    });

    it('returns safe defaults when estimate is not available', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {},
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.getQuota();

      expect(result.isAvailable).toBe(false);
      expect(result.usageBytes).toBe(0);
    });

    it('handles persisted() not available gracefully', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({ usage: 500, quota: 2000 }),
          // persisted not defined
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.getQuota();

      expect(result.isPersisted).toBe(false);
      expect(result.isAvailable).toBe(true);
      expect(result.usageBytes).toBe(500);
    });
  });

  // ── requestPersistence() ─────────────────────────────────

  describe('requestPersistence()', () => {
    it('returns true when persist() succeeds', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({}),
          persist: () => Promise.resolve(true),
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.requestPersistence();

      expect(result).toBe(true);
    });

    it('returns false when navigator.storage unavailable', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.requestPersistence();

      expect(result).toBe(false);
    });

    it('returns false when persist() returns false', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({}),
          persist: () => Promise.resolve(false),
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.requestPersistence();

      expect(result).toBe(false);
    });

    it('returns false when persist is not available', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: () => Promise.resolve({}),
          // persist not defined
        },
        writable: true,
        configurable: true,
      });

      service = createStorageHealth();
      const result = await service.requestPersistence();

      expect(result).toBe(false);
    });
  });
});
