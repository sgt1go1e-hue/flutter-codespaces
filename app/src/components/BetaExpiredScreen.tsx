import { betaEndDateLabel } from '../lib/betaLock'

// ベータテスト期間(固定の期限日)が終了したあとに表示する画面。
// 作図画面・過去の図面などアプリ本体へは一切遷移させない。
export function BetaExpiredScreen() {
  return (
    <div className="app">
      <div className="beta-screen">
        <div className="beta-card">
          <div className="beta-title">テスト期間が終了しました</div>
          <p className="beta-body">
            {betaEndDateLabel()}をもって、ベータ版の公開を終了しました。
            <br />
            テストにご協力いただき、ありがとうございました。
            <br />
            引き続き感想やご意見があれば、DMでお気軽にお寄せください。
          </p>
        </div>
      </div>
    </div>
  )
}
