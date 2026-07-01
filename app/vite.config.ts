import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PWA化 (manifest / service worker) はフェーズ5で追加予定。
// フェーズ1では開発サーバーの設定のみ。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
  },
})
