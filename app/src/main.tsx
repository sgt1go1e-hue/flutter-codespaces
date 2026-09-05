import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BetaGate } from './components/BetaGate'
import './styles.css'

function showFatalError(err: unknown) {
  const el = document.getElementById('root')
  if (!el) return
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
  el.innerHTML = `<pre style="white-space:pre-wrap;color:#fff;background:#900;padding:16px;font-size:12px;margin:0;">起動エラー:\n${msg.replace(/</g, '&lt;')}</pre>`
}

window.addEventListener('error', (e) => showFatalError(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason))

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BetaGate />
    </StrictMode>,
  )
} catch (err) {
  showFatalError(err)
}

// PWA: Service Worker を登録（本番のみ。dev では HMR を邪魔しないよう登録しない）。
// scope をアプリの base に合わせるため BASE_URL 配下の sw.js を登録する。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(swUrl).catch(() => {
      /* 登録失敗は致命的でないため無視 */
    })
  })
}
