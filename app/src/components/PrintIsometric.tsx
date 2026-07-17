import { useMemo } from 'react'
import type { Point, Segment } from '../types'
import { distance } from '../lib/isometric'
import { breakLine } from '../lib/crossover'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import {
  estimateTextWidth,
  resolveOverlaps,
  type LabelBox,
  type LabelJob,
} from '../lib/labelLayout'

interface Props {
  segments: Segment[]
  effectiveById: Record<string, Effective>
  crossoverGaps: Record<string, number[]>
  cutById: Record<string, CutResult>
}

const CROSS_GAP = 9

// アイソメ図上に実際に表示される「45°」マークの位置を全て求める
// （描画条件と同じ: 継手が elbow45_long のセグメント自身のエルボ端）。
// この位置は、そのマークを描いているセグメント自身だけでなく、ノードを
// 共有する隣接セグメント（キック区間など）の寸法ラベルからも見えるため、
// 寸法ラベル側は「自分がその継手を持っているか」ではなく「近くにマークが
// 実在するか」で反対側へ避ける必要がある。
function allElbow45MarkPositions(
  segments: Segment[],
  effectiveById: Record<string, Effective>,
  cutById: Record<string, CutResult>,
): Point[] {
  const marks: Point[] = []
  for (const s of segments) {
    const eff = effectiveById[s.id]
    if (eff?.fitting !== 'elbow45_long') continue
    const c = cutById[s.id]
    if (!c) continue
    for (const at of ['start', 'end'] as const) {
      const role = at === 'start' ? c.startRole : c.endRole
      if (role !== 'elbow' && role !== 'elbow-reducer') continue
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
}: Props) {
  const resolvedLabels = useMemo(() => {
    const jobs: LabelJob[] = []
    const elbow45Marks = allElbow45MarkPositions(segments, effectiveById, cutById)
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
    for (const s of segments) {
      const c = cutById[s.id]
      if (!c || c.status === 'none') continue
      let t = 0.5
      if (!c.startConnected && c.endConnected) t = 0.3
      else if (c.startConnected && !c.endConnected) t = 0.7
      const mx = s.start.x + (s.end.x - s.start.x) * t
      const my = s.start.y + (s.end.y - s.start.y) * t
      const line1 = `${c.mode} ${c.center}`
      const line2 =
        c.status === 'ok'
          ? c.threadTooShortForPipe
            ? '加工不可能（丸ニップル使用）'
            : c.vpTsTooShortForPipe
              ? '加工不可能（差込み代不足）'
              : `切 ${c.cut}${c.socketWeldGapWarning ? '（溶接代不足）' : ''}${c.threadNearMinNipple ? '（丸ニップル推奨）' : ''}`
          : c.status === 'zero'
            ? 'パイプ0（継手直結）'
            : '継手不足'
      const fs2 = c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe ? 12.5 : 11
      const w =
        Math.max(estimateTextWidth(line1, 10.5), estimateTextWidth(line2, fs2)) + 6
      const len = distance(s.start, s.end) || 1
      const dx = (s.end.x - s.start.x) / len
      const dy = (s.end.y - s.start.y) / len
      let perpX = -dy
      let perpY = dx
      const markPos = nearestElbow45Mark(elbow45Marks, mx, my)
      if (markPos) {
        const toMarkX = markPos.x - mx
        const toMarkY = markPos.y - my
        if (perpX * toMarkX + perpY * toMarkY > 0) {
          perpX = -perpX
          perpY = -perpY
        }
      } else if (perpY < 0) {
        perpX = -perpX
        perpY = -perpY
      }
      jobs.push({
        key: `dim-${s.id}`,
        cx: mx + perpX * 22,
        cy: my + perpY * 22,
        w,
        h: 32,
        pushX: perpX,
        pushY: perpY,
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
    // 45°エルボの「45°」マークも、寸法ラベルが重なって文字が読めなくならないよう
    // 固定の回避領域として扱う（特に短いキック区間ではマークと寸法が近接しがち）。
    const elbow45Obstacles: LabelBox[] = []
    for (const s of segments) {
      const eff = effectiveById[s.id]
      if (eff?.fitting !== 'elbow45_long') continue
      const c = cutById[s.id]
      for (const at of ['start', 'end'] as const) {
        const role = at === 'start' ? c?.startRole : c?.endRole
        if (role !== 'elbow' && role !== 'elbow-reducer') continue
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
    return resolveOverlaps(jobs, [...crossObstacles, ...elbow45Obstacles])
  }, [segments, cutById, effectiveById, crossoverGaps])

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
    const half = 8
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

  // 45°エルボを使用した端に「45°」マークを表示（90°エルボとの区別を現場ですぐ判別できるように）
  function elbow45Mark(s: Segment, at: 'start' | 'end') {
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
        45°
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
              cutById[s.id]?.startRole === 'elbow-reducer') &&
              reducerAtEnd(s, 'start')}
            {(cutById[s.id]?.endRole === 'tee-run-reducer' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              reducerAtEnd(s, 'end')}
            {(cutById[s.id]?.startRole === 'elbow' ||
              cutById[s.id]?.startRole === 'elbow-reducer') &&
              eff?.fitting === 'elbow45_long' &&
              elbow45Mark(s, 'start')}
            {(cutById[s.id]?.endRole === 'elbow' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              eff?.fitting === 'elbow45_long' &&
              elbow45Mark(s, 'end')}
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
              const resolvedPos = resolvedLabels.get(`dim-${s.id}`)
              const cx = resolvedPos?.cx ?? mx
              const cCenter = resolvedPos?.cy ?? my + 22
              const y1 = cCenter - 8
              const y2 = cCenter + 8
              return (
                <>
                  <text className="dim-center" x={cx} y={y1} textAnchor="middle">
                    {c.mode} {c.center}
                  </text>
                  {c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe && (
                    <text
                      className={`dim-cut${c.socketWeldGapWarning || c.threadNearMinNipple ? ' tight' : ''}`}
                      x={cx}
                      y={y2}
                      textAnchor="middle"
                    >
                      切 {c.cut}
                      {c.socketWeldGapWarning ? '（溶接代不足）' : ''}
                      {c.threadNearMinNipple ? '（丸ニップル推奨）' : ''}
                    </text>
                  )}
                  {c.status === 'ok' && c.threadTooShortForPipe && (
                    <text className="dim-cut over" x={cx} y={y2} textAnchor="middle">
                      加工不可能（丸ニップル使用）
                    </text>
                  )}
                  {c.status === 'ok' && c.vpTsTooShortForPipe && (
                    <text className="dim-cut over" x={cx} y={y2} textAnchor="middle">
                      加工不可能（差込み代不足）
                    </text>
                  )}
                  {c.status === 'zero' && (
                    <text className="dim-cut zero" x={cx} y={y2} textAnchor="middle">
                      パイプ0（継手直結）
                    </text>
                  )}
                  {c.status === 'over' && (
                    <text className="dim-cut over" x={cx} y={y2} textAnchor="middle">
                      継手不足
                    </text>
                  )}
                </>
              )
            })()}
          </g>
        )
      })}
    </svg>
  )
}
