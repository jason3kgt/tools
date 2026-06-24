var CACHE='ntd-tools-v11';
var ASSETS=[
  './',
  './index.html',
  './startup-checklist.html',
  './sales-assessment.html',
  './pm-checklist.html',
  './equipment-survey.html',
  './project-manager.html',
  './job-prep.html',
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
