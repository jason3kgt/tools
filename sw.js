// NTD Mechanical PWA Service Worker
var CACHE = 'ntd-tools-v1';
var FILES = [
  '/tools/',
  '/tools/index.html',
  '/tools/startup-checklist.html',
  '/tools/field-assessment.html',
  '/tools/manifest.json',
  '/tools/icon-192.png',
  '/tools/icon-512.png'
];

// Install — cache all files
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(cache){
      return cache.addAll(FILES);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', function(e){
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(response){
        var clone = response.clone();
        caches.open(CACHE).then(function(cache){
          cache.put(e.request, clone);
        });
        return response;
      });
    }).catch(function(){
      // Offline fallback
      return caches.match('/tools/index.html');
    })
  );
});
