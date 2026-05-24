import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const serviceWorkerSource = await readFile(
  new URL("../sleepops/public/sw.js", import.meta.url),
  "utf8",
);

test("service worker does not register an unused push listener", () => {
  const { listeners } = loadServiceWorker();

  assert.equal(listeners.has("push"), false);
});

test("service worker install caching includes the root app shell", async () => {
  const { fetched, listeners } = loadServiceWorker();
  const installHandler = listeners.get("install");
  assert.equal(typeof installHandler, "function");

  let cachePromise = null;
  installHandler({
    waitUntil: (promise) => {
      cachePromise = promise;
    },
  });

  assert.ok(cachePromise);
  await cachePromise;
  assert.ok(fetched.includes("https://sleepops.test/"));
});

test("service worker message caching accepts only shell assets", async () => {
  const { fetched, listeners } = loadServiceWorker();

  await cacheMessageUrls(listeners, [
    "/",
    "/_next/static/app.js",
    "/icon-192.png",
    "/api/private",
    "https://example.invalid/_next/static/app.js",
  ]);

  assert.deepEqual(fetched, [
    "https://sleepops.test/",
    "https://sleepops.test/_next/static/app.js",
    "https://sleepops.test/icon-192.png",
  ]);
});

test("service worker message caching caps runtime asset requests", async () => {
  const { fetched, listeners } = loadServiceWorker();
  const urls = Array.from(
    { length: 85 },
    (_, index) => `/_next/static/chunk-${index}.js`,
  );

  await cacheMessageUrls(listeners, urls);

  assert.equal(fetched.length, 80);
  assert.equal(fetched.at(-1), "https://sleepops.test/_next/static/chunk-79.js");
});

function loadServiceWorker() {
  const listeners = new Map();
  const fetched = [];

  const context = {
    Array,
    Promise,
    Request,
    Response,
    Set,
    URL,
    caches: {
      keys: async () => [],
      open: async () => ({
        match: async () => null,
        put: async () => {},
      }),
    },
    fetch: async (request) => {
      fetched.push(request.url);
      return new Response("ok");
    },
    self: {
      clients: {
        claim: async () => {},
        matchAll: async () => [],
        openWindow: async () => {},
      },
      location: {
        origin: "https://sleepops.test",
      },
      addEventListener: (type, handler) => {
        listeners.set(type, handler);
      },
      skipWaiting: () => {},
    },
  };

  vm.runInNewContext(serviceWorkerSource, context);

  return { fetched, listeners };
}

async function cacheMessageUrls(listeners, urls) {
  const messageHandler = listeners.get("message");
  assert.equal(typeof messageHandler, "function");

  let cachePromise = null;
  messageHandler({
    data: { urls },
    waitUntil: (promise) => {
      cachePromise = promise;
    },
  });

  assert.ok(cachePromise);
  await cachePromise;
}
