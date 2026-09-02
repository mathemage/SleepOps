import { SLEEPOPS_STATE_STORAGE_KEY } from "./sleepops-state";

export const MORNING_ROUTINE_PROFILER_LEGACY_KEY =
  "sleepops.morningRoutineProfiler.v1";
export const SLEEPOPS_STORAGE_FALLBACK_KEY = "sleepops.localState.v1";
export const SLEEPOPS_STORAGE_DATABASE_NAME = "sleepops";
export const SLEEPOPS_STORAGE_DATABASE_VERSION = 1;

const DOCUMENT_STORE_NAME = "documents";
const DOCUMENT_KEY = "sleepops";

export type StringStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

export type SleepOpsStorageDocumentV1 = {
  schemaVersion: 1;
  revision: number;
  records: {
    coreState: string | null;
    morningRoutineProfiler: string | null;
    dailyPlanHistory: string | null;
  };
  migratedV1: {
    coreState: string | null;
    morningRoutineProfiler: string | null;
  };
};

export type SleepOpsStorageWriteResult = {
  durable: boolean;
  storage: "indexeddb" | "local-storage" | "memory";
};

type SleepOpsRecordKey = keyof SleepOpsStorageDocumentV1["records"];

type SleepOpsStorageOptions = {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  localStorage?: StringStorage | null;
};

export type SleepOpsStorage = {
  initialize: () => Promise<void>;
  getCoreStateSnapshot: () => string | null;
  getProfilerDataSnapshot: () => string | null;
  readCoreState: () => Promise<string | null>;
  readProfilerData: () => Promise<string | null>;
  readDailyPlanHistory: () => Promise<string | null>;
  writeCoreState: (raw: string) => Promise<SleepOpsStorageWriteResult>;
  writeProfilerData: (raw: string) => Promise<SleepOpsStorageWriteResult>;
  writeDailyPlanHistory: (
    raw: string,
  ) => Promise<SleepOpsStorageWriteResult>;
  subscribeToProfilerData: (listener: () => void) => () => void;
};

export function serializeSleepOpsStorageDocument(
  document: SleepOpsStorageDocumentV1,
): string {
  return JSON.stringify(document);
}

export function parseSleepOpsStorageDocument(
  raw: string | null,
): SleepOpsStorageDocumentV1 | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Partial<SleepOpsStorageDocumentV1>;
    if (
      candidate.schemaVersion !== 1 ||
      !Number.isSafeInteger(candidate.revision) ||
      (candidate.revision ?? -1) < 0 ||
      !isRecordSet(candidate.records) ||
      !isMigrationArchive(candidate.migratedV1)
    ) {
      return null;
    }

    return candidate as SleepOpsStorageDocumentV1;
  } catch {
    return null;
  }
}

