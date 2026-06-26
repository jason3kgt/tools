var CACHE='ntd-tools-v15';
var ASSETS=[
  './',
  './index.html',
  './startup-checklist.html',
  './startup-checklist-v2.html',
  './pm-checklist.html',
  './hvac-asset-survey.html',
  './equipment-survey.html',
  './equipment-survey-v2.html',
  './ntdStore.js',
  './pm-quoting.html',
  './project-manager.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS);}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }));
});
self.addEventListener('fetch',function(e){
  var url=e.request.url;
  if(url.indexOf('.html')>-1){
    e.respondWith(fetch(e.request).catch(function(){return caches.match(e.request);}));
  } else {
    e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request);}));
  }
});
self.addEventListener('message',function(e){if(e.data==='skipWaiting')self.skipWaiting();});
