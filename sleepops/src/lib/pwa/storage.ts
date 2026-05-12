export type StringStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

const memoryStorage = new Map<string, string>();

export function readCachedString(
  key: string,
  storage = getBrowserStorage(),
): string | null {
  if (!storage) {
    return memoryStorage.get(key) ?? null;
  }

  try {
    const value = storage.getItem(key);
    if (value !== null) {
      memoryStorage.set(key, value);
      return value;
    }

    memoryStorage.delete(key);
    return null;
  } catch {
    return memoryStorage.get(key) ?? null;
  }
}

export function writeCachedString(
  key: string,
  value: string,
  storage = getBrowserStorage(),
): boolean {
  memoryStorage.set(key, value);

  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeCachedString(
  key: string,
  storage = getBrowserStorage(),
): boolean {
  memoryStorage.delete(key);

  if (!storage?.removeItem) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function clearMemoryCacheForTests(): void {
  memoryStorage.clear();
}

function getBrowserStorage(): StringStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
