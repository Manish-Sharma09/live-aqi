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
      // Browsers require a visible notification for every push. The title leads with
      // what to do ("😷 Wear a mask outside · Delhi"); the body lists the steps.
      const title = (message && message.title) || 'Air quality update';
      const body =
        (message && message.body) || 'Air quality changed at your saved location. Open Live AQI for the latest reading.';
      const kind = (message && message.kind) || 'worse';
      const urgent = kind === 'severe';
      const url = (message && message.url) || '/';
      await self.registration.showNotification(title, {
        body,
        tag: 'live-aqi-alert',
        renotify: true,
        requireInteraction: urgent,
        silent: false,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        // Its own rhythm per alert where the device honours it (some Android versions).
        vibrate: VIBRATE[kind] || VIBRATE.worse,
        actions: url === '/' ? [] : [{ action: 'advice', title: 'What to do' }],
        data: { url },
        timestamp: Date.now(),
      });
      // Web Push can't carry a custom sound; when a Live AQI page is in view, it
      // plays the Live AQI chime (NotificationManager.astro). One tab only.
      const windows = await self.clients.matchAll({ type: 'window' });
      const inView = windows.find((c) => c.focused) || windows.find((c) => c.visibilityState === 'visible');
      if (inView) inView.postMessage({ type: 'laqi:push-alert', kind });
    })(),
  );
});

/** Vibration per alert kind: falling double tap, urgent pulses, a light lift, a hello. */
const VIBRATE = {
  worse: [180, 90, 180],
  severe: [300, 120, 300, 120, 600],
  improved: [80, 60, 80, 60, 160],
  test: [120, 80, 120],
};

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/';
  // "What to do" opens the place's health advice; tapping the notification opens the page.
  const url = new URL(event.action === 'advice' ? `${path}#health` : path, self.location.origin).href;
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
  // The browser replaced (or expired) the subscription: subscribe again with the same
  // VAPID key and move the saved alert settings to the new endpoint. If this fails,
  // the alerts page re-syncs on the next visit.
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      if (!old) return;
      let sub = event.newSubscription || (await self.registration.pushManager.getSubscription());
      if (!sub && old.options && old.options.applicationServerKey) {
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: old.options.applicationServerKey,
        });
      }
      if (!sub || sub.endpoint === old.endpoint) return;
      await fetch('/api/alerts/resubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ oldEndpoint: old.endpoint, endpoint: sub.endpoint }),
      });
    })().catch(() => {
      /* best effort */
    }),
  );
});