export function createSleepOpsStorage(
  options: SleepOpsStorageOptions = {},
): SleepOpsStorage {
  const databaseName = options.databaseName ?? SLEEPOPS_STORAGE_DATABASE_NAME;
  const indexedDBFactory = Object.hasOwn(options, "indexedDB")
    ? (options.indexedDB ?? null)
    : getBrowserIndexedDB();
  const localStorage = Object.hasOwn(options, "localStorage")
    ? (options.localStorage ?? null)
    : getBrowserLocalStorage();
  const memoryStorage = new Map<string, string>();
  const profilerListeners = new Set<() => void>();
  let currentDocument =
    readFallbackDocument(localStorage, memoryStorage) ??
    readLegacyV1Document(localStorage, memoryStorage);
  let database: IDBDatabase | null = null;
  let initializePromise: Promise<void> | null = null;
  let initialized = false;

  const initialize = () => {
    initializePromise ??= initializeStorage();
    return initializePromise;
  };

  async function initializeStorage(): Promise<void> {
    database = await openDatabase(indexedDBFactory, databaseName);
    const indexedDbDocument = database
      ? await readIndexedDbDocument(database)
      : null;
    const fallbackDocument = readFallbackDocument(localStorage, memoryStorage);
    const legacyDocument = readLegacyV1Document(localStorage, memoryStorage);
    const nextDocument = selectLatestDocument(
      indexedDbDocument,
      fallbackDocument ?? legacyDocument,
    );
    const profilerChanged =
      nextDocument.records.morningRoutineProfiler !==
      currentDocument.records.morningRoutineProfiler;

    currentDocument = nextDocument;
    persistFallbackDocument(currentDocument);
    if (database) {
      await writeIndexedDbDocument(database, currentDocument);
    }
    initialized = true;

    if (profilerChanged) {
      notifyProfilerListeners();
    }
  }

  async function readRecord(key: SleepOpsRecordKey): Promise<string | null> {
    await initialize();
    return currentDocument.records[key];
  }

  function writeRecord(
    key: SleepOpsRecordKey,
    raw: string,
  ): Promise<SleepOpsStorageWriteResult> {
    if (!initialized) {
      return initialize().then(() => writeRecord(key, raw));
    }

    currentDocument = {
      ...currentDocument,
      revision: currentDocument.revision + 1,
      records: {
        ...currentDocument.records,
        [key]: raw,
      },
    };

    const localStorageDurable = persistFallbackDocument(currentDocument);
    if (key === "coreState") {
      writeCachedString(
        SLEEPOPS_STATE_STORAGE_KEY,
        raw,
        localStorage,
        memoryStorage,
      );
    } else if (key === "morningRoutineProfiler") {
      writeCachedString(
        MORNING_ROUTINE_PROFILER_LEGACY_KEY,
        raw,
        localStorage,
        memoryStorage,
      );
      notifyProfilerListeners();
    }

    const indexedDbWrite = database
      ? writeIndexedDbDocument(database, currentDocument)
      : Promise.resolve(false);

    return indexedDbWrite.then((indexedDbDurable) => {
      if (indexedDbDurable) {
        return { durable: true, storage: "indexeddb" };
      }
      if (localStorageDurable) {
        return { durable: true, storage: "local-storage" };
      }
      return { durable: false, storage: "memory" };
    });
  }

  function persistFallbackDocument(
    document: SleepOpsStorageDocumentV1,
  ): boolean {
    return writeCachedString(
      SLEEPOPS_STORAGE_FALLBACK_KEY,
      serializeSleepOpsStorageDocument(document),
      localStorage,
      memoryStorage,
    );
  }

  function notifyProfilerListeners() {
    profilerListeners.forEach((listener) => listener());
  }

  function subscribeToProfilerData(listener: () => void) {
    profilerListeners.add(listener);

    const handleStorage = (event: Event) => {
      const storageEvent = event as StorageEvent;
      if (
        storageEvent.key !== SLEEPOPS_STORAGE_FALLBACK_KEY &&
        storageEvent.key !== MORNING_ROUTINE_PROFILER_LEGACY_KEY
      ) {
        return;
      }

      const externalDocument =
        readFallbackDocument(localStorage, memoryStorage) ??
        readLegacyV1Document(localStorage, memoryStorage);
      if (externalDocument.revision >= currentDocument.revision) {
        currentDocument = externalDocument;
        notifyProfilerListeners();
      }
    };

    globalThis.addEventListener?.("storage", handleStorage);
    return () => {
      profilerListeners.delete(listener);
      globalThis.removeEventListener?.("storage", handleStorage);
    };
  }

  return {
    initialize,
    getCoreStateSnapshot: () => currentDocument.records.coreState,
    getProfilerDataSnapshot: () =>
      currentDocument.records.morningRoutineProfiler,
    readCoreState: () => readRecord("coreState"),
    readProfilerData: () => readRecord("morningRoutineProfiler"),
    readDailyPlanHistory: () => readRecord("dailyPlanHistory"),
    writeCoreState: (raw) => writeRecord("coreState", raw),
    writeProfilerData: (raw) => writeRecord("morningRoutineProfiler", raw),
    writeDailyPlanHistory: (raw) => writeRecord("dailyPlanHistory", raw),
    subscribeToProfilerData,
  };
}

const browserStorage = createSleepOpsStorage();

export const initializeSleepOpsStorage = browserStorage.initialize;
export const readCoreStateSnapshot = browserStorage.getCoreStateSnapshot;
export const readProfilerDataSnapshot = browserStorage.getProfilerDataSnapshot;
export const readCoreState = browserStorage.readCoreState;
export const readDailyPlanHistory = browserStorage.readDailyPlanHistory;
export const writeCoreState = browserStorage.writeCoreState;
export const writeDailyPlanHistory = browserStorage.writeDailyPlanHistory;
export const writeProfilerData = browserStorage.writeProfilerData;
export const subscribeToProfilerData = browserStorage.subscribeToProfilerData;

