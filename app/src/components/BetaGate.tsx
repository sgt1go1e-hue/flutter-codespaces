import App from '../App'
import { BetaExpiredScreen } from './BetaExpiredScreen'
import { isBetaLockEnabled, getBetaState } from '../lib/betaLock'

// ルーティングの最上位。VITE_BETA_LOCK が有効なビルドでだけ期限切れ画面を挟む。
// 未設定(永久版の通常ビルド)なら常に <App /> をそのまま返し、既存の起動フローに
// 一切影響しない。
//
// 合言葉(パスワード)による認証は撤廃したので、期限日を過ぎていない限りURLを
// 開いた時点でそのままホーム画面が出る。判定は現在時刻と固定期限日の比較だけで、
// 端末に何も保存しない。
export function BetaGate() {
  if (isBetaLockEnabled() && getBetaState() === 'expired') return <BetaExpiredScreen />
  return <App />
}
