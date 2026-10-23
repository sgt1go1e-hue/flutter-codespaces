/**
 * 受口(差込み口・めねじ)への管の入り代(mm)。キーは呼び径の数値("25"など)。
 * 引しろ表の図に「入り代」として描く。芯引きの計算には使わない(引しろは芯〜差込み底)。
 *
 * 出典(画面には出さない):
 * - ねじ込み: JIS B 2301 ねじ込み式可鍛鋳鉄製管継手の寸法表の「ねじ込み長さ ℓ」
 *   (エルボの「芯〜端面 L − 引しろ」とも一致することを確認。80Aのみ1mm差がありℓの表値を採用)
 * - 塩ビTS: JIS K 6743 TSエルボ寸法表の「H − 引しろ(エルボ)」= 受口長さ ℓ
 *   (13〜30はカタログのℓ列と一致を確認。125・150は引しろの登録が無いため未登録)
 * - 塩ビDV: JIS K 6739 DVチーズ寸法表の「長さ ℓ」(L1 − Z1 と一致)
 */
export const SOCKET_DEPTH: Record<'thread' | 'vp_ts' | 'vp_dv', Record<string, number>> = {
  thread: { '10': 9, '15': 11, '20': 13, '25': 15, '32': 17, '40': 18, '50': 20, '65': 23, '80': 25, '100': 28, '125': 30, '150': 33 },
  vp_ts: { '13': 26, '16': 30, '20': 35, '25': 40, '30': 44, '40': 55, '50': 63, '65': 61, '75': 64, '100': 84 },
  vp_dv: { '30': 18, '40': 22, '50': 25, '65': 35, '75': 40, '100': 50, '125': 65, '150': 80 },
}

export function socketDepth(kind: string, nominal: string | undefined): number | undefined {
  if (!nominal) return undefined
  const t = (SOCKET_DEPTH as Record<string, Record<string, number>>)[kind]
  return t?.[nominal]
}
