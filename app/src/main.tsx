import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BetaGate } from './components/BetaGate'
import './styles.css'

// 起動直後(Reactがまだマウントできていない段階)のクラッシュだけを画面に出す。
// マウント後は、バックグラウンドのライブラリ(課金プラグイン等)が起こす
// 捕捉されないPromiseの失敗などで画面全体を巻き込んで消してしまわないよう、
// コンソールへのログのみにとどめる。
let appMounted = false

function showFatalError(err: unknown) {
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
  if (appMounted) {
    console.error('起動後のエラー(画面表示はスキップ):', msg)
    return
  }
  const el = document.getElementById('root')
  if (!el) return
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
  appMounted = true
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
