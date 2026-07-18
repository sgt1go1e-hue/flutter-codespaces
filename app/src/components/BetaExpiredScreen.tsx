// ベータテスト期間(既定14日)が終了した端末に表示する画面。
// 作図画面・過去の図面などアプリ本体へは一切遷移させない。
export function BetaExpiredScreen() {
  return (
    <div className="app">
      <div className="beta-screen">
        <div className="beta-card">
          <div className="beta-title">テスト期間が終了しました</div>
          <p className="beta-body">
            ベータ版のテストにご協力いただき、ありがとうございました。
            <br />
            引き続き感想やご意見があれば、DMでお気軽にお寄せください。
          </p>
        </div>
      </div>
    </div>
  )
}
