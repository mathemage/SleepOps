"use client";

import { useEffect } from "react";

const CACHE_MESSAGE_TYPE = "SLEEPOPS_CACHE_APP_SHELL";
const APP_SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/badge-96.png",
];

export function PwaRuntime() {
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      typeof navigator.serviceWorker?.register !== "function"
    ) {
      return;
    }

    let disposed = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const readyRegistration = await navigator.serviceWorker.ready;

        if (disposed) {
          return;
        }

        cacheAppShell(readyRegistration);
        cacheAppShell(registration);
      } catch {
        // The app remains fully usable online if service worker registration fails.
      }
    };

    const handleControllerChange = () => {
      void navigator.serviceWorker.ready.then(cacheAppShell).catch(() => {});
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );
    void register();

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  return null;
}

function cacheAppShell(registration: ServiceWorkerRegistration) {
  const worker =
    registration.active ??
    registration.waiting ??
    registration.installing ??
    navigator.serviceWorker.controller;

  worker?.postMessage({
    type: CACHE_MESSAGE_TYPE,
    urls: collectAppShellUrls(),
  });
}

function collectAppShellUrls(): string[] {
  const urls = new Set<string>(
    APP_SHELL_URLS.map((url) => new URL(url, window.location.origin).href),
  );

  for (const entry of performance.getEntriesByType("resource")) {
    const resource = entry as PerformanceResourceTiming;
    const url = new URL(resource.name);

    if (url.origin !== window.location.origin) {
      continue;
    }

    if (url.pathname.startsWith("/_next/static/")) {
      urls.add(url.href);
    }
  }

  return Array.from(urls);
}
