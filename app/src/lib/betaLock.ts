// ベータ期間ロック。Instagram DM経由でテスト協力者にのみアプリを配布するための、
// 期間限定アクセス制御。ビルド時の環境変数 VITE_BETA_LOCK="true" のときだけ有効になる。
// 未設定/false（＝永久版の通常ビルド）では isBetaLockEnabled() が false を返し、
// 呼び出し側(BetaGate)がこのモジュールの判定を一切行わずに素通りする。
//
// 【判定方式】以前は「合言葉で解除した日から14日」という端末ごとの経過日数で
// 判定していたが、テスターごとに開始日がバラバラで「いつ切れるか」が人によって
// 違ってしまうため、全員共通の固定期限日で判定する方式に変更した。
// 合言葉(パスワード)による認証も撤廃し、期限日前ならURLを開くだけで使える。

/** 期限日の既定値(JSTの日付)。ビルド時に VITE_BETA_END_DATE で上書きできる。 */
export const DEFAULT_BETA_END_DATE = '2026-09-15'

export function isBetaLockEnabled(): boolean {
  return import.meta.env.VITE_BETA_LOCK === 'true'
}

/**
 * 期限日(JSTの0時)のタイムスタンプ。'YYYY-MM-DD' として解釈し、日本時間の
 * その日の0時ちょうどを期限とする（この時刻を過ぎたらテスト期間終了）。
 * 値が壊れている場合は既定値にフォールバックする（環境変数の打ち間違いで
 * 全員がいきなり使えなくなる／逆に永久に使えてしまう、のどちらも避ける）。
 */
export function getBetaEndAt(): number {
  const raw = import.meta.env.VITE_BETA_END_DATE
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
    ? raw.trim()
    : DEFAULT_BETA_END_DATE
  const t = new Date(`${date}T00:00:00+09:00`).getTime()
  return Number.isNaN(t) ? new Date(`${DEFAULT_BETA_END_DATE}T00:00:00+09:00`).getTime() : t
}

/** 期限日の表示用文字列（例: 2026年9月15日）。期限切れ画面の案内に使う。 */
export function betaEndDateLabel(): string {
  return new Date(getBetaEndAt()).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  })
}

export type BetaState = 'unlocked' | 'expired'

/**
 * 現在の状態を返す。端末に何も保存せず、現在時刻と固定期限日の比較だけで
 * 決まるので、以前の方式で既に「期限切れ」になっていた端末も、この版では
 * 期限日前であれば必ず 'unlocked' に戻る。
 */
export function getBetaState(now: number = Date.now()): BetaState {
  return now >= getBetaEndAt() ? 'expired' : 'unlocked'
}
