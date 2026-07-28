import type { Point } from '../types'

// ISOGEN流(海外の配管業界で広く使われる自動アイソメ生成ソフトのスタイル)を
// 参考にした寸法線のジオメトリ計算。パイプ本体に直接くっつけず、一定距離
// (スタンドオフ)離した位置に、パイプと平行な専用の寸法線を引く。芯々/芯先
// (外側レーン)と切り寸法(内側レーン)を別レーンに分離することで、密集した
// 図面でも寸法同士・寸法とパイプ本体が重なりにくくする。
// DrawingCanvas(画面表示)とPrintIsometric(印刷用)の両方から同じジオメトリを
// 使う(以前ラベル重なり回避ロジックを2ファイルに複製していた反省を踏まえ、
// 今回は最初から共通化する)。あくまで表示専用のジオメトリであり、寸法・
// 切り寸法そのものの計算結果(cutlength.ts/takeout.ts)には一切関与しない。

/** 外側レーン(芯々/芯先)のパイプからの基準距離(px)。実際はscale倍して使う。 */
export const DIM_OUTER_STANDOFF = 21
/** 内側レーン(切り寸法)のパイプからの基準距離(px)。実際はscale倍して使う。 */
export const DIM_INNER_STANDOFF = 14

const EXT_LINE_GAP = 2 // パイプ本体からの隙間(基準値, px)
const EXT_LINE_OVERSHOOT = 3 // 寸法線を少し超えて伸ばす量(基準値, px)
const ARROW_LEN = 6 // 矢羽根の長さ(基準値, px)
const ARROW_WIDTH = 2.6 // 矢羽根の半幅(基準値, px)
const TEXT_GAP = 5 // 寸法線から文字までの隙間(基準値, px。寸法線の「上側」)

export interface DimSide {
  nx: number
  ny: number
}

export interface DimLaneGeometry {
  /** 寸法線本体(パイプと平行、スタンドオフ分離れた位置) */
  line: { x1: number; y1: number; x2: number; y2: number }
  /** 始点側・終点側の矢羽根(polygon points文字列、寸法線の内側を向く) */
  arrowStart: string
  arrowEnd: string
  /** 文字の基準位置(寸法線からさらにわずかに離した「上側」) */
  textX: number
  textY: number
  /** 文字の回転角(度)。上下逆さまにならないよう±90度以内に正規化済み。 */
  textRotateDeg: number
}

/**
 * セグメントに対して寸法線を出す側(パイプに垂直な単位ベクトル)を決める。
 * avoidPoint(45°マーク等、避けたい固定要素の位置)を指定すればその反対側、
 * 無指定なら既定で画面下側にする(DrawingCanvas.tsxの旧ロジックと同じ考え方)。
 */
export function chooseDimSide(start: Point, end: Point, avoidPoint?: Point): DimSide {
  const len = Math.hypot(end.x - start.x, end.y - start.y) || 1
  const dx = (end.x - start.x) / len
  const dy = (end.y - start.y) / len
  let nx = -dy
  let ny = dx
  if (avoidPoint) {
    const mx = (start.x + end.x) / 2
    const my = (start.y + end.y) / 2
    const toMarkX = avoidPoint.x - mx
    const toMarkY = avoidPoint.y - my
    if (nx * toMarkX + ny * toMarkY > 0) {
      nx = -nx
      ny = -ny
    }
  } else if (ny < 0) {
    nx = -nx
    ny = -ny
  }
  return { nx, ny }
}

// 寸法線の回転角は、テキストが上下逆さまに読めてしまわないよう±90度以内に
// 正規化する(例: 210度の線は実質-30度と同じ向きとして文字を寝かせる)。
function normalizeRotation(rawDeg: number): number {
  let d = rawDeg % 360
  if (d > 90) d -= 180
  if (d < -90) d += 180
  return d
}

function arrowPoints(tip: Point, dir: Point, len: number, width: number): string {
  // dir: 矢印が指す方向(寸法線の内側へ向かう単位ベクトル)
  const baseX = tip.x - dir.x * len
  const baseY = tip.y - dir.y * len
  const nx = -dir.y
  const ny = dir.x
  const b1 = { x: baseX + nx * width, y: baseY + ny * width }
  const b2 = { x: baseX - nx * width, y: baseY - ny * width }
  return `${tip.x},${tip.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`
}

/** 指定レーン(標準距離standoffPx×scale)の寸法線・矢羽根・文字位置ジオメトリを求める。 */
export function dimLaneGeometry(
  start: Point,
  end: Point,
  side: DimSide,
  standoffPx: number,
  scale: number,
): DimLaneGeometry {
  const { nx, ny } = side
  const s = standoffPx * scale
  const p1 = { x: start.x + nx * s, y: start.y + ny * s }
  const p2 = { x: end.x + nx * s, y: end.y + ny * s }
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
  const ux = (p2.x - p1.x) / len
  const uy = (p2.y - p1.y) / len
  const arrowLen = ARROW_LEN * scale
  const arrowW = ARROW_WIDTH * scale
  const arrowStart = arrowPoints(p1, { x: ux, y: uy }, arrowLen, arrowW)
  const arrowEnd = arrowPoints(p2, { x: -ux, y: -uy }, arrowLen, arrowW)
  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const gap = TEXT_GAP * scale
  const rawDeg = (Math.atan2(uy, ux) * 180) / Math.PI
  return {
    line: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
    arrowStart,
    arrowEnd,
    textX: mx + nx * gap,
    textY: my + ny * gap,
    textRotateDeg: normalizeRotation(rawDeg),
  }
}

/** パイプ端点から、最も外側のレーン(dim outer standoff)まで伸びる寸法補助線。 */
export function dimExtensionLine(
  point: Point,
  side: DimSide,
  outerStandoffPx: number,
  scale: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const gap = EXT_LINE_GAP * scale
  const to = (outerStandoffPx + EXT_LINE_OVERSHOOT) * scale
  return {
    x1: point.x + side.nx * gap,
    y1: point.y + side.ny * gap,
    x2: point.x + side.nx * to,
    y2: point.y + side.ny * to,
  }
}