function readFallbackDocument(
  storage: StringStorage | null,
  memoryStorage: Map<string, string>,
): SleepOpsStorageDocumentV1 | null {
  return parseSleepOpsStorageDocument(
    readCachedString(SLEEPOPS_STORAGE_FALLBACK_KEY, storage, memoryStorage),
  );
}

function readLegacyV1Document(
  storage: StringStorage | null,
  memoryStorage: Map<string, string>,
): SleepOpsStorageDocumentV1 {
  const coreState = readCachedString(
    SLEEPOPS_STATE_STORAGE_KEY,
    storage,
    memoryStorage,
  );
  const morningRoutineProfiler = readCachedString(
    MORNING_ROUTINE_PROFILER_LEGACY_KEY,
    storage,
    memoryStorage,
  );

  return {
    schemaVersion: 1,
    revision: 0,
    records: {
      coreState,
      morningRoutineProfiler,
      dailyPlanHistory: null,
    },
    migratedV1: {
      coreState,
      morningRoutineProfiler,
    },
  };
}

function selectLatestDocument(
  indexedDbDocument: SleepOpsStorageDocumentV1 | null,
  fallbackDocument: SleepOpsStorageDocumentV1,
): SleepOpsStorageDocumentV1 {
  if (!indexedDbDocument) {
    return fallbackDocument;
  }

  return fallbackDocument.revision > indexedDbDocument.revision
    ? fallbackDocument
    : indexedDbDocument;
}

function isRecordSet(
  value: unknown,
): value is SleepOpsStorageDocumentV1["records"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const records = value as Record<string, unknown>;
  return (
    isStringOrNull(records.coreState) &&
    isStringOrNull(records.morningRoutineProfiler) &&
    isStringOrNull(records.dailyPlanHistory)
  );
}

function isMigrationArchive(
  value: unknown,
): value is SleepOpsStorageDocumentV1["migratedV1"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const archive = value as Record<string, unknown>;
  return (
    isStringOrNull(archive.coreState) &&
    isStringOrNull(archive.morningRoutineProfiler)
  );
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function readCachedString(
  key: string,
  storage: StringStorage | null,
  memoryStorage: Map<string, string>,
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
    return memoryStorage.get(key) ?? null;
  } catch {
    return memoryStorage.get(key) ?? null;
  }
}

function writeCachedString(
  key: string,
  value: string,
  storage: StringStorage | null,
  memoryStorage: Map<string, string>,
): boolean {
  memoryStorage.set(key, value);
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

async function openDatabase(
  indexedDBFactory: IDBFactory | null,
  databaseName: string,
): Promise<IDBDatabase | null> {
  if (!indexedDBFactory) {
    return null;
  }

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDBFactory.open(
        databaseName,
        SLEEPOPS_STORAGE_DATABASE_VERSION,
      );
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const openedDatabase = request.result;
      if (!openedDatabase.objectStoreNames.contains(DOCUMENT_STORE_NAME)) {
        openedDatabase.createObjectStore(DOCUMENT_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readIndexedDbDocument(
  database: IDBDatabase,
): Promise<SleepOpsStorageDocumentV1 | null> {
  return new Promise((resolve) => {
    try {
      const request = database
        .transaction(DOCUMENT_STORE_NAME, "readonly")
        .objectStore(DOCUMENT_STORE_NAME)
        .get(DOCUMENT_KEY);
      request.onsuccess = () =>
        resolve(
          typeof request.result === "string"
            ? parseSleepOpsStorageDocument(request.result)
            : null,
        );
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeIndexedDbDocument(
  database: IDBDatabase,
  document: SleepOpsStorageDocumentV1,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(DOCUMENT_STORE_NAME, "readwrite");
      transaction.objectStore(DOCUMENT_STORE_NAME).put(
        serializeSleepOpsStorageDocument(document),
        DOCUMENT_KEY,
      );
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function getBrowserLocalStorage(): StringStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function getBrowserIndexedDB(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}
