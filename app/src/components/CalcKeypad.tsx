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
  /**
   * useStateのsetterをそのまま渡す想定(値だけでなく関数更新も受け付ける)。
   * 連打時、propsのcalc(前回レンダー時点のスナップショット)を直接使って
   * 次の状態を計算すると、複数回のタップがバッチ処理された場合に古い
   * calcを元にした計算が後勝ちで上書きし合い、入力が欠落することがある。
   * 関数更新(常に最新のstateを引数で受け取る)にすることで、連打しても
   * 取りこぼさないようにする。
   */
  onChange: (updater: CalcState | ((prev: CalcState) => CalcState)) => void
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
export function CalcKeypad({ onChange, onEqual }: Props) {
  function pressDigit(d: string) {
    onChange((prev) => calcPressDigit(prev, d))
  }
  function pressOp(op: '+' | '-') {
    onChange((prev) => calcPressOp(prev, op))
  }

  return (
    <div className="qc-keypad">
      <KeyButton label="7" onClick={() => pressDigit('7')} gridColumn="1" gridRow="1" />
      <KeyButton label="8" onClick={() => pressDigit('8')} gridColumn="2" gridRow="1" />
      <KeyButton label="9" onClick={() => pressDigit('9')} gridColumn="3" gridRow="1" />
      <KeyButton
        label="±"
        variant="op"
        onClick={() => onChange((prev) => calcPressSign(prev))}
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
        onClick={() => onChange((prev) => calcPressDot(prev))}
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
        onClick={() => onChange(() => calcPressClear())}
        gridColumn="1"
        gridRow="5"
      />
      <KeyButton
        label="BS"
        variant="clear"
        onClick={() => onChange((prev) => calcPressBackspace(prev))}
        gridColumn="2 / span 2"
        gridRow="5"
      />
    </div>
  )
}
