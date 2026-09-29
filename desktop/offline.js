'use strict';

const target = new URLSearchParams(location.search).get('target');
document.getElementById('retry').addEventListener('click', () => {
  if (!target) return;
  try {
    const url = new URL(target);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password) return;
    if (url.origin === 'https://vantage.limnov.com' || (loopback && ['http:', 'https:'].includes(url.protocol))) {
      location.assign(url.toString());
    }
  } catch {
    // Invalid retry target: keep the local error page open.
  }
});
