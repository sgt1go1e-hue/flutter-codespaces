// ラベル（末端の呼び径・寸法2段表記）の重なり回避。
// DrawingCanvas（画面表示）と PrintIsometric（印刷用レイアウト）の両方から
// 同じロジックを参照する（以前は2ファイルに同一実装が複製されていた）。

// 実測せずに簡易的な文字幅を見積もる（全角=1em、半角=0.62em として概算）。
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 1.02
  }
  return w
}

export interface LabelBox {
  cx: number
  cy: number
  w: number
  h: number
}

/**
 * 回転したラベル矩形の軸並行(AABB)サイズを求める。寸法ラベル(芯々/芯先・
 * 切り寸法)はパイプの向き(アイソメ角度=0/30/90/150/210/270/330°)に合わせて
 * 常に回転して表示されるため、回転を無視した幅高さのまま衝突判定すると、
 * 実際の見た目より小さい箱で判定してしまい、斜めの2本の配管が近接する
 * 箇所でラベルどうしが重なって見えても「重なっていない」と誤判定して
 * しまう(45°を境に丸ごと縦横を入れ替えるだけの簡易対応では、それ以外の
 * 角度(30°/60°等)で過小評価が残っていた)。
 */
export function rotatedBoxSize(w: number, h: number, rotateDeg: number): { w: number; h: number } {
  const rad = (rotateDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  return { w: w * c + h * s, h: w * s + h * c }
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.cx - b.cx) * 2 < a.w + b.w && Math.abs(a.cy - b.cy) * 2 < a.h + b.h
  )
}

export interface LabelJob extends LabelBox {
  key: string
  /** 重なった場合に押し出す優先方向（単位ベクトル寄り） */
  pushX: number
  pushY: number
}

const SEARCH_STEP = 6
const SEARCH_MAX_RADIUS = 260
// 優先方向(pushX/pushY)を中心に、近い角度から順に試す（近いほど見た目の
// 位置が元の意図に近いまま重なりを避けられるため）。
const ANGLE_OFFSETS_DEG = [0, -30, 30, -60, 60, -90, 90, -120, 120, -150, 150, 180]

function hasOverlap(box: LabelBox, placed: LabelBox[]): boolean {
  return placed.some((p) => boxesOverlap(box, p))
}

/**
 * 指定ジョブが重ならない位置を、優先方向を中心にらせん状に外側へ探して見つける。
 * 「ぶつかった相手から遠ざかる」方向だけを逐次合成する素朴な反発では、密集した
 * 分岐(短い区間が複数のノードで隣接するような配置)で行ったり来たりして
 * 収束しない/わずかに重なったまま探索打ち切りになることがあったため、
 * 角度と半径を広げながら「完全に重ならない位置」が見つかるまで探す方式にした。
 */
function findClearPosition(job: LabelJob, placed: LabelBox[]): { cx: number; cy: number } {
  const base = { cx: job.cx, cy: job.cy, w: job.w, h: job.h }
  if (!hasOverlap(base, placed)) return { cx: job.cx, cy: job.cy }

  const hasPreferred = job.pushX !== 0 || job.pushY !== 0
  const baseAngle = hasPreferred ? Math.atan2(job.pushY, job.pushX) : 0

  for (let radius = SEARCH_STEP; radius <= SEARCH_MAX_RADIUS; radius += SEARCH_STEP) {
    for (const offsetDeg of ANGLE_OFFSETS_DEG) {
      const angle = baseAngle + (offsetDeg * Math.PI) / 180
      const cx = job.cx + Math.cos(angle) * radius
      const cy = job.cy + Math.sin(angle) * radius
      if (!hasOverlap({ cx, cy, w: job.w, h: job.h }, placed)) return { cx, cy }
    }
  }
  // 探索範囲内に完全な空きが無い極端な密集時は、既定位置のまま返す
  // （見た目の重なりは残るが、他の座標へ飛び過ぎて別の混乱を生むよりまし）。
  return { cx: job.cx, cy: job.cy }
}

/**
 * 複数のラベル配置ジョブを、互いに重ならないよう（可能な限り）解決する。
 * obstacles（線どうしの交差点・45°マークなど、動かせない固定の避けたい領域）
 * を渡すと、それらとも重ならないよう先に確保しておく。
 */
export function resolveOverlaps(
  jobs: LabelJob[],
  obstacles: LabelBox[] = [],
): Map<string, { cx: number; cy: number }> {
  const placed: LabelBox[] = [...obstacles]
  const result = new Map<string, { cx: number; cy: number }>()
  for (const job of jobs) {
    const pos = findClearPosition(job, placed)
    placed.push({ cx: pos.cx, cy: pos.cy, w: job.w, h: job.h })
    result.set(job.key, pos)
  }
  return result
}
