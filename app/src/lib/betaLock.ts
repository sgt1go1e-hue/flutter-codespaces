// ベータ期間ロック。Instagram DM経由でテスト協力者にのみアプリを配布するための、
// 期間限定アクセス制御。ビルド時の環境変数 VITE_BETA_LOCK="true" のときだけ有効になる。
// 未設定/false（＝永久版の通常ビルド）では isBetaLockEnabled() が false を返し、
// 呼び出し側(BetaGate)がこのモジュールの判定を一切行わずに素通りする。

/** 合言葉。将来変更しやすいよう定数にまとめる。 */
export const BETA_PASSWORD = '1go1e'
/** 解除から何日でテスト期間終了とするか。 */
export const BETA_DAYS = 14
const BETA_MS = BETA_DAYS * 24 * 60 * 60 * 1000

const UNLOCKED_KEY = 'isome_beta_unlocked'
const UNLOCK_AT_KEY = 'isome_beta_unlock_at'

export function isBetaLockEnabled(): boolean {
  return import.meta.env.VITE_BETA_LOCK === 'true'
}

/** 前後の空白を除去し、大文字・小文字を区別せず比較する。 */
export function checkBetaPassword(input: string): boolean {
  return input.trim().toLowerCase() === BETA_PASSWORD.toLowerCase()
}

export type BetaState = 'locked' | 'unlocked' | 'expired'

/**
 * localStorage を確認して現在の状態を返す。localStorageが使えない/値が壊れている
 * 場合は安全側に倒して 'locked'（合言葉入力画面）を返す。
 */
export function getBetaState(): BetaState {
  try {
    const unlocked = localStorage.getItem(UNLOCKED_KEY) === 'true'
    if (!unlocked) return 'locked'
    const unlockAtRaw = localStorage.getItem(UNLOCK_AT_KEY)
    const unlockAt = unlockAtRaw ? new Date(unlockAtRaw).getTime() : NaN
    if (Number.isNaN(unlockAt)) return 'locked'
    return Date.now() - unlockAt >= BETA_MS ? 'expired' : 'unlocked'
  } catch {
    return 'locked'
  }
}

/** 合言葉通過時に、解除記録を保存する。保存に失敗しても例外は投げない。 */
export function unlockBeta(): void {
  try {
    localStorage.setItem(UNLOCKED_KEY, 'true')
    localStorage.setItem(UNLOCK_AT_KEY, new Date().toISOString())
  } catch {
    // 保存できない環境では次回起動時も合言葉入力画面に戻る（安全側）
  }
}
