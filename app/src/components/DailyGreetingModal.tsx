// 日替わり挨拶メッセージの文言。季節や気分に応じて後から変更しやすいよう、
// ここに定数としてまとめておく。
export const DAILY_GREETING_MESSAGE = `おはようございます!!
今日も一日頑張りましょう
ご安全に!!`

interface Props {
  onClose: () => void
}

// 日付が変わってから最初にアプリを開いたときだけ表示する挨拶モーダル。
// 既存の免責事項モーダルと同じデザイン(disclaimer-*のクラス)に合わせる。
export function DailyGreetingModal({ onClose }: Props) {
  return (
    <div className="disclaimer-overlay">
      <div className="disclaimer-card" role="dialog" aria-modal="true">
        <div className="disclaimer-body daily-greeting-body">
          {DAILY_GREETING_MESSAGE.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="disclaimer-actions">
          <button className="disclaimer-agree" onClick={onClose}>
            ご安全に！！
          </button>
        </div>
      </div>
    </div>
  )
}
