
const CACHE_NAME = 'chatapp-v2';
const urlsToCache = [
  '/',
  '/chat',
  '/css/style.css',
  '/css/chat.css',
  '/socket.io/socket.io.js',
  '/images/icon.png',
  '/images/icon-512.png',
  '/sounds/notification.mp3'
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Familiarize yourself with the API and try to use it in your project
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
      .catch(() => caches.match('/'))
  );
});