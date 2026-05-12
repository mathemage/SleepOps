const CACHE_NAME = "sleepops-app-shell-v1";
const APP_SHELL_CACHE_PREFIX = "sleepops-app-shell-";
const APP_SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(cacheUrls(APP_SHELL_URLS));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(APP_SHELL_CACHE_PREFIX) &&
                cacheName !== CACHE_NAME,
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (!Array.isArray(event.data?.urls)) {
    return;
  }

  event.waitUntil(cacheUrls(event.data.urls));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/icon-192.png",
      badge: payload.badge || "/badge-96.png",
      tag: payload.tag || "sleepops-shutdown",
      data: {
        url: payload.url || "/",
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href;

  event.waitUntil(focusOrOpenWindow(targetUrl));
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(appShellRequest(), response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match(appShellRequest())) ??
      new Response("SleepOps is offline and the app shell is not cached yet.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        status: 503,
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("SleepOps asset unavailable offline.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      status: 503,
    });
  }
}

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  const uniqueUrls = Array.from(new Set(urls));

  await Promise.all(
    uniqueUrls.map(async (url) => {
      const request = toSameOriginRequest(url);
      if (!request) {
        return;
      }

      try {
        const response = await fetch(request, { cache: "reload" });
        if (response.ok) {
          await cache.put(request, response.clone());
        }
      } catch {
        // A missed optional shell asset should not prevent the app shell from caching.
      }
    }),
  );
}

function toSameOriginRequest(url) {
  try {
    const parsed = new URL(url, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      return null;
    }

    return new Request(parsed.href, { credentials: "same-origin" });
  } catch {
    return null;
  }
}

function appShellRequest() {
  return new Request(new URL("/", self.location.origin).href, {
    credentials: "same-origin",
  });
}

function isCacheableAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/badge-96.png"
  );
}

function readPushPayload(event) {
  if (!event.data) {
    return {
      title: "SleepOps shutdown",
      body: "Start shutdown now.",
    };
  }

  try {
    return event.data.json();
  } catch {
    return {
      title: "SleepOps shutdown",
      body: event.data.text(),
    };
  }
}

async function focusOrOpenWindow(targetUrl) {
  const windows = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });

  for (const windowClient of windows) {
    if (windowClient.url === targetUrl && "focus" in windowClient) {
      return windowClient.focus();
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl);
  }
}
