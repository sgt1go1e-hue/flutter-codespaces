// 「全体寸法」欄に一体化した簡易電卓（足し算・引き算のみ）の状態機械。
// 現場で「図面寸法に手直し分を足し引きする」動作を、独立した電卓画面を
// 作らずその場で完結させるためのもの。
export interface CalcState {
  /** 確定済みの累計値 */
  accumulated: number
  /** 次に確定する数値へ適用する演算子（まだ数値を1つも確定していなければnull） */
  pendingOp: '+' | '-' | null
  /** 入力中の数値の文字列表現（空文字なら未入力） */
  current: string
  /** 画面表示用の式全体（例: "2820+300-25"） */
  display: string
  error?: string
}

const MAX_DIGITS = 5
const MAX_VALUE = 99999

export const initialCalcState: CalcState = {
  accumulated: 0,
  pendingOp: null,
  current: '',
  display: '',
}

/** 数値1個分の桁数（符号・小数点を除く整数部+小数部の桁数）が上限以内か */
function withinDigitLimit(s: string): boolean {
  const digits = s.replace(/[-.]/g, '')
  return digits.length <= MAX_DIGITS
}

function formatNum(n: number): string {
  // 小数の浮動小数点誤差を丸めつつ、末尾の不要な0は出さない
  return String(Math.round(n * 1000) / 1000)
}

/** 指定した1文字ぶんの数値を起点に、新しい状態を作る（外部からの初期値セット用） */
export function calcStateFromValue(value: number): CalcState {
  return {
    accumulated: 0,
    pendingOp: null,
    current: formatNum(value),
    display: formatNum(value),
  }
}

/** 現在入力中／確定済みの合計値。=を押さなくても常に参照できる。 */
export function calcCurrentTotal(state: CalcState): number | undefined {
  if (state.error) return undefined
  const cur = state.current === '' ? 0 : Number(state.current)
  if (Number.isNaN(cur)) return undefined
  if (state.pendingOp == null && state.current === '') return undefined
  return state.accumulated + cur
}

function pushDigit(state: CalcState, d: string): CalcState {
  if (state.error) return state
  const next = state.current + d
  if (!withinDigitLimit(next)) return state
  return { ...state, current: next, display: state.display + d }
}

export function calcPressDigit(state: CalcState, digit: string): CalcState {
  return pushDigit(state, digit)
}

export function calcPressDot(state: CalcState): CalcState {
  if (state.error) return state
  if (state.current.includes('.')) return state
  const next = state.current === '' ? '0.' : state.current + '.'
  return { ...state, current: next, display: state.display + (state.current === '' ? '0.' : '.') }
}

export function calcPressOp(state: CalcState, op: '+' | '-'): CalcState {
  if (state.error) return state
  // 先頭（何も入力していない状態）でのマイナスは無視（±で表現する仕様）
  if (state.current === '' && state.pendingOp == null && state.accumulated === 0 && state.display === '') {
    return state
  }
  // 数値未入力のまま演算子を続けて押した場合は、末尾の演算子を今回の記号に置き換える
  // （演算子の連続入力は無視する仕様の一種：最後の指定を有効にする）
  if (state.current === '') {
    if (state.pendingOp == null) return state
    const trimmed = state.display.replace(/[+-]$/, '')
    return { ...state, pendingOp: op, display: trimmed + op }
  }
  const curVal = Number(state.current)
  if (Number.isNaN(curVal)) return state
  const applied =
    state.pendingOp === '-' ? state.accumulated - curVal : state.accumulated + curVal
  if (Math.abs(applied) > MAX_VALUE) {
    return { ...state, error: '5桁を超えました' }
  }
  return {
    accumulated: applied,
    pendingOp: op,
    current: '',
    display: state.display + op,
  }
}

/** ±：入力中の数値、なければ直前に確定した数値の符号を反転する */
export function calcPressSign(state: CalcState): CalcState {
  if (state.error) return state
  if (state.current !== '') {
    const negated = state.current.startsWith('-')
      ? state.current.slice(1)
      : '-' + state.current
    // 表示文字列の末尾（今入力中の数値部分）だけ符号を付け替える
    const base = state.display.slice(0, state.display.length - state.current.length)
    return { ...state, current: negated, display: base + negated }
  }
  if (state.pendingOp == null && state.display !== '') {
    // まだ何も演算子を挟んでいない、確定前の単独値
    const negated = -state.accumulated
    return {
      ...state,
      accumulated: 0,
      current: formatNum(negated),
      display: formatNum(negated),
    }
  }
  return state
}

export function calcPressClear(): CalcState {
  return { ...initialCalcState }
}

export function calcPressBackspace(state: CalcState): CalcState {
  if (state.error) return calcPressClear()
  if (state.current !== '') {
    return {
      ...state,
      current: state.current.slice(0, -1),
      display: state.display.slice(0, -1),
    }
  }
  if (state.pendingOp != null) {
    // 直前に押した演算子を取り消し、その前の数値の入力へ戻る
    return {
      accumulated: 0,
      pendingOp: null,
      current: state.display.slice(0, -1),
      display: state.display.slice(0, -1),
    }
  }
  return state
}

/** ＝：式を確定し、合計値を返す（表示・状態のリセットは呼び出し側でcalcStateFromValueを使う） */
export function calcEvaluate(state: CalcState): { value?: number; error?: string } {
  if (state.error) return { error: state.error }
  if (state.display === '') return {}
  const curVal = state.current === '' ? 0 : Number(state.current)
  if (Number.isNaN(curVal)) return { error: '入力が正しくありません' }
  const total = state.pendingOp === '-' ? state.accumulated - curVal : state.accumulated + curVal
  if (Math.abs(total) > MAX_VALUE) return { error: '5桁を超えました' }
  return { value: total }
}

/**
 * 通常のテキスト入力欄（クイック計算のような専用テンキーではなく、
 * キーボードで「180+20」のようにそのまま打てる欄）向けに、入力済みの
 * 文字列を丸ごと評価する。ボタン操作を1文字ずつ再現してcalcPress*系に
 * 流し込むことで、桁数制限(5桁)・上限(99999)・演算子の扱いなど、
 * クイック計算と全く同じ電卓ロジック（この上の関数群）をそのまま使う。
 * 新しい計算ロジックは持たない。
 */
export function evaluateTypedExpression(raw: string): { value?: number; error?: string } {
  // 全角数字・全角＋－（日本語キーボードでの入力を考慮）を半角に正規化
  const normalized = raw.normalize('NFKC').replace(/\s+/g, '')
  if (normalized === '') return {}
  let state: CalcState = initialCalcState
  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      state = calcPressDigit(state, ch)
    } else if (ch === '.') {
      state = calcPressDot(state)
    } else if (ch === '+' || ch === '-') {
      state = calcPressOp(state, ch)
    } else {
      return { error: '入力が正しくありません' }
    }
    if (state.error) return { error: state.error }
  }
  return calcEvaluate(state)
}
