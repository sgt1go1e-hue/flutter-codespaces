import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point, Segment } from '../types'
import {
  distance,
  distanceToSegment,
  isometricGrid,
  snapSegmentToGrid,
} from '../lib/isometric'
import { breakLine } from '../lib/crossover'
import type { Effective } from '../lib/inheritance'

interface Props {
  segments: Segment[]
  selectedId: string | null
  onAddSegment: (seg: Omit<Segment, 'id'>) => void
  /** ロングタップでセグメントを選択したとき（メニュー表示位置を画面座標で渡す） */
  onLongPressSegment: (id: string, clientX: number, clientY: number) => void
  /** 各セグメントの実効属性（継承後） */
  effectiveById: Record<string, Effective>
  /** またぎ表示で線を途切れさせる位置（セグメント上パラメータ 0〜1） */
  crossoverGaps: Record<string, number[]>
  /** パーツドラッグ中など、キャンバス入力を一時無効化する */
  inputDisabled: boolean
}

// 指を動かして「描画」と判定するまでの移動量(px)。これ未満なら静止扱い。
const MOVE_THRESHOLD = 7
// 引き始めの猶予(ms)。タッチ直後この時間は長押し判定を開始しない
//（この間に動けば素直に描画になり、選択の誤爆を防ぐ）。
const ARM_DELAY = 180
// 猶予後、静止し続けたときに選択（長押し）と確定するまでの保持時間(ms)。
// 選択までの合計は ARM_DELAY + LONG_PRESS_HOLD ≈ 530ms（従来と同等の感触）。
const LONG_PRESS_HOLD = 350
// ロングタップ位置からセグメントを拾うヒット距離(px)
const HIT_DIST = 18
// アイソメグリッドの間隔(px)＝格子スナップの基準
const GRID_GAP = 40
// またぎ表示の途切れ幅(px)
const CROSS_GAP = 9

export function DrawingCanvas({
  segments,
  selectedId,
  onAddSegment,
  onLongPressSegment,
  effectiveById,
  crossoverGaps,
  inputDisabled,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [size, setSize] = useState({ w: 0, h: 0 })

  // ジェスチャ状態
  const startLocalRef = useRef<Point | null>(null)
  const startClientRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const longFiredRef = useRef(false)
  // 引き始めの猶予タイマーと、その後の長押し保持タイマー
  const armTimerRef = useRef<number | null>(null)
  const holdTimerRef = useRef<number | null>(null)

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

  function clearTimers() {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current)
      armTimerRef.current = null
    }
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (inputDisabled) return
    svgRef.current?.setPointerCapture(e.pointerId)
    const local = toLocal(e.clientX, e.clientY)
    startLocalRef.current = local
    startClientRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = false
    longFiredRef.current = false
    setPreview(null)

    clearTimers()
    // 第1段階: 引き始めの猶予。この間に動けば描画になり、長押しは開始しない。
    armTimerRef.current = window.setTimeout(() => {
      if (movedRef.current) return
      // 猶予後も静止 → 第2段階: 長押し保持タイマーを開始。
      holdTimerRef.current = window.setTimeout(() => {
        if (movedRef.current) return
        const seg = hitSegment(local)
        if (seg && startClientRef.current) {
          longFiredRef.current = true
          onLongPressSegment(
            seg.id,
            startClientRef.current.x,
            startClientRef.current.y,
          )
        }
      }, LONG_PRESS_HOLD)
    }, ARM_DELAY)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const start = startLocalRef.current
    if (!start || longFiredRef.current) return
    const p = toLocal(e.clientX, e.clientY)
    if (!movedRef.current && distance(start, p) > MOVE_THRESHOLD) {
      movedRef.current = true
      clearTimers()
    }
    if (movedRef.current) {
      // グリッド交点間・アイソメ角に拘束したプレビュー
      const { start: s, end } = snapSegmentToGrid(start, p, GRID_GAP)
      setPreview({ start: s, end })
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    clearTimers()
    const start = startLocalRef.current
    startLocalRef.current = null
    startClientRef.current = null

    if (longFiredRef.current) {
      setPreview(null)
      return
    }
    if (start && movedRef.current) {
      const p = toLocal(e.clientX, e.clientY)
      const { start: s, end, angle } = snapSegmentToGrid(start, p, GRID_GAP)
      onAddSegment({ start: s, end, angle })
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
