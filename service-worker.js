'use strict';

/* Bump this on every deploy that changes app-shell files so old caches get cleaned up. */
var CACHE_VERSION = 'medlearn-v2';
var SHELL_CACHE = CACHE_VERSION + '-shell';
var DATA_CACHE = CACHE_VERSION + '-data';

/* SW scope-relative base (works whether the site is served at the domain root
   or at a GitHub Pages project subpath like /my-repo/). */
var SCOPE = self.registration ? self.registration.scope : self.location.href;

var SHELL_FILES = [
  '',
  'index.html',
  'app/app.css',
  'app/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'courses/courses.json',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(
        SHELL_FILES.map(function (path) {
          var url = new URL(path, SCOPE).toString();
          return cache.add(url).catch(function (e) {
            console.warn('[sw] failed to precache', url, e);
          });
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.indexOf(CACHE_VERSION) !== 0; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function isCourseDataRequest(url) {
  return url.pathname.indexOf('/courses/') !== -1;
}

/* Network-first for navigations (so deploys are picked up quickly), falling
   back to the cached app shell when offline. */
function handleNavigate(event) {
  event.respondWith(
    fetch(event.request).then(function (res) {
      var copy = res.clone();
      caches.open(SHELL_CACHE).then(function (cache) { cache.put(event.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        return cached || caches.match(new URL('index.html', SCOPE).toString());
      });
    })
  );
}

/* Stale-while-revalidate for course content: instant response from cache when
   available (works offline), while quietly refreshing the cache in the
   background whenever the network is up. */
function handleCourseData(event) {
  event.respondWith(
    caches.open(DATA_CACHE).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        var networkFetch = fetch(event.request).then(function (res) {
          if (res && res.ok) cache.put(event.request, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || networkFetch;
      });
    })
  );
}

/* Cache-first for the static app shell (CSS/JS/icons) — fast and reliable
   offline; a new deploy is picked up because CACHE_VERSION changes the
   cache name and the install step re-fetches everything. */
function handleShellAsset(event) {
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL_CACHE).then(function (cache) { cache.put(event.request, copy); });
        return res;
      });
    })
  );
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin requests

  if (req.mode === 'navigate') { handleNavigate(event); return; }
  if (isCourseDataRequest(url)) { handleCourseData(event); return; }
  handleShellAsset(event);
});
