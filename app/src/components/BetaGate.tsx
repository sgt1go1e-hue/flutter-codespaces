import { useState } from 'react'
import App from '../App'
import { BetaLockScreen } from './BetaLockScreen'
import { BetaExpiredScreen } from './BetaExpiredScreen'
import { isBetaLockEnabled, getBetaState, unlockBeta, type BetaState } from '../lib/betaLock'

// ルーティングの最上位。VITE_BETA_LOCK が有効なビルドでだけ合言葉/期限切れ
// 画面を挟む。未設定(永久版の通常ビルド)なら常に <App /> をそのまま返し、
// 既存の起動フローに一切影響しない。
export function BetaGate() {
  const enabled = isBetaLockEnabled()
  const [state, setState] = useState<BetaState>(() => (enabled ? getBetaState() : 'unlocked'))

  if (!enabled || state === 'unlocked') return <App />
  if (state === 'expired') return <BetaExpiredScreen />
  return (
    <BetaLockScreen
      onUnlock={() => {
        unlockBeta()
        setState(getBetaState())
      }}
    />
  )
}
