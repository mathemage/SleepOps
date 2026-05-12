import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMemoryCacheForTests,
  readCachedString,
  removeCachedString,
  writeCachedString,
  type StringStorage,
} from "./storage";

describe("local string cache", () => {
  beforeEach(() => {
    clearMemoryCacheForTests();
  });

  it("reads and writes through browser storage", () => {
    const storage = createStorage();

    expect(writeCachedString("sleepops.test", "ready", storage)).toBe(true);
    expect(storage.getItem("sleepops.test")).toBe("ready");
    expect(readCachedString("sleepops.test", storage)).toBe("ready");
  });

  it("falls back to memory when browser storage throws", () => {
    const blockedStorage: StringStorage = {
      getItem() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
      setItem() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    };

    expect(writeCachedString("sleepops.test", "memory", blockedStorage)).toBe(
      false,
    );
    expect(readCachedString("sleepops.test", blockedStorage)).toBe("memory");
  });

  it("reports false while writing to memory when browser storage is unavailable", () => {
    expect(writeCachedString("sleepops.test", "memory", null)).toBe(false);
    expect(readCachedString("sleepops.test", null)).toBe("memory");
  });

  it("removes values from the memory fallback and browser storage", () => {
    const storage = createStorage();

    writeCachedString("sleepops.test", "ready", storage);

    expect(removeCachedString("sleepops.test", storage)).toBe(true);
    expect(readCachedString("sleepops.test", storage)).toBeNull();
  });

  it("treats a browser storage miss as authoritative when storage is available", () => {
    const storage = createStorage();
    const blockedStorage: StringStorage = {
      getItem() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
      setItem() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    };

    writeCachedString("sleepops.test", "stale", blockedStorage);

    expect(readCachedString("sleepops.test", storage)).toBeNull();
    expect(readCachedString("sleepops.test", blockedStorage)).toBeNull();
  });

  it("reports false when no backing storage removal occurs", () => {
    const storageWithoutRemoval: StringStorage = {
      getItem: () => null,
      setItem: () => {},
    };

    writeCachedString("sleepops.test", "memory", null);

    expect(removeCachedString("sleepops.test", storageWithoutRemoval)).toBe(
      false,
    );
    expect(readCachedString("sleepops.test", null)).toBeNull();
  });
});

function createStorage(): StringStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
