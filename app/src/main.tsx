import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

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
