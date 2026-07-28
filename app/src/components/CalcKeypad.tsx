import {
  calcPressDigit,
  calcPressDot,
  calcPressOp,
  calcPressSign,
  calcPressClear,
  calcPressBackspace,
  type CalcState,
} from '../lib/calcExpr'

interface Props {
  calc: CalcState
  onChange: (next: CalcState) => void
  /** ＝キーが押されたとき呼ぶ（押した時点のcalcを呼び出し側でcalcEvaluateして使う想定） */
  onEqual: () => void
}

function KeyButton({
  label,
  onClick,
  variant,
  gridColumn,
  gridRow,
}: {
  label: string
  onClick: () => void
  variant?: 'op' | 'equal' | 'clear'
  gridColumn?: string
  gridRow?: string
}) {
  const style =
    gridColumn || gridRow ? { gridColumn: gridColumn, gridRow: gridRow } : undefined
  return (
    <button
      type="button"
      className={`qc-key${variant ? ` qc-key-${variant}` : ''}`}
      style={style}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/**
 * クイック計算(芯引き)の「全体寸法」欄で使っているテンキー(数字＋±/＋/－/．/＝/C/BS)。
 * 見た目・キー配置ともクイック計算と完全に同じものを、詳細パネルの寸法入力欄
 * (AttributePanel.tsx)からも使い回せるよう、ここに切り出した(計算ロジック自体は
 * calcExpr.tsのまま、キー配置UIだけを共通化している)。
 */
export function CalcKeypad({ calc, onChange, onEqual }: Props) {
  function pressDigit(d: string) {
    onChange(calcPressDigit(calc, d))
  }
  function pressOp(op: '+' | '-') {
    onChange(calcPressOp(calc, op))
  }

  return (
    <div className="qc-keypad">
      <KeyButton label="7" onClick={() => pressDigit('7')} gridColumn="1" gridRow="1" />
      <KeyButton label="8" onClick={() => pressDigit('8')} gridColumn="2" gridRow="1" />
      <KeyButton label="9" onClick={() => pressDigit('9')} gridColumn="3" gridRow="1" />
      <KeyButton
        label="±"
        variant="op"
        onClick={() => onChange(calcPressSign(calc))}
        gridColumn="4"
        gridRow="1"
      />

      <KeyButton label="4" onClick={() => pressDigit('4')} gridColumn="1" gridRow="2" />
      <KeyButton label="5" onClick={() => pressDigit('5')} gridColumn="2" gridRow="2" />
      <KeyButton label="6" onClick={() => pressDigit('6')} gridColumn="3" gridRow="2" />
      <KeyButton label="＋" variant="op" onClick={() => pressOp('+')} gridColumn="4" gridRow="2" />

      <KeyButton label="1" onClick={() => pressDigit('1')} gridColumn="1" gridRow="3" />
      <KeyButton label="2" onClick={() => pressDigit('2')} gridColumn="2" gridRow="3" />
      <KeyButton label="3" onClick={() => pressDigit('3')} gridColumn="3" gridRow="3" />
      <KeyButton label="－" variant="op" onClick={() => pressOp('-')} gridColumn="4" gridRow="3" />

      <KeyButton label="0" onClick={() => pressDigit('0')} gridColumn="1 / span 2" gridRow="4" />
      <KeyButton
        label="."
        onClick={() => onChange(calcPressDot(calc))}
        gridColumn="3"
        gridRow="4"
      />
      <KeyButton
        label="＝"
        variant="equal"
        onClick={onEqual}
        gridColumn="4"
        gridRow="4 / span 2"
      />

      <KeyButton
        label="C"
        variant="clear"
        onClick={() => onChange(calcPressClear())}
        gridColumn="1"
        gridRow="5"
      />
      <KeyButton
        label="BS"
        variant="clear"
        onClick={() => onChange(calcPressBackspace(calc))}
        gridColumn="2 / span 2"
        gridRow="5"
      />
    </div>
  )
}
