import { useMemo } from 'react'
import type { Point, Segment } from '../types'
import { distance } from '../lib/isometric'
import { breakLine } from '../lib/crossover'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import { effectiveSlopeDenom } from '../lib/slope'
import {
  estimateTextWidth,
  resolveOverlaps,
  rotatedBoxSize,
  type LabelBox,
  type LabelJob,
} from '../lib/labelLayout'
import {
  chooseDimSide,
  dimExtensionLine,
  dimGeometry,
  DIM_THROUGH_STANDOFF,
} from '../lib/dimensionLine'
import { computeThroughRuns } from '../lib/throughRun'
import {
  fieldFitDoubleLines,
  fieldFitEndMarkGeometry,
  fieldWeldMarkGeometry,
} from '../lib/fieldMarks'
import { genGouLabelText } from '../lib/genGou'

// 現合区間の補足メモは自由入力(長さ無制限)だが、印刷では2行目レーンに
// 収まる程度に短くする(長いままだと隣の区間のラベルと重なるため)。
const GENGOU_NOTE_MAX = 18
function truncateGenGouNote(text: string): string {
  return text.length > GENGOU_NOTE_MAX ? `${text.slice(0, GENGOU_NOTE_MAX)}…` : text
}

interface Props {
  segments: Segment[]
  effectiveById: Record<string, Effective>
  crossoverGaps: Record<string, number[]>
  cutById: Record<string, CutResult>
  /** 配管設定(ベース)の勾配(1/N のN)。区間自身に個別上書きが無いときに使う。 */
  baseSlopeDenom?: number
  /** 通り寸法(曲がるまでの全体の芯々)を出すか。画面の切替と共通。 */
  showThroughDim?: boolean
}

const CROSS_GAP = 9

// アイソメ図上に実際に表示される「L45°」「S45°」マーク（45°エルボの
// ロング/ショートを使用している端）の位置を全て求める。90°ショートエルボの
// 「ショート」マークと同じく、セグメント自身のfitting値ではなく、実際の
// 計算に使われた継手id(cutById[...].start/endFittingId、始点/終点の
// 個別上書きも反映済み)で判定する。この位置は、そのマークを描いている
// セグメント自身だけでなく、ノードを共有する隣接セグメント（キック区間など）
// の寸法ラベルからも見えるため、寸法ラベル側は「自分がその継手を持って
// いるか」ではなく「近くにマークが実在するか」で反対側へ避ける必要がある。
function allElbow45MarkPositions(
  segments: Segment[],
  cutById: Record<string, CutResult>,
): Point[] {
  const marks: Point[] = []
  for (const s of segments) {
    const c = cutById[s.id]
    if (!c) continue
    for (const at of ['start', 'end'] as const) {
      const role = at === 'start' ? c.startRole : c.endRole
      if (role !== 'elbow' && role !== 'elbow-reducer') continue
      const fittingId = at === 'start' ? c.startFittingId : c.endFittingId
      if (fittingId !== 'elbow45_long' && fittingId !== 'elbow45_short') continue
      const pt = at === 'start' ? s.start : s.end
      const other = at === 'start' ? s.end : s.start
      const len = distance(pt, other) || 1
      const dx = (other.x - pt.x) / len
      const dy = (other.y - pt.y) / len
      const nx = -dy
      const ny = dx
      marks.push({ x: pt.x + dx * 20 + nx * 11, y: pt.y + dy * 20 + ny * 11 })
    }
  }
  return marks
}

// アイソメ図上に実際に表示される「ショート」マーク（90°ショートエルボを
// 使用している端）の位置を全て求める。45°マークと違い、セグメント自身の
// fitting値ではなく、実際の計算に使われた継手id(cutById[...].start/endFittingId、
// 始点/終点の個別上書きも反映済み)で判定する。ロングが既定のため、ショートを
// 使っている箇所だけ現場で見落とさないよう明示する。
function allElbowShortMarkPositions(
  segments: Segment[],
  cutById: Record<string, CutResult>,
): Point[] {
  const marks: Point[] = []
  for (const s of segments) {
    const c = cutById[s.id]
    if (!c) continue
    for (const at of ['start', 'end'] as const) {
      const role = at === 'start' ? c.startRole : c.endRole
      if (role !== 'elbow' && role !== 'elbow-reducer') continue
      const fittingId = at === 'start' ? c.startFittingId : c.endFittingId
      if (fittingId !== 'elbow90_short') continue
      const pt = at === 'start' ? s.start : s.end
      const other = at === 'start' ? s.end : s.start
      const len = distance(pt, other) || 1
      const dx = (other.x - pt.x) / len
      const dy = (other.y - pt.y) / len
      const nx = -dy
      const ny = dx
      marks.push({ x: pt.x + dx * 20 + nx * 11, y: pt.y + dy * 20 + ny * 11 })
    }
  }
  return marks
}

