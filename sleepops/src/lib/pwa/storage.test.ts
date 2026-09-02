import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultMorningRoutineProfiler,
  serializeProfiler,
  setStepMinutesForDay,
} from "../routine";
import {
  DEFAULT_SLEEP_OPS_CORE_STATE,
  serializeSleepOpsCoreState,
} from "./sleepops-state";
import {
  MORNING_ROUTINE_PROFILER_LEGACY_KEY,
  SLEEPOPS_STORAGE_FALLBACK_KEY,
  createSleepOpsStorage,
  parseSleepOpsStorageDocument,
  serializeSleepOpsStorageDocument,
  type SleepOpsStorageDocumentV1,
  type StringStorage,
} from "./storage";

const DATABASE_NAME = "sleepops-storage-test";

describe("SleepOps local-first storage", () => {
  let indexedDB: IDBFactory;

  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it("round-trips the versioned storage document without changing record data", () => {
    const document: SleepOpsStorageDocumentV1 = {
      schemaVersion: 1,
      revision: 4,
      records: {
        coreState: "{ core state kept exactly }",
        morningRoutineProfiler: "{ profiler kept exactly }",
        dailyPlanHistory: "[]",
      },
      migratedV1: {
        coreState: "{ original core state }",
        morningRoutineProfiler: "{ original profiler }",
      },
    };

    expect(
      parseSleepOpsStorageDocument(
        serializeSleepOpsStorageDocument(document),
      ),
    ).toEqual(document);
  });

  it("rejects malformed or unsupported storage documents instead of guessing", () => {
    expect(parseSleepOpsStorageDocument("{")).toBeNull();
    expect(
      parseSleepOpsStorageDocument(
        JSON.stringify({ schemaVersion: 2, revision: 0 }),
      ),
    ).toBeNull();
    expect(
      parseSleepOpsStorageDocument(
        JSON.stringify({
          schemaVersion: 1,
          revision: 0,
          records: {
            coreState: null,
            morningRoutineProfiler: [],
            dailyPlanHistory: null,
          },
          migratedV1: {
            coreState: null,
            morningRoutineProfiler: null,
          },
        }),
      ),
    ).toBeNull();
  });

  it("migrates the exact core and profiler v1 wire formats into IndexedDB", async () => {
    const coreState = serializeSleepOpsCoreState({
      ...DEFAULT_SLEEP_OPS_CORE_STATE,
      workStart: "10:00",
      manualMorningRoutineMinutes: 60,
      commuteBufferMinutes: 45,
    });
    const profiler = serializeProfiler(
      setStepMinutesForDay(
        createDefaultMorningRoutineProfiler(),
        "2026-09-02",
        "wake",
        23,
        "2026-09-02",
      ),
    );
    const localStorage = createStringStorage({
      "sleepops.coreState.v1": coreState,
      [MORNING_ROUTINE_PROFILER_LEGACY_KEY]: profiler,
    });
    const storage = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage,
    });

    await storage.initialize();

    expect(await storage.readCoreState()).toBe(coreState);
    expect(await storage.readProfilerData()).toBe(profiler);
    expect(localStorage.getItem("sleepops.coreState.v1")).toBe(coreState);
    expect(localStorage.getItem(MORNING_ROUTINE_PROFILER_LEGACY_KEY)).toBe(
      profiler,
    );

    const fallbackDocument = parseSleepOpsStorageDocument(
      localStorage.getItem(SLEEPOPS_STORAGE_FALLBACK_KEY),
    );
    expect(fallbackDocument).toMatchObject({
      schemaVersion: 1,
      records: {
        coreState,
        morningRoutineProfiler: profiler,
        dailyPlanHistory: null,
      },
      migratedV1: {
        coreState,
        morningRoutineProfiler: profiler,
      },
    });

    const indexedDbOnly = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage: null,
    });
    expect(await indexedDbOnly.readCoreState()).toBe(coreState);
    expect(await indexedDbOnly.readProfilerData()).toBe(profiler);
  });

  it("keeps unparseable v1 data unchanged after valid replacement writes", async () => {
    const malformedCoreState = "{ not valid core JSON";
    const malformedProfiler = JSON.stringify({
      steps: [{ id: 7, label: null }],
      days: "not-an-array",
    });
    const localStorage = createStringStorage({
      "sleepops.coreState.v1": malformedCoreState,
      [MORNING_ROUTINE_PROFILER_LEGACY_KEY]: malformedProfiler,
    });
    const storage = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage,
    });

    await storage.initialize();
    expect(await storage.readCoreState()).toBe(malformedCoreState);
    expect(await storage.readProfilerData()).toBe(malformedProfiler);

    const validCoreState = serializeSleepOpsCoreState(
      DEFAULT_SLEEP_OPS_CORE_STATE,
    );
    const validProfiler = serializeProfiler(
      createDefaultMorningRoutineProfiler(),
    );
    await storage.writeCoreState(validCoreState);
    await storage.writeProfilerData(validProfiler);

    const document = parseSleepOpsStorageDocument(
      localStorage.getItem(SLEEPOPS_STORAGE_FALLBACK_KEY),
    );
    expect(document?.records.coreState).toBe(validCoreState);
    expect(document?.records.morningRoutineProfiler).toBe(validProfiler);
    expect(document?.migratedV1.coreState).toBe(malformedCoreState);
    expect(document?.migratedV1.morningRoutineProfiler).toBe(
      malformedProfiler,
    );
  });

  it("persists core, profiler, and reserved history records through IndexedDB", async () => {
    const storage = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage: null,
    });

    await storage.initialize();
    await expect(storage.writeCoreState("core")).resolves.toEqual({
      durable: true,
      storage: "indexeddb",
    });
    await storage.writeProfilerData("profiler");
    await storage.writeDailyPlanHistory("history");

    const reloadedStorage = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage: null,
    });
    expect(await reloadedStorage.readCoreState()).toBe("core");
    expect(await reloadedStorage.readProfilerData()).toBe("profiler");
    expect(await reloadedStorage.readDailyPlanHistory()).toBe("history");
  });

  it("falls back to localStorage when IndexedDB is unavailable", async () => {
    const localStorage = createStringStorage();
    const blockedIndexedDB = {
      open() {
        throw new DOMException("IndexedDB blocked", "SecurityError");
      },
    } as IDBFactory;
    const storage = createSleepOpsStorage({
      indexedDB: blockedIndexedDB,
      localStorage,
    });

    await storage.initialize();
    await expect(storage.writeCoreState("fallback core")).resolves.toEqual({
      durable: true,
      storage: "local-storage",
    });

    const reloadedStorage = createSleepOpsStorage({
      indexedDB: blockedIndexedDB,
      localStorage,
    });
    expect(await reloadedStorage.readCoreState()).toBe("fallback core");
  });

  it("reports memory-only writes as non-durable when browser storage is blocked", async () => {
    const blockedStorage: StringStorage = {
      getItem() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
      setItem() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    };
    const storage = createSleepOpsStorage({
      indexedDB: null,
      localStorage: blockedStorage,
    });

    await storage.initialize();
    await expect(storage.writeProfilerData("memory profiler")).resolves.toEqual(
      {
        durable: false,
        storage: "memory",
      },
    );
    expect(await storage.readProfilerData()).toBe("memory profiler");
  });

  it("reconciles a newer localStorage fallback into IndexedDB", async () => {
    const localStorage = createStringStorage();
    const indexedDbStorage = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage,
    });
    await indexedDbStorage.writeCoreState("indexeddb revision");

    const fallbackStorage = createSleepOpsStorage({
      indexedDB: null,
      localStorage,
    });
    await fallbackStorage.writeCoreState("newer fallback revision");

    const reconciledStorage = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage,
    });
    expect(await reconciledStorage.readCoreState()).toBe(
      "newer fallback revision",
    );

    const indexedDbOnly = createSleepOpsStorage({
      databaseName: DATABASE_NAME,
      indexedDB,
      localStorage: null,
    });
    expect(await indexedDbOnly.readCoreState()).toBe(
      "newer fallback revision",
    );
  });
});

function createStringStorage(initial: Record<string, string> = {}): StringStorage {
  const values = new Map(Object.entries(initial));

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
