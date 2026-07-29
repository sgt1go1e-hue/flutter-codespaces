import type { Point, Segment } from '../types'
import { distance } from './isometric'
import { chooseDimSide } from './dimensionLine'

// 現場溶接マーク・現場合わせ区間の端点マークで共通して使う、正三角形
// (輪郭のみ)のジオメトリ計算。どちらも「配管ラインの角度に平行な底辺 +
// ユーザーが手動で選ぶ頂点の向き」という同じ見た目のルールを持つため、
// 描画ヘルパーを1箇所にまとめ、将来他のマークにも流用できるようにする。
// あくまで表示専用のジオメトリであり、切り寸法等の計算結果には一切関与しない。

/** 正三角形の一辺の長さ(基準値, px)。相番バッジ・寸法文字と同程度のスケール感。実際はscale倍。 */
export const FIELD_MARK_SIZE = 16
/** 現場溶接マークの、配管ラインからの既定オフセット距離(基準値, px)。実際はscale倍。
    以前は寸法線(DIM_STANDOFF=21)と同程度離していたが、対象点から離れすぎて
    寸法テキストと誤認しやすかったため、パイプにより近い位置に縮めてある。
    ユーザーがドラッグで移動した場合はこの既定値は使わず、保存済みの
    offsetX/offsetY(fieldWeldMarkGeometryのcustomOffset)を使う。 */
export const FIELD_WELD_OFFSET = 11
/** 現場合わせ区間の二重線の間隔(基準値, px。線の中心線からの片側オフセット)。実際はscale倍。 */
export const FIELD_FIT_LINE_GAP = 2.5
/** 現場合わせ区間の端点三角マークの、配管ラインからのオフセット距離(基準値, px)。実際はscale倍。 */
export const FIELD_FIT_MARK_OFFSET = 16

/**
 * 正三角形(輪郭のみ)のpolygon points文字列を返す。
 * baseCenter: 底辺の中心点。baseDir: 底辺の向き(単位ベクトル、配管ラインに平行)。
 * flipped: 頂点をbaseDirの法線方向のどちら側に伸ばすか(ユーザーがタップ/ボタンで反転)。
 */
export function trianglePoints(
  baseCenter: Point,
  baseDir: Point,
  flipped: boolean,
  size: number,
): string {
  const half = size / 2
  const height = (size * Math.sqrt(3)) / 2
  const sign = flipped ? -1 : 1
  const nx = -baseDir.y * sign
  const ny = baseDir.x * sign
  const b1 = { x: baseCenter.x - baseDir.x * half, y: baseCenter.y - baseDir.y * half }
  const b2 = { x: baseCenter.x + baseDir.x * half, y: baseCenter.y + baseDir.y * half }
  const apex = { x: baseCenter.x + nx * height, y: baseCenter.y + ny * height }
  return `${b1.x},${b1.y} ${b2.x},${b2.y} ${apex.x},${apex.y}`
}

/**
 * セグメントに対して、寸法線と重ならないよう反対側に寄せた法線方向を返す
 * (寸法線が実際に出す側の逆側)。avoidPointは、DrawingCanvas/PrintIsometric
 * が寸法線の側を決めるときと同じ「避けたい点」(45°マーク等)を渡すことで、
 * 寸法線の側の判定(chooseDimSide)と食い違わないようにする。これが揃って
 * いないと、寸法線が45°マーク回避で反転した区間だけマークと寸法線が
 * 同じ側に来て重なって見えることがあった。
 */
function markSide(start: Point, end: Point, avoidPoint?: Point): { nx: number; ny: number } {
  const dimSide = chooseDimSide(start, end, avoidPoint)
  return { nx: -dimSide.nx, ny: -dimSide.ny }
}

/** 現場溶接マーク(セグメント上の1点)の三角ジオメトリを求める。 */
export function fieldWeldMarkGeometry(
  s: Segment,
  t: number,
  flipped: boolean,
  scale: number,
  avoidPoint?: Point,
  customOffset?: { x: number; y: number },
): { points: string; anchor: Point; baseCenter: Point } {
  const len = distance(s.start, s.end) || 1
  const ux = (s.end.x - s.start.x) / len
  const uy = (s.end.y - s.start.y) / len
  const at = { x: s.start.x + (s.end.x - s.start.x) * t, y: s.start.y + (s.end.y - s.start.y) * t }
  // customOffset(ドラッグで移動して保存済みの相対位置)があればそれを優先する。
  // 無ければ、寸法線と反対側・パイプに近い既定位置を自動で使う。
  const baseCenter = customOffset
    ? { x: at.x + customOffset.x * scale, y: at.y + customOffset.y * scale }
    : (() => {
        const { nx, ny } = markSide(s.start, s.end, avoidPoint)
        const off = FIELD_WELD_OFFSET * scale
        return { x: at.x + nx * off, y: at.y + ny * off }
      })()
  return {
    points: trianglePoints(baseCenter, { x: ux, y: uy }, flipped, FIELD_MARK_SIZE * scale),
    anchor: at,
    baseCenter,
  }
}

/** 現場合わせ区間の端点(始点/終点)三角マークのジオメトリを求める。 */
export function fieldFitEndMarkGeometry(
  s: Segment,
  at: 'start' | 'end',
  flipped: boolean,
  scale: number,
): string {
  const pt = at === 'start' ? s.start : s.end
  const other = at === 'start' ? s.end : s.start
  const len = distance(pt, other) || 1
  const ux = (other.x - pt.x) / len
  const uy = (other.y - pt.y) / len
  const { nx, ny } = markSide(s.start, s.end)
  const off = FIELD_FIT_MARK_OFFSET * scale
  const baseCenter = { x: pt.x + nx * off, y: pt.y + ny * off }
  return trianglePoints(baseCenter, { x: ux, y: uy }, flipped, FIELD_MARK_SIZE * scale)
}

/** 現場合わせ区間の二重線(元の線の両側に平行線を1本ずつ)のジオメトリを求める。 */
export function fieldFitDoubleLines(
  a: Point,
  b: Point,
  scale: number,
): { line1: { x1: number; y1: number; x2: number; y2: number }; line2: { x1: number; y1: number; x2: number; y2: number } } {
  const len = distance(a, b) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const nx = -uy
  const ny = ux
  const gap = FIELD_FIT_LINE_GAP * scale
  return {
    line1: { x1: a.x + nx * gap, y1: a.y + ny * gap, x2: b.x + nx * gap, y2: b.y + ny * gap },
    line2: { x1: a.x - nx * gap, y1: a.y - ny * gap, x2: b.x - nx * gap, y2: b.y - ny * gap },
  }
}
