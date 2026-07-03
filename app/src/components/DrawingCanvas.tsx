import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point, Segment } from '../types'
import {
  distance,
  distanceToSegment,
  isometricGrid,
  latticeStep,
  projectOnSegment,
  snapEndFromStart,
  snapToLattice,
} from '../lib/isometric'
import { breakLine } from '../lib/crossover'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'

interface Props {
  segments: Segment[]
  selectedId: string | null
  onAddSegment: (seg: Omit<Segment, 'id'>) => void
  /** 線をタップして選択したとき */
  onSelectSegment: (id: string) => void
  /** 何もない場所をタップしたとき（選択解除用） */
  onBackgroundTap: () => void
  /** 各セグメントの実効属性（継承後） */
  effectiveById: Record<string, Effective>
  /** またぎ表示で線を途切れさせる位置（セグメント上パラメータ 0〜1） */
  crossoverGaps: Record<string, number[]>
  /** 各区間の切断（加工）寸法 */
  cutById: Record<string, CutResult>
  /** パーツドラッグ中など、キャンバス入力を一時無効化する */
  inputDisabled: boolean
}

// 指を動かして「描画」と判定するまでの移動量(px)。これ未満はタップ扱い。
// タップ（動かさず離す）=選択、ドラッグ（動かす）=描画、と明確に分ける。
const MOVE_THRESHOLD = 7
// タップ位置からセグメントを拾うヒット距離(px)
const HIT_DIST = 18
// アイソメグリッドの間隔(px)＝格子スナップの基準
const GRID_GAP = 40
// またぎ表示の途切れ幅(px)
const CROSS_GAP = 9
// 描画開始点を既存線上の格子点へ吸着する距離(px)。分岐の接続を確実にする。
const START_SNAP = 18