// 指定座標に最も近い45°マーク（一定距離内にあるものだけ）。無ければnull。
function nearestElbow45Mark(marks: Point[], x: number, y: number): Point | null {
  let best: Point | null = null
  let bestD = 150
  for (const m of marks) {
    const d = Math.hypot(m.x - x, m.y - y)
    if (d < bestD) {
      bestD = d
      best = m
    }
  }
  return best
}

/**
 * BOM の PDF/印刷ページに埋め込む、配管アイソメ図の静止版。
 * DrawingCanvas と違い、入力操作は一切持たず、図面全体が収まる viewBox を
 * 自動計算して表示する（現在の画面のズーム/パン状態には依存しない）。
 */
export function PrintIsometric({
  segments,
  effectiveById,
  crossoverGaps,
  cutById,
  baseSlopeDenom,
  showThroughDim = false,
}: Props) {
  // 通り寸法(曲がるまで一直線に続く区間の合計)。表示専用。
  const throughRuns = useMemo(
    () => (showThroughDim ? computeThroughRuns(segments, cutById) : []),
    [showThroughDim, segments, cutById],
  )
  // 実際に描かれる45°マークの位置（寸法線を出す側の判定に使う。重なり回避の
  // 対象位置計算(resolvedLabels)と実際の寸法線描画(レンダー側)の両方で同じ
  // 値を参照する）。
  const elbow45Marks = useMemo(
    () => [
      ...allElbow45MarkPositions(segments, cutById),
      ...allElbowShortMarkPositions(segments, cutById),
    ],
    [segments, cutById],
  )

  const resolvedLabels = useMemo(() => {
    const jobs: LabelJob[] = []
    // 寸法線の矢羽根位置(両端)も、他のラベル(特に末端の呼び径ラベル)が重ならない
    // よう固定の回避領域として扱う(画面表示のDrawingCanvas.tsxと同じ考え方)。
    const dimArrowObstacles: LabelBox[] = []
    for (const s of segments) {
      const eff = effectiveById[s.id]
      const c = cutById[s.id]
      if (!eff?.showSizeLabel || !eff.size || !c?.startConnected || !c?.endConnected)
        continue
      const mx = (s.start.x + s.end.x) / 2
      const my = (s.start.y + s.end.y) / 2
      const w = estimateTextWidth(eff.size, 12) + 8
      jobs.push({ key: `seg-${s.id}`, cx: mx, cy: my - 10, w, h: 18, pushX: 0, pushY: -1 })
    }
    // ISOGEN流(海外の配管業界で広く使われる自動アイソメ生成ソフトのスタイル)を
    // 参考に、パイプ本体から離した1本の寸法線の上に、芯々/芯先(1行目)と
    // 切り寸法(2行目、参照寸法を示す括弧書き)を2行で表示する(画面表示の
    // DrawingCanvas.tsxと同じジオメトリ・同じ考え方。印刷はuiScaleを持たない
    // ため常に等倍=1として扱う)。
    for (const s of segments) {
      const c = cutById[s.id]
      if (!c || c.status === 'none') continue
      let t = 0.5
      if (!c.startConnected && c.endConnected) t = 0.3
      else if (c.startConnected && !c.endConnected) t = 0.7
      const mx = s.start.x + (s.end.x - s.start.x) * t
      const my = s.start.y + (s.end.y - s.start.y) * t
      const line1 = `${c.mode} ${c.center}`
      // 現合(現物合わせ)区間は切り寸法を出さないため2行目レーンが空くが、
      // 印刷では画面のようにタップしてメモを確認できないため、この空きレーン
      // に補足メモをそのまま文字で出す(当たり判定の幅もメモの長さで見積もる)。
      const line2 = s.isGenGou
        ? s.genGouNote
          ? `メモ: ${truncateGenGouNote(s.genGouNote)}`
          : ''
        : c.status === 'ok'
          ? c.threadTooShortForPipe
            ? '加工不可能（丸ニップル使用）'
            : c.vpTsTooShortForPipe
              ? '加工不可能（差込み代不足）'
              : `(切 ${c.cut}${c.socketWeldGapWarning ? '（溶接代不足）' : ''}${c.threadNearMinNipple ? '（丸ニップル推奨）' : ''})`
          : c.status === 'zero'
            ? c.reducerH != null
              ? `レジューサー H=${c.reducerH}（継手直結）`
              : 'パイプ0（継手直結）'
            : '継手不足'
      const fs2 = s.isGenGou
        ? 9.5
        : c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe
          ? 12.5
          : 11
      const markPos = nearestElbow45Mark(elbow45Marks, mx, my)
      const side = chooseDimSide(s.start, s.end, markPos ?? undefined)
      const geom = dimGeometry(s.start, s.end, side, 1)
      dimArrowObstacles.push(
        { cx: geom.line.x1, cy: geom.line.y1, w: 16, h: 16 },
        { cx: geom.line.x2, cy: geom.line.y2, w: 16, h: 16 },
      )
      const w1 = estimateTextWidth(line1, 10.5) + 6
      const w2 = estimateTextWidth(line2, fs2) + 6
      // 当たり判定の箱は、実際の回転角(±30°刻みのアイソメ角度に対応)に応じた
      // 軸並行(AABB)サイズで見積もる。
      const box1 = rotatedBoxSize(w1, 16, geom.textRotateDeg)
      const box2 = rotatedBoxSize(w2, 18, geom.textRotateDeg)
      jobs.push({
        key: `dim-line1-${s.id}`,
        cx: geom.text1X,
        cy: geom.text1Y,
        w: box1.w,
        h: box1.h,
        pushX: side.nx,
        pushY: side.ny,
      })
      jobs.push({
        key: `dim-line2-${s.id}`,
        cx: geom.text2X,
        cy: geom.text2Y,
        w: box2.w,
        h: box2.h,
        pushX: side.nx,
        pushY: side.ny,
      })
    }
    for (const s of segments) {
      const eff = effectiveById[s.id]
      const c = cutById[s.id]
      if (!eff?.size || !c) continue
      for (const at of ['start', 'end'] as const) {
        const connected = at === 'start' ? c.startConnected : c.endConnected
        if (connected) continue
        const pt = at === 'start' ? s.start : s.end
        const other = at === 'start' ? s.end : s.start
        const len = distance(pt, other) || 1
        const ox = (pt.x - other.x) / len
        const oy = (pt.y - other.y) / len
        let nx = -oy
        let ny = ox
        if (ny > 0) {
          nx = -nx
          ny = -ny
        }
        const cx = pt.x + ox * 20 + nx * 14
        const cy = pt.y + oy * 20 + ny * 14
        const w = estimateTextWidth(eff.size, 13) + 14
        jobs.push({ key: `term-${s.id}-${at}`, cx, cy, w, h: 26, pushX: nx, pushY: ny })
      }
    }
    // 排水勾配の「勾配1/N」マーク（区間中点のやや下）。個別上書きが無い
    // 区間は配管設定(ベース)の値を継承して表示する。他のラベルや互いどうし
    // とも重ならないよう、同じジョブ列に混ぜて解決する。
    for (const s of segments) {
      const denom = effectiveSlopeDenom(s, baseSlopeDenom)
      if (denom == null) continue
      const mx = (s.start.x + s.end.x) / 2
      const my = (s.start.y + s.end.y) / 2
      const w = estimateTextWidth(`勾配1/${denom}`, 11) + 6
      jobs.push({ key: `slope-${s.id}`, cx: mx, cy: my + 16, w, h: 18, pushX: 0, pushY: 1 })
    }
    // データ上つながっていない線どうしが視覚的に交差する箇所は、複数のラベルの
    // 既定位置（セグメント中点付近）が同じ場所に集まりやすく、重なって読めなく
    // なりやすい。交差点そのものを避けたい固定領域として扱う。
    const crossObstacles: LabelBox[] = []
    for (const s of segments) {
      const centers = crossoverGaps[s.id]
      if (!centers) continue
      for (const t of centers) {
        crossObstacles.push({
          cx: s.start.x + (s.end.x - s.start.x) * t,
          cy: s.start.y + (s.end.y - s.start.y) * t,
          w: 40,
          h: 40,
        })
      }
    }
    // 45°エルボ(L45°/S45°)の「45°」マークも、寸法ラベルが重なって文字が
    // 読めなくならないよう固定の回避領域として扱う（特に短いキック区間では
    // マークと寸法が近接しがち）。
    const elbow45Obstacles: LabelBox[] = []
    for (const s of segments) {
      const c = cutById[s.id]
      for (const at of ['start', 'end'] as const) {
        const role = at === 'start' ? c?.startRole : c?.endRole
        if (role !== 'elbow' && role !== 'elbow-reducer') continue
        const fittingId = at === 'start' ? c?.startFittingId : c?.endFittingId
        if (fittingId !== 'elbow45_long' && fittingId !== 'elbow45_short') continue
        const pt = at === 'start' ? s.start : s.end
        const other = at === 'start' ? s.end : s.start
        const len = distance(pt, other) || 1
        const dx = (other.x - pt.x) / len
        const dy = (other.y - pt.y) / len
        const nx = -dy
        const ny = dx
        const gap = 20
        const off = 11
        elbow45Obstacles.push({
          cx: pt.x + dx * gap + nx * off,
          cy: pt.y + dy * gap + ny * off,
          w: 34,
          h: 22,
        })
      }
    }
    // ショートエルボの「ショート」マークも同様に回避領域として扱う。
    for (const pos of allElbowShortMarkPositions(segments, cutById)) {
      elbow45Obstacles.push({ cx: pos.x, cy: pos.y, w: 34, h: 22 })
    }
    return resolveOverlaps(jobs, [...crossObstacles, ...elbow45Obstacles, ...dimArrowObstacles])
  }, [segments, cutById, effectiveById, crossoverGaps, baseSlopeDenom])

  const viewBox = useMemo(() => {
    if (segments.length === 0) return '0 0 200 200'
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of segments) {
      for (const p of [s.start, s.end]) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
    }
    // ラベル・寸法表記がはみ出さないよう余白を広めに取る
    const pad = 90
    minX -= pad
    minY -= pad
    maxX += pad
    maxY += pad
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
  }, [segments])

  function flangeMarker(s: Segment, at: 'start' | 'end', type: 'double' | 'single') {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    const ux = (other.x - pt.x) / len
    const uy = (other.y - pt.y) / len
    const nx = -uy
    const ny = ux
    const half = 10
    const bar = (cx: number, cy: number, key: number) => (
      <line
        key={key}
        x1={cx - nx * half}
        y1={cy - ny * half}
        x2={cx + nx * half}
        y2={cy + ny * half}
        className="flange-mark"
      />
    )
    if (type === 'single') return <>{bar(pt.x, pt.y, 0)}</>
    const off = 4
    return (
      <>
        {bar(pt.x - ux * off, pt.y - uy * off, 0)}
        {bar(pt.x + ux * off, pt.y + uy * off, 1)}
      </>
    )
  }

  function terminusSize(s: Segment, at: 'start' | 'end', size: string) {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    const ox = (pt.x - other.x) / len
    const oy = (pt.y - other.y) / len
    let nx = -oy
    let ny = ox
    if (ny > 0) {
      nx = -nx
      ny = -ny
    }
    const resolved = resolvedLabels.get(`term-${s.id}-${at}`)
    const cx = resolved?.cx ?? pt.x + ox * 20 + nx * 14
    const cy = resolved?.cy ?? pt.y + oy * 20 + ny * 14
    return (
      <text className="seg-label terminus" x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
        {size}
      </text>
    )
  }

  function reducerAtEnd(s: Segment, at: 'start' | 'end') {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    const dx = (other.x - pt.x) / len
    const dy = (other.y - pt.y) / len
    const nx = -dy
    const ny = dx
    const L = 12
    const W = 9
    const gap = 12
    const baseCx = pt.x + dx * gap
    const baseCy = pt.y + dy * gap
    const c1 = { x: baseCx + nx * W, y: baseCy + ny * W }
    const c2 = { x: baseCx - nx * W, y: baseCy - ny * W }
    const apex = { x: baseCx + dx * L, y: baseCy + dy * L }
    return (
      <polygon
        className="reducer-mark"
        points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${apex.x},${apex.y}`}
      />
    )
  }

  // 現場合わせ区間の二重線（印刷用。画面表示と同じジオメトリ、常に等倍）
  function fieldFitDoubleLine(s: Segment) {
    const { line1, line2 } = fieldFitDoubleLines(s.start, s.end, 1)
    return (
      <>
        <line x1={line1.x1} y1={line1.y1} x2={line1.x2} y2={line1.y2} className="field-fit-line" />
        <line x1={line2.x1} y1={line2.y1} x2={line2.x2} y2={line2.y2} className="field-fit-line" />
      </>
    )
  }

  // 現場合わせ区間の端点三角マーク（印刷用。タップ操作は不要なので描画のみ）
  function fieldFitEndMark(s: Segment, at: 'start' | 'end', flipped: boolean) {
    const points = fieldFitEndMarkGeometry(s, at, flipped, 1)
    return <polygon className="field-fit-mark" points={points} />
  }

  // 現場溶接マーク（印刷用。描画のみ）。画面側と同じく、保存された位置
  // (offsetX/offsetY)と向き(rotation)をそのまま反映する(印刷でも画面表示と
  // 同じ位置・同じ向きになるようにするため)。
  function fieldWeldMark(s: Segment) {
    if (!s.fieldWeldMarks || s.fieldWeldMarks.length === 0) return null
    return (
      <>
        {s.fieldWeldMarks.map((mark) => {
          const { points } = fieldWeldMarkGeometry(s, mark, 1)
          return <polygon key={mark.id} className="field-weld-mark" points={points} />
        })}
      </>
    )
  }

  // 45°エルボを使用した端に「L45°」（ロング）／「S45°」（ショート）マークを
  // 表示（90°エルボとの区別、およびロング/ショートの区別を現場ですぐ判別
  // できるように）。
  function elbow45Mark(s: Segment, at: 'start' | 'end', label: 'L45°' | 'S45°') {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    const dx = (other.x - pt.x) / len
    const dy = (other.y - pt.y) / len
    const nx = -dy
    const ny = dx
    const gap = 20
    const off = 11
    const cx = pt.x + dx * gap + nx * off
    const cy = pt.y + dy * gap + ny * off
    return (
      <text className="elbow45-mark" x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
    )
  }

  // 90°ショートエルボを使用した端に「ショート」マークを表示（印刷用。画面表示と同じ条件）。
  function elbowShortMark(s: Segment, at: 'start' | 'end') {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    const dx = (other.x - pt.x) / len
    const dy = (other.y - pt.y) / len
    const nx = -dy
    const ny = dx
    const gap = 20
    const off = 11
    const cx = pt.x + dx * gap + nx * off
    const cy = pt.y + dy * gap + ny * off
    return (
      <text className="elbow-short-mark" x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
        ショート
      </text>
    )
  }

  // 排水勾配(1/N)を設定した区間に「勾配1/N」マークを表示する
  function slopeMark(s: Segment, denom: number) {
    const mx = (s.start.x + s.end.x) / 2
    const my = (s.start.y + s.end.y) / 2
    const resolved = resolvedLabels.get(`slope-${s.id}`)
    const cx = resolved?.cx ?? mx
    const cy = resolved?.cy ?? my + 16
    return (
      <text className="slope-mark" x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
        勾配1/{denom}
      </text>
    )
  }

  function reducerSymbol(
    s: Segment,
    kind: 'concentric' | 'eccentric',
    align: 'top' | 'bottom' | undefined,
    largeAtStart: boolean,
  ) {
    const mx = (s.start.x + s.end.x) / 2
    const my = (s.start.y + s.end.y) / 2
    const len = distance(s.start, s.end) || 1
    const dx = (s.end.x - s.start.x) / len
    const dy = (s.end.y - s.start.y) / len
    const ux = largeAtStart ? dx : -dx
    const uy = largeAtStart ? dy : -dy
    const nx = -uy
    const ny = ux
    const L = 13
    const W = 9
    const largeCx = mx - ux * L
    const largeCy = my - uy * L
    const c1 = { x: largeCx + nx * W, y: largeCy + ny * W }
    const c2 = { x: largeCx - nx * W, y: largeCy - ny * W }
    let apex = { x: mx + ux * L, y: my + uy * L }
    if (kind === 'eccentric' && align) {
      const cTop = c1.y <= c2.y ? c1 : c2
      const cBot = c1.y <= c2.y ? c2 : c1
      const flush = align === 'bottom' ? cBot : cTop
      apex = { x: flush.x + ux * 2 * L, y: flush.y + uy * 2 * L }
    }
    return (
      <polygon
        className="reducer-mark"
        points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${apex.x},${apex.y}`}
      />
    )
  }

  return (
    <svg className="print-iso-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
      {segments.map((s) => {
        const eff = effectiveById[s.id]
        const resolved = eff?.resolved ?? false
        const stroke = resolved ? '#0369a1' : '#64748b'
        const pieces = breakLine(s.start, s.end, crossoverGaps[s.id] ?? [], CROSS_GAP)
        return (
          <g key={s.id}>
            {pieces.map((pc, i) => (
              <line
                key={i}
                x1={pc.a.x}
                y1={pc.a.y}
                x2={pc.b.x}
                y2={pc.b.y}
                stroke={stroke}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={resolved ? undefined : '6 5'}
              />
            ))}
            <circle cx={s.start.x} cy={s.start.y} r={4} fill="#94a3b8" />
            <circle cx={s.end.x} cy={s.end.y} r={4} fill="#94a3b8" />
            {s.startFlange && flangeMarker(s, 'start', s.startFlange)}
            {s.endFlange && flangeMarker(s, 'end', s.endFlange)}
            {s.fieldFitAllowance && fieldFitDoubleLine(s)}
            {s.fieldFitAllowance && fieldFitEndMark(s, 'start', s.fieldFitStartFlipped ?? false)}
            {s.fieldFitAllowance && fieldFitEndMark(s, 'end', s.fieldFitEndFlipped ?? false)}
            {fieldWeldMark(s)}
            {eff?.fitting === 'reducer_concentric' &&
              reducerSymbol(s, 'concentric', undefined, cutById[s.id]?.reducerLargeAtStart ?? true)}
            {eff?.fitting === 'reducer_eccentric' &&
              reducerSymbol(
                s,
                'eccentric',
                cutById[s.id]?.eccentric?.align,
                cutById[s.id]?.reducerLargeAtStart ?? true,
              )}
            {(cutById[s.id]?.startRole === 'tee-run-reducer' ||
              cutById[s.id]?.startRole === 'wye-run-reducer' ||
              cutById[s.id]?.startRole === 'elbow-reducer') &&
              reducerAtEnd(s, 'start')}
            {(cutById[s.id]?.endRole === 'tee-run-reducer' ||
              cutById[s.id]?.endRole === 'wye-run-reducer' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              reducerAtEnd(s, 'end')}
            {(cutById[s.id]?.startRole === 'elbow' ||
              cutById[s.id]?.startRole === 'elbow-reducer') &&
              cutById[s.id]?.startFittingId === 'elbow45_long' &&
              elbow45Mark(s, 'start', 'L45°')}
            {(cutById[s.id]?.endRole === 'elbow' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              cutById[s.id]?.endFittingId === 'elbow45_long' &&
              elbow45Mark(s, 'end', 'L45°')}
            {(cutById[s.id]?.startRole === 'elbow' ||
              cutById[s.id]?.startRole === 'elbow-reducer') &&
              cutById[s.id]?.startFittingId === 'elbow45_short' &&
              elbow45Mark(s, 'start', 'S45°')}
            {(cutById[s.id]?.endRole === 'elbow' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              cutById[s.id]?.endFittingId === 'elbow45_short' &&
              elbow45Mark(s, 'end', 'S45°')}
            {(cutById[s.id]?.startRole === 'elbow' ||
              cutById[s.id]?.startRole === 'elbow-reducer') &&
              cutById[s.id]?.startFittingId === 'elbow90_short' &&
              elbowShortMark(s, 'start')}
            {(cutById[s.id]?.endRole === 'elbow' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              cutById[s.id]?.endFittingId === 'elbow90_short' &&
              elbowShortMark(s, 'end')}
            {effectiveSlopeDenom(s, baseSlopeDenom) != null &&
              slopeMark(s, effectiveSlopeDenom(s, baseSlopeDenom)!)}
            {eff?.showSizeLabel &&
              eff.size &&
              cutById[s.id]?.startConnected &&
              cutById[s.id]?.endConnected &&
              (() => {
                const resolvedPos = resolvedLabels.get(`seg-${s.id}`)
                const cx = resolvedPos?.cx ?? (s.start.x + s.end.x) / 2
                const cy = resolvedPos?.cy ?? (s.start.y + s.end.y) / 2 - 10
                return (
                  <text className="seg-label" x={cx} y={cy} textAnchor="middle">
                    {eff.size}
                  </text>
                )
              })()}
            {eff?.size &&
              cutById[s.id] &&
              !cutById[s.id].startConnected &&
              terminusSize(s, 'start', eff.size)}
            {eff?.size &&
              cutById[s.id] &&
              !cutById[s.id].endConnected &&
              terminusSize(s, 'end', eff.size)}
            {(() => {
              const c = cutById[s.id]
              if (!c || c.status === 'none') return null
              let t = 0.5
              if (!c.startConnected && c.endConnected) t = 0.3
              else if (c.startConnected && !c.endConnected) t = 0.7
              const mx = s.start.x + (s.end.x - s.start.x) * t
              const my = s.start.y + (s.end.y - s.start.y) * t
              const markPos = nearestElbow45Mark(elbow45Marks, mx, my)
              const side = chooseDimSide(s.start, s.end, markPos ?? undefined)
              const geom = dimGeometry(s.start, s.end, side, 1)
              const extStart = dimExtensionLine(s.start, side, 1)
              const extEnd = dimExtensionLine(s.end, side, 1)
              const line1Resolved = resolvedLabels.get(`dim-line1-${s.id}`)
              const line1X = line1Resolved?.cx ?? geom.text1X
              const line1Y = line1Resolved?.cy ?? geom.text1Y
              const line2Resolved = resolvedLabels.get(`dim-line2-${s.id}`)
              const line2X = line2Resolved?.cx ?? geom.text2X
              const line2Y = line2Resolved?.cy ?? geom.text2Y
              // 近接する他区間のラベルと重なるため押し出された場合、文字の位置と
              // 本来の寸法線上の位置が離れてしまい、どちらの配管の数字か分かり
              // づらくなる。一定以上ずれたときだけ、細い引き出し線でつなぐ。
              const origAnchorX = (geom.text1X + geom.text2X) / 2
              const origAnchorY = (geom.text1Y + geom.text2Y) / 2
              const resolvedAnchorX = (line1X + line2X) / 2
              const resolvedAnchorY = (line1Y + line2Y) / 2
              const leaderNeeded =
                Math.hypot(resolvedAnchorX - origAnchorX, resolvedAnchorY - origAnchorY) > 8
              return (
                <g className="dim-group">
                  <line
                    className="dim-ext-line"
                    x1={extStart.x1}
                    y1={extStart.y1}
                    x2={extStart.x2}
                    y2={extStart.y2}
                  />
                  <line
                    className="dim-ext-line"
                    x1={extEnd.x1}
                    y1={extEnd.y1}
                    x2={extEnd.x2}
                    y2={extEnd.y2}
                  />
                  <line
                    className="dim-line"
                    x1={geom.line.x1}
                    y1={geom.line.y1}
                    x2={geom.line.x2}
                    y2={geom.line.y2}
                  />
                  <polygon className="dim-arrow" points={geom.arrowStart} />
                  <polygon className="dim-arrow" points={geom.arrowEnd} />
                  {leaderNeeded && (
                    <line
                      className="dim-leader-line"
                      x1={origAnchorX}
                      y1={origAnchorY}
                      x2={resolvedAnchorX}
                      y2={resolvedAnchorY}
                    />
                  )}
                  {/* 現合(現物合わせ)区間: 画面表示と同じく、確定寸法として誤読
                      されないよう専用の1行注記表示にする（印刷でこそ誤読を
                      避ける意味が大きいため、画面と同じロジックを使う）。
                      補足メモは画面上ではタップして確認するアイコンだが、
                      印刷は操作できないため、2行目レーン(現合では未使用)に
                      そのまま文字で出す。 */}
                  {s.isGenGou ? (
                    <>
                      <text
                        className="dim-gengou"
                        x={line1X}
                        y={line1Y}
                        textAnchor="middle"
                        transform={`rotate(${geom.textRotateDeg} ${line1X} ${line1Y})`}
                      >
                        {genGouLabelText(s.genGouQualifier, s.genGouDimension)}
                      </text>
                      {s.genGouNote && (
                        <text
                          className="dim-gengou-note"
                          x={line2X}
                          y={line2Y}
                          textAnchor="middle"
                          transform={`rotate(${geom.textRotateDeg} ${line2X} ${line2Y})`}
                        >
                          {`メモ: ${truncateGenGouNote(s.genGouNote)}`}
                        </text>
                      )}
                    </>
                  ) : (
                    <>
                  <text
                    className="dim-center"
                    x={line1X}
                    y={line1Y}
                    textAnchor="middle"
                    transform={`rotate(${geom.textRotateDeg} ${line1X} ${line1Y})`}
                  >
                    {c.mode} {c.center}
                  </text>
                  {c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe && (
                    <text
                      className={`dim-cut${c.socketWeldGapWarning || c.threadNearMinNipple ? ' tight' : ''}`}
                      x={line2X}
                      y={line2Y}
                      textAnchor="middle"
                      transform={`rotate(${geom.textRotateDeg} ${line2X} ${line2Y})`}
                    >
                      (切 {c.cut}
                      {c.socketWeldGapWarning ? '（溶接代不足）' : ''}
                      {c.threadNearMinNipple ? '（丸ニップル推奨）' : ''})
                    </text>
                  )}
                  {c.status === 'ok' && c.threadTooShortForPipe && (
                    <text
                      className="dim-cut over"
                      x={line2X}
                      y={line2Y}
                      textAnchor="middle"
                      transform={`rotate(${geom.textRotateDeg} ${line2X} ${line2Y})`}
                    >
                      加工不可能（丸ニップル使用）
                    </text>
                  )}
                  {c.status === 'ok' && c.vpTsTooShortForPipe && (
                    <text
                      className="dim-cut over"
                      x={line2X}
                      y={line2Y}
                      textAnchor="middle"
                      transform={`rotate(${geom.textRotateDeg} ${line2X} ${line2Y})`}
                    >
                      加工不可能（差込み代不足）
                    </text>
                  )}
                  {c.status === 'zero' && (
                    <text
                      className="dim-cut zero"
                      x={line2X}
                      y={line2Y}
                      textAnchor="middle"
                      transform={`rotate(${geom.textRotateDeg} ${line2X} ${line2Y})`}
                    >
                      {c.reducerH != null
                        ? `レジューサー H=${c.reducerH}（継手直結）`
                        : 'パイプ0（継手直結）'}
                    </text>
                  )}
                  {c.status === 'over' && (
                    <text
                      className="dim-cut over"
                      x={line2X}
                      y={line2Y}
                      textAnchor="middle"
                      transform={`rotate(${geom.textRotateDeg} ${line2X} ${line2Y})`}
                    >
                      継手不足
                    </text>
                  )}
                    </>
                  )}
                </g>
              )
            })()}
          </g>
        )
      })}

      {/* 通り寸法（曲がるまで一直線に続く区間の合計）。既存の寸法線より
          外側のレーンに1本引く。画面側(DrawingCanvas)と同じ考え方。 */}
      {throughRuns.map((run) => {
        if (run.total == null) return null
        const first = segments.find((x) => x.id === run.ids[0])
        if (!first) return null
        const markPos = nearestElbow45Mark(
          elbow45Marks,
          (run.start.x + run.end.x) / 2,
          (run.start.y + run.end.y) / 2,
        )
        const side = chooseDimSide(first.start, first.end, markPos ?? undefined)
        const g = dimGeometry(run.start, run.end, side, 1, DIM_THROUGH_STANDOFF)
        const e1 = dimExtensionLine(run.start, side, 1, DIM_THROUGH_STANDOFF)
        const e2 = dimExtensionLine(run.end, side, 1, DIM_THROUGH_STANDOFF)
        return (
          <g key={`through-${run.ids[0]}`} className="dim-group">
            <line className="dim-ext-line" x1={e1.x1} y1={e1.y1} x2={e1.x2} y2={e1.y2} />
            <line className="dim-ext-line" x1={e2.x1} y1={e2.y1} x2={e2.x2} y2={e2.y2} />
            <line className="dim-line" x1={g.line.x1} y1={g.line.y1} x2={g.line.x2} y2={g.line.y2} />
            <polygon className="dim-arrow" points={g.arrowStart} />
            <polygon className="dim-arrow" points={g.arrowEnd} />
            <text
              className="dim-through"
              x={g.text1X}
              y={g.text1Y}
              textAnchor="middle"
              transform={`rotate(${g.textRotateDeg} ${g.text1X} ${g.text1Y})`}
            >
              全長 {run.total}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
