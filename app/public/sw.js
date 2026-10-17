// 配管アイソメ図 PWA の Service Worker。
// - 初回訪問後はオフラインでも起動できるよう、アプリシェルとハッシュ付き資産をキャッシュ。
// - HTML(ナビゲーション)は network-first（オンライン時は最新を取得、失敗時キャッシュ）。
// - JS/CSS/画像など同一オリジンの GET は cache-first（取得したら随時キャッシュ）。
const CACHE = 'piping-iso-v1'
const SHELL = [
  './',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // 個別に add（一部が失敗してもインストールを止めない）
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // HTML ナビゲーションは network-first（更新反映を優先、オフライン時はキャッシュ）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone()
          caches.open(CACHE).then((c) => c.put(req, clone))
          return res
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('./')),
        ),
    )
    return
  }

  // その他資産は cache-first（無ければ取得してキャッシュ）
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone()
            caches.open(CACHE).then((c) => c.put(req, clone))
          }
          return res
        }),
    ),
  )
})
