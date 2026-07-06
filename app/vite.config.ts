import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PWA化 (manifest / service worker) はフェーズ5で追加予定。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 で待受（Codespaces のポート転送から到達可能に）
    port: 3000,
    strictPort: true, // 3000 が空いていなければ黙って別ポートに逃げず失敗させる
    // Codespaces / トンネル等、localhost 以外のホスト名からのアクセスを許可。
    // 未設定だと Vite5 が「Blocked request / This host is not allowed」で弾くことがある。
    allowedHosts: true,
    // https(443) 経由のプレビューでも HMR(ホットリロード)が繋がるようにする。
    hmr: { clientPort: 443 },
  },
})
