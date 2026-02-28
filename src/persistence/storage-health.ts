// ── Storage Health ────────────────────────────────────────
// Monitors storage quota and requests persistent storage.
// All Storage APIs are feature-detected -- unavailable environments return safe defaults.
// Zero runtime dependencies (browser built-ins only).

export interface StorageHealth {
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
  isPersisted: boolean;
  isAvailable: boolean;
}

export interface StorageHealthService {
  getQuota(): Promise<StorageHealth>;
  requestPersistence(): Promise<boolean>;
}

export function createStorageHealth(): StorageHealthService {
  function getQuota(): Promise<StorageHealth> {
    if (!navigator.storage || !('estimate' in navigator.storage)) {
      return Promise.resolve({
        usageBytes: 0,
        quotaBytes: 0,
        usagePercent: 0,
        isPersisted: false,
        isAvailable: false,
      });
    }

    return navigator.storage.estimate().then((estimate) => {
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const usagePercent = quota ? (usage / quota) * 100 : 0;

      const persistedPromise = navigator.storage.persisted
        ? navigator.storage.persisted()
        : Promise.resolve(false);

      return persistedPromise.then((isPersisted) => ({
        usageBytes: usage,
        quotaBytes: quota,
        usagePercent,
        isPersisted,
        isAvailable: true,
      }));
    });
  }

  function requestPersistence(): Promise<boolean> {
    if (!navigator.storage || !('persist' in navigator.storage)) {
      return Promise.resolve(false);
    }

    return navigator.storage.persist();
  }

  return { getQuota, requestPersistence };
}