export function DrawingCanvas({
  segments,
  selectedId,
  onAddSegment,
  onSelectSegment,
  onBackgroundTap,
  effectiveById,
  crossoverGaps,
  cutById,
  inputDisabled,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [size, setSize] = useState({ w: 0, h: 0 })

  // ジェスチャ状態
  const startLocalRef = useRef<Point | null>(null)
  const movedRef = useRef(false)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gridLines = useMemo(
    () => isometricGrid(size.w, size.h, GRID_GAP),
    [size.w, size.h],
  )

  function toLocal(clientX: number, clientY: number): Point {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function hitSegment(p: Point): Segment | null {
    let best: Segment | null = null
    let bestDist = HIT_DIST
    for (const s of segments) {
      const d = distanceToSegment(p, s.start, s.end)
      if (d <= bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }

  // 描画開始点のスナップ。既存線の近くなら、その線上の格子点へ吸着して
  // 分岐（チーズ）が確実に接続するようにする。それ以外は通常の格子スナップ。
  function snapStart(raw: Point): Point {
    const global = snapToLattice(raw, GRID_GAP)
    // すでにいずれかの線上に乗っていればそのまま
    for (const s of segments) {
      if (distanceToSegment(global, s.start, s.end) < 1.5) return global
    }
    // 近くの線を探し、その線上の最寄り格子点へ
    let best: Segment | null = null
    let bestDist = START_SNAP
    for (const s of segments) {
      const d = distanceToSegment(raw, s.start, s.end)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    if (!best) return global
    const len = distance(best.start, best.end) || 1
    const dir = { x: (best.end.x - best.start.x) / len, y: (best.end.y - best.start.y) / len }
    const { t } = projectOnSegment(raw, best.start, best.end)
    const step = latticeStep(best.angle, GRID_GAP)
    const maxK = Math.round(len / step)
    const k = Math.max(0, Math.min(maxK, Math.round((t * len) / step)))
    return { x: best.start.x + dir.x * step * k, y: best.start.y + dir.y * step * k }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (inputDisabled) return
    svgRef.current?.setPointerCapture(e.pointerId)
    startLocalRef.current = toLocal(e.clientX, e.clientY)
    movedRef.current = false
    setPreview(null)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const start = startLocalRef.current
    if (!start) return
    const p = toLocal(e.clientX, e.clientY)
    if (!movedRef.current && distance(start, p) > MOVE_THRESHOLD) {
      movedRef.current = true
    }
    if (movedRef.current) {
      // グリッド交点間・アイソメ角に拘束したプレビュー
      const s = snapStart(start)
      const { end } = snapEndFromStart(s, p, GRID_GAP)
      setPreview({ start: s, end })
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const start = startLocalRef.current
    startLocalRef.current = null

    if (start && movedRef.current) {
      // ドラッグ = 描画
      const p = toLocal(e.clientX, e.clientY)
      const s = snapStart(start)
      const { end, angle } = snapEndFromStart(s, p, GRID_GAP)
      onAddSegment({ start: s, end, angle })
    } else if (start) {
      // タップ（動かさず離す）= 線上なら選択、そうでなければ選択解除
      const seg = hitSegment(start)
      if (seg) onSelectSegment(seg.id)
      else onBackgroundTap()
    }
    setPreview(null)
  }

  // フランジ記号を端点に描く。
  // 'double'(両) = 配管に直交する短い2本線、'single'(片) = 1本線（終端エンド）。
  function flangeMarker(
    s: Segment,
    at: 'start' | 'end',
    type: 'double' | 'single',
  ) {
    const pt = at === 'start' ? s.start : s.end
    // 端点での配管方向（端点から内側へ向かう向き）
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
    if (type === 'single') {
      // 片フランジ（終端）: 端点に1本のみ
      return <>{bar(pt.x, pt.y, 0)}</>
    }
    // 両フランジ: 接続点を挟んで前後に1本ずつ（合計2本のペア表現）。
    // 分割した A.endFlange と B.startFlange は同じ2位置を描くため、重なって
    // ちょうど2本に見える（ペアのボルト締結を表す一般的な記号）。
    const off = 4
    return (
      <>
        {bar(pt.x - ux * off, pt.y - uy * off, 0)}
        {bar(pt.x + ux * off, pt.y + uy * off, 1)}
      </>
    )
  }

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* アイソメ格子：30°/150° の菱形パターン（描画はこの交点間に拘束される） */}
      <g className="iso-grid" pointerEvents="none">
        {gridLines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>

      {/* 確定済みセグメント */}
      {segments.map((s) => {
        const selected = s.id === selectedId
        const eff = effectiveById[s.id]
        const resolved = eff?.resolved ?? false
        // 色: 選択=橙 / 属性確定=水色 / 未確定=グレー
        const stroke = selected ? '#f59e0b' : resolved ? '#38bdf8' : '#64748b'
        const dashed = !resolved && !selected
        const pieces = breakLine(
          s.start,
          s.end,
          crossoverGaps[s.id] ?? [],
          CROSS_GAP,
        )
        return (
          <g key={s.id} pointerEvents="none">
            {pieces.map((pc, i) => (
              <line
                key={i}
                x1={pc.a.x}
                y1={pc.a.y}
                x2={pc.b.x}
                y2={pc.b.y}
                stroke={stroke}
                strokeWidth={selected ? 5 : 3}
                strokeLinecap="round"
                strokeDasharray={dashed ? '6 5' : undefined}
              />
            ))}
            <circle cx={s.start.x} cy={s.start.y} r={4} fill="#94a3b8" />
            <circle cx={s.end.x} cy={s.end.y} r={4} fill="#94a3b8" />
            {s.startFlange && flangeMarker(s, 'start', s.startFlange)}
            {s.endFlange && flangeMarker(s, 'end', s.endFlange)}
            {/* サイズは「切り替わった地点」だけに1箇所表示（データは全保持） */}
            {eff?.showSizeLabel && eff.size && (
              <text
                className="seg-label"
                x={(s.start.x + s.end.x) / 2}
                y={(s.start.y + s.end.y) / 2 - 10}
                textAnchor="middle"
              >
                {eff.size}
              </text>
            )}
            {/* 切断（加工）寸法。芯々寸法が入力された区間に表示 */}
            {cutById[s.id]?.cut != null && (
              <text
                className="cut-label"
                x={(s.start.x + s.end.x) / 2}
                y={(s.start.y + s.end.y) / 2 + 16}
                textAnchor="middle"
              >
                ✂ {cutById[s.id].cut}
              </text>
            )}
          </g>
        )
      })}

      {/* 描画中のプレビュー */}
      {preview && (
        <line
          x1={preview.start.x}
          y1={preview.start.y}
          x2={preview.end.x}
          y2={preview.end.y}
          stroke="#22c55e"
          strokeWidth={3}
          strokeDasharray="8 6"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
    </svg>
  )
}
