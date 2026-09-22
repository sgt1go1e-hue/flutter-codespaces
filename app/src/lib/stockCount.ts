// 直管(定尺から切り出す品目)の必要本数を、実際の詰め込みで求める。
//
// 「合計必要mm ÷ 定尺」の単純な割り算では過小評価になる。切り出しの
// 組み合わせ次第で端材が出るため、実際には割り算の理論値より多く必要に
// なることがあるため。
//   例) 定尺4000 / 3000×3 + 1500×3
//       単純計算: (9000+4500)/4000 = 3.375 → 4本
//       実際     : 3000の3本はそれぞれ別の定尺を占有し(残り1000ずつ)、
//                  1500は3本とも入らないので新しい定尺が要る → 5本
//
// アルゴリズムは First-Fit Decreasing(FFD)。長い順に、既に開いている定尺の
// うち入る最初のものへ詰め、どれにも入らなければ新しい定尺を開く。
// 表示・発注のための概算で、切り寸法そのものの計算には一切関与しない。

/**
 * 切断ロス(kerf)の既定値(mm)。1回の切り出しごとにこの分だけ余分に消費する。
 * 現状は0。将来ユーザー設定にする場合はここを起点に差し替える。
 */
export const DEFAULT_KERF_MM = 0

/** 定尺の長さ(mm)。ねじ付は4m固定、ねじ無しは4m/5.5mから選ぶ。 */
export const STOCK_LENGTHS_MM = [4000, 5500] as const
export type StockLengthMm = (typeof STOCK_LENGTHS_MM)[number]

/**
 * 必要な定尺の本数を返す(First-Fit Decreasing)。
 * @param cutLengthsMm 切り出す寸法の一覧(mm)
 * @param stockLengthMm 定尺の長さ(mm)
 * @param kerfMm 1切り出しあたりの切断ロス(mm)
 */
export function calcStockCount(
  cutLengthsMm: number[],
  stockLengthMm: number,
  kerfMm: number = DEFAULT_KERF_MM,
): number {
  if (stockLengthMm <= 0) return 0
  const sorted = [...cutLengthsMm].filter((v) => v > 0).sort((a, b) => b - a)
  const remaining: number[] = [] // 各定尺の残り容量

  for (const length of sorted) {
    const needed = length + kerfMm
    // 定尺1本に収まらない寸法は、そのまま1本を占有させる(現場で継ぐ前提)。
    // ここで弾くと本数が実態より少なくなってしまうため、必ず1本数える。
    if (needed > stockLengthMm) {
      remaining.push(0)
      continue
    }
    const fitIndex = remaining.findIndex((r) => r >= needed)
    if (fitIndex !== -1) {
      remaining[fitIndex] -= needed
    } else {
      remaining.push(stockLengthMm - needed)
    }
  }
  return remaining.length
}
