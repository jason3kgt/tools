// NTD Mechanical PWA Service Worker — auto-versioning
var CACHE_PREFIX = 'ntd-tools-';
var FILES = [
  './',
  './index.html',
  './startup-checklist.html',
  './field-assessment.html',
  './equipment-survey.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Generate a version hash by fetching index.html and reading its Last-Modified header
function getServerVersion(){
  return fetch('./index.html', {method:'HEAD', cache:'no-store'})
    .then(function(r){
      return r.headers.get('last-modified') || r.headers.get('etag') || Date.now().toString();
    })
    .catch(function(){ return 'offline'; });
}

// Install — cache all files with current version
self.addEventListener('install', function(e){
  e.waitUntil(
    getServerVersion().then(function(ver){
      var cacheName = CACHE_PREFIX + ver;
      return caches.open(cacheName).then(function(cache){
        return cache.addAll(FILES);
      });
    })
  );
  self.skipWaiting();
});

// Activate — check for updates and clean old caches
self.addEventListener('activate', function(e){
  e.waitUntil(
    getServerVersion().then(function(ver){
      var currentCache = CACHE_PREFIX + ver;
      return caches.keys().then(function(keys){
        return Promise.all(
          keys.filter(function(k){
            return k.startsWith(CACHE_PREFIX) && k !== currentCache;
          }).map(function(k){
            console.log('NTD SW: Deleting old cache', k);
            return caches.delete(k);
          })
        );
      }).then(function(){
        // Re-cache all files with new version
        return caches.open(currentCache).then(function(cache){
          return cache.addAll(FILES);
        });
      });
    })
  );
  self.clients.claim();
});

// Fetch — network first (to catch updates), fall back to cache
self.addEventListener('fetch', function(e){
  // For HTML files, always try network first so updates are picked up
  var isHTML = e.request.url.endsWith('.html') || e.request.url.endsWith('/');
  
  if(isHTML){
    e.respondWith(
      fetch(e.request).then(function(response){
        // Cache the fresh response
        var clone = response.clone();
        caches.open(CACHE_PREFIX + 'current').then(function(cache){
          cache.put(e.request, clone);
        });
        return response;
      }).catch(function(){
        // Offline — serve from any available cache
        return caches.match(e.request).then(function(cached){
          return cached || caches.match('./index.html');
        });
      })
    );
  } else {
    // For assets (icons, manifest), cache first
    e.respondWith(
      caches.match(e.request).then(function(cached){
        return cached || fetch(e.request).then(function(response){
          var clone = response.clone();
          caches.open(CACHE_PREFIX + 'assets').then(function(cache){
            cache.put(e.request, clone);
          });
          return response;
        });
      }).catch(function(){
        return caches.match('./index.html');
      })
    );
  }
});

// Listen for messages from the app to force update
self.addEventListener('message', function(e){
  if(e.data === 'skipWaiting') self.skipWaiting();
});
