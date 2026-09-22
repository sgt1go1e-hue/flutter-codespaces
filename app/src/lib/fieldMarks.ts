import type { FieldWeldMark, Point, Segment } from '../types'
import { distance } from './isometric'
import { chooseDimSide } from './dimensionLine'

// 現場溶接マーク・現場合わせ区間の端点マークで共通して使う、正三角形
// (輪郭のみ)のジオメトリ計算。どちらも「配管ラインの角度に平行な底辺 +
// ユーザーが手動で選ぶ頂点の向き」という同じ見た目のルールを持つため、
// 描画ヘルパーを1箇所にまとめ、将来他のマークにも流用できるようにする。
// あくまで表示専用のジオメトリであり、切り寸法等の計算結果には一切関与しない。

/** 正三角形の一辺の長さ(基準値, px)。相番バッジ・寸法文字と同程度のスケール感。実際はscale倍。 */
export const FIELD_MARK_SIZE = 16
/** 現場合わせ区間の二重線の間隔(基準値, px。線の中心線からの片側オフセット)。実際はscale倍。 */
export const FIELD_FIT_LINE_GAP = 2.5
/** 現場合わせ区間の端点三角マークの、配管ラインからのオフセット距離(基準値, px)。実際はscale倍。 */
export const FIELD_FIT_MARK_OFFSET = 16

/**
 * セグメントを位置t(0..1)で前後2本(A=始点側 / B=終点側)に分割するとき、
 * そこに乗っている現場溶接マークをA/Bへ振り分ける。
 *
 * マークの位置は「そのセグメント上の相対位置(t)」で保持しているため、
 * 分割で区間が短くなると同じtでも図面上の絶対位置が変わってしまう。
 * 分割後の区間長に合わせてtを引き直すことで、チーズ・フランジ・
 * レジューサーを後から挿入してもマークが元の場所に留まるようにする
 * (この処理が無いと、分割のたびにマークが勝手にずれて動いていた)。
 *
 * offsetX/offsetY(ドラッグで移動済みの相対オフセット)は、対象点からの
 * 相対値であり対象点の絶対位置は分割前後で変わらないため、そのまま
 * 引き継いでよい。
 */
export function splitFieldWeldMarks(
  marks: FieldWeldMark[] | undefined,
  tSplit: number,
): { a: FieldWeldMark[] | undefined; b: FieldWeldMark[] | undefined } {
  if (!marks || marks.length === 0) return { a: undefined, b: undefined }
  // 分割点が端に張り付いている場合、割り戻しでtが発散する(0除算)ため、
  // 縮退しない側へまとめて寄せる。
  if (!(tSplit > 0) || !(tSplit < 1)) {
    return tSplit <= 0 ? { a: undefined, b: marks } : { a: marks, b: undefined }
  }
  const a: FieldWeldMark[] = []
  const b: FieldWeldMark[] = []
  for (const m of marks) {
    if (m.t <= tSplit) a.push({ ...m, t: m.t / tSplit })
    else b.push({ ...m, t: (m.t - tSplit) / (1 - tSplit) })
  }
  return { a: a.length ? a : undefined, b: b.length ? b : undefined }
}

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

/**
 * 正三角形(輪郭のみ)を、重心を中心にrotation度(時計回り)だけ回した
 * polygon points文字列を返す。rotation=0で頂点が真上を向く。
 * 現場溶接マーク用。配管の角度には合わせず、画面に対する絶対角度で回すため、
 * どの向きの配管に置いても同じ4方向(0/90/180/270)を選べる。
 */
export function rotatedTrianglePoints(center: Point, rotation: number, size: number): string {
  const height = (size * Math.sqrt(3)) / 2
  // 重心から各頂点への相対位置(頂点が上を向いた状態)
  const local: Point[] = [
    { x: 0, y: -(height * 2) / 3 },
    { x: -size / 2, y: height / 3 },
    { x: size / 2, y: height / 3 },
  ]
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return local
    .map((p) => `${center.x + p.x * cos - p.y * sin},${center.y + p.x * sin + p.y * cos}`)
    .join(' ')
}

/**
 * 現場溶接マーク(セグメント上の1点)の三角ジオメトリを求める。
 * 位置は「t位置 + 保存済みオフセット」だけで決まる(置いた場所・動かした場所を
 * そのまま使い、寸法線を避ける等の自動配置は行わない)。
 */
export function fieldWeldMarkGeometry(
  s: Segment,
  mark: FieldWeldMark,
  scale: number,
  offsetOverride?: { x: number; y: number },
): { points: string; anchor: Point; center: Point } {
  const anchor = {
    x: s.start.x + (s.end.x - s.start.x) * mark.t,
    y: s.start.y + (s.end.y - s.start.y) * mark.t,
  }
  const off = offsetOverride ?? { x: mark.offsetX ?? 0, y: mark.offsetY ?? 0 }
  const center = { x: anchor.x + off.x * scale, y: anchor.y + off.y * scale }
  return {
    points: rotatedTrianglePoints(center, mark.rotation, FIELD_MARK_SIZE * scale),
    anchor,
    center,
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
