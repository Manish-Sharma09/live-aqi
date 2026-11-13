/* Live AQI service worker — background air-quality alerts (Web Push). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let message = null;
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const res = await fetch('/api/alerts/pending', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (res.ok) message = await res.json();
        }
      } catch (_) {
        /* fall through to a generic notification */
      }
      // Browsers require a visible notification for every push.
      const title = (message && message.title) || 'Air quality update';
      const body =
        (message && message.body) || 'Air quality changed at your saved location. Open Live AQI for the latest reading.';
      const urgent = Boolean(message && message.kind === 'severe');
      await self.registration.showNotification(title, {
        body,
        tag: 'live-aqi-alert',
        renotify: true,
        requireInteraction: urgent,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data: { url: (message && message.url) || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser rotated the subscription; the alerts page re-subscribes on next visit.
  event.waitUntil(Promise.resolve());
});
