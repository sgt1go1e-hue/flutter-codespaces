import { useRef, useState } from 'react'
import type { Point, Segment } from '../types'
import {
  distance,
  snapToEndpoints,
  snapToIsometric,
} from '../lib/isometric'

interface Props {
  segments: Segment[]
  selectedId: string | null
  onAddSegment: (seg: Omit<Segment, 'id'>) => void
  onSelect: (id: string | null) => void
}

// タップ（選択）と描画（線引き）を区別する移動量のしきい値(px)
const TAP_THRESHOLD = 8
// 端点どうしを連結するための吸着距離(px)
const ENDPOINT_SNAP = 24

export function DrawingCanvas({
  segments,
  selectedId,
  onAddSegment,
  onSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  // 描画中のストローク（生の指の軌跡）
  const [stroke, setStroke] = useState<Point[]>([])
  // スナップ後のプレビュー線
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const drawingRef = useRef(false)

  // クライアント座標を SVG 内座標へ変換
  function toLocal(e: React.PointerEvent): Point {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // 既存セグメントの端点一覧（連結吸着用）
  function allEndpoints(): Point[] {
    const pts: Point[] = []
    for (const s of segments) {
      pts.push(s.start, s.end)
    }
    return pts
  }

  function handlePointerDown(e: React.PointerEvent) {
    // 背景（SVG 自身）からの入力のみ描画開始。セグメント線のタップは別ハンドラ。
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    const p = toLocal(e)
    setStroke([p])
    setPreview(null)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drawingRef.current) return
    const p = toLocal(e)
    setStroke((prev) => {
      const next = [...prev, p]
      const start = next[0]
      if (distance(start, p) > TAP_THRESHOLD) {
        const snappedStart = snapToEndpoints(start, allEndpoints(), ENDPOINT_SNAP)
        const { end } = snapToIsometric(snappedStart, p)
        setPreview({ start: snappedStart, end })
      }
      return next
    })
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drawingRef.current) return
    drawingRef.current = false
    const p = toLocal(e)
    const start = stroke[0] ?? p
    const moved = distance(start, p)

    if (moved <= TAP_THRESHOLD) {
      // ほとんど動いていない → 背景タップ = 選択解除
      onSelect(null)
    } else {
      // 始点を既存端点へ吸着 → アイソメ角へスナップ
      const snappedStart = snapToEndpoints(start, allEndpoints(), ENDPOINT_SNAP)
      const { end, angle } = snapToIsometric(snappedStart, p)
      // 終点も既存端点へ吸着できれば連結する
      const snappedEnd = snapToEndpoints(end, allEndpoints(), ENDPOINT_SNAP)
      onAddSegment({ start: snappedStart, end: snappedEnd, angle })
    }
    setStroke([])
    setPreview(null)
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
      {/* 確定済みセグメント */}
      {segments.map((s) => {
        const selected = s.id === selectedId
        return (
          <g key={s.id}>
            {/* タップ判定を広げるための透明な太線 */}
            <line
              x1={s.start.x}
              y1={s.start.y}
              x2={s.end.x}
              y2={s.end.y}
              stroke="transparent"
              strokeWidth={24}
              strokeLinecap="round"
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => {
                // 背景の描画開始を抑止してセグメント選択に切り替える
                e.stopPropagation()
                onSelect(s.id)
              }}
            />
            {/* 見た目の線 */}
            <line
              x1={s.start.x}
              y1={s.start.y}
              x2={s.end.x}
              y2={s.end.y}
              stroke={selected ? '#f59e0b' : '#38bdf8'}
              strokeWidth={selected ? 5 : 3}
              strokeLinecap="round"
              pointerEvents="none"
            />
            {/* 端点マーカー */}
            <circle cx={s.start.x} cy={s.start.y} r={4} fill="#94a3b8" pointerEvents="none" />
            <circle cx={s.end.x} cy={s.end.y} r={4} fill="#94a3b8" pointerEvents="none" />
          </g>
        )
      })}

      {/* 描画中のプレビュー（スナップ後の線） */}
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
