import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BetaGate } from './components/BetaGate'
import './styles.css'

// 実機で「今動いているのが本当に最新ビルドか」を目視確認するための一時的な帯。
// 動作確認できたら削除する。
const buildBanner = document.createElement('div')
buildBanner.textContent = 'BUILD MARKER 2026-08-26-2214'
buildBanner.style.cssText =
  'position:fixed;top:0;left:0;right:0;z-index:999999;background:#e11d48;color:#fff;' +
  'font-size:12px;line-height:1.4;padding:4px 8px;text-align:center;'
document.body.prepend(buildBanner)

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
