import { useState } from 'react'
import { checkBetaPassword } from '../lib/betaLock'

interface Props {
  onUnlock: () => void
}

// ベータ版の合言葉入力画面。DMで合言葉を教えられたテスト協力者だけが
// ここを通過してアプリ本体へ進める。
export function BetaLockScreen({ onUnlock }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  function submit() {
    if (checkBetaPassword(value)) {
      onUnlock()
    } else {
      setError(true)
    }
  }

  return (
    <div className="app">
      <div className="beta-screen">
        <div className="beta-card">
          <div className="beta-title">アイソメ工房（ベータ版）</div>
          <p className="beta-body">
            テスト版のご利用ありがとうございます。DMでお伝えした合言葉を入力してください。
          </p>
          <input
            className="beta-input"
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="合言葉"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          {error && <p className="beta-error">合言葉が違います</p>}
          <button type="button" className="beta-primary" onClick={submit}>
            はじめる
          </button>
        </div>
      </div>
    </div>
  )
}
