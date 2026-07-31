const APP_CACHE = "esporte-fai-app-v7";
const MEDIA_CACHE = "esporte-fai-media-v1";
const APP_SHELL = ["/", "/manifest.json", "/esporte-fai-logo.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(prepareAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("esporte-fai-app-") && key !== APP_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/offline-media/")) {
    event.respondWith(respondWithOfflineMedia(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(respondWithNavigation(event.request));
    return;
  }

  if (
    url.origin === location.origin &&
    (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json")
  ) {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok && isExpectedAssetResponse(url.pathname, response)) {
          await cache.put(event.request, response.clone());
        }
        return response;
      })
    );
  }
});

async function prepareAppShell() {
  const cache = await caches.open(APP_CACHE);
  await cache.addAll(APP_SHELL);
  const indexResponse = await cache.match("/");
  if (indexResponse) {
    await cacheReferencedAssets(cache, indexResponse);
  }
}

async function respondWithNavigation(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
      await cache.put("/", response.clone());
      await cacheReferencedAssets(cache, response);
    }
    return response;
  } catch {
    return (await cache.match("/")) || new Response("Aplicativo indisponível offline.", { status: 503 });
  }
}

async function cacheReferencedAssets(cache, htmlResponse) {
  const html = await htmlResponse.clone().text();
  const paths = Array.from(
    new Set(
      Array.from(
        html.matchAll(/(?:src|href)="((?:\/|\.\.\/|\.\/)assets\/[^"]+\.(?:js|css))"/g),
        (match) => new URL(match[1], `${location.origin}/`).pathname
      )
    )
  );
  await Promise.all(
    paths.map(async (assetPath) => {
      try {
        const response = await fetch(assetPath);
        if (response.ok && isExpectedAssetResponse(assetPath, response)) {
          await cache.put(assetPath, response);
        }
      } catch {
        // Keep the last valid asset if a refresh is temporarily unavailable.
      }
    })
  );
}

function isExpectedAssetResponse(pathname, response) {
  const contentType = response.headers.get("content-type") || "";
  if (pathname.endsWith(".js")) return contentType.includes("javascript");
  if (pathname.endsWith(".css")) return contentType.includes("text/css");
  if (pathname.startsWith("/icons/")) return contentType.startsWith("image/");
  if (pathname === "/manifest.json") return contentType.includes("json") || contentType.includes("manifest");
  return false;
}

async function respondWithOfflineMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request.url);

  if (!cached) {
    return new Response("Offline media not found", { status: 404 });
  }

  const range = request.headers.get("range");
  if (!range) {
    return cached;
  }

  const blob = await cached.blob();
  const size = blob.size;
  const match = range.match(/bytes=(\d+)-(\d+)?/);

  if (!match) {
    return cached;
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= size || end >= size) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`
      }
    });
  }

  const sliced = blob.slice(start, end + 1, cached.headers.get("content-type") || "audio/mpeg");
  return new Response(sliced, {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("content-type") || "audio/mpeg",
      "Content-Length": String(sliced.size),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes"
    }
  });
}
