import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point, Segment } from '../types'
import {
  distance,
  distanceToSegment,
  isometricGrid,
  snapToEndpoints,
  snapToIsometric,
} from '../lib/isometric'

interface Props {
  segments: Segment[]
  selectedId: string | null
  onAddSegment: (seg: Omit<Segment, 'id'>) => void
  /** ロングタップでセグメントを選択したとき（メニュー表示位置を画面座標で渡す） */
  onLongPressSegment: (id: string, clientX: number, clientY: number) => void
}

// 指を動かして「描画」と判定するまでの移動量(px)。これ未満なら静止扱い。
const MOVE_THRESHOLD = 8
// ロングタップ（長押し）と判定するまでの時間(ms)
const LONG_PRESS_MS = 500
// 端点どうしを連結するための吸着距離(px)
const ENDPOINT_SNAP = 24
// ロングタップ位置からセグメントを拾うヒット距離(px)
const HIT_DIST = 18
// アイソメグリッドの間隔(px)
const GRID_GAP = 40

export function DrawingCanvas({
  segments,
  selectedId,
  onAddSegment,
  onLongPressSegment,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  // 描画中のプレビュー線（スナップ後）
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  // キャンバスの実サイズ（グリッド生成用）
  const [size, setSize] = useState({ w: 0, h: 0 })

  // ジェスチャ状態
  const startLocalRef = useRef<Point | null>(null)
  const startClientRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const longFiredRef = useRef(false)
  const longTimerRef = useRef<number | null>(null)

  // キャンバスサイズを監視してグリッドに反映
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

  function allEndpoints(): Point[] {
    const pts: Point[] = []
    for (const s of segments) pts.push(s.start, s.end)
    return pts
  }

  // 指定点の近くにあるセグメントを1つ返す（無ければ null）
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

  function clearLongTimer() {
    if (longTimerRef.current !== null) {
      clearTimeout(longTimerRef.current)
      longTimerRef.current = null
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    svgRef.current?.setPointerCapture(e.pointerId)
    const local = toLocal(e.clientX, e.clientY)
    startLocalRef.current = local
    startClientRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = false
    longFiredRef.current = false
    setPreview(null)

    // 指を止めたまま LONG_PRESS_MS 経過したら選択（描画開始していなければ）
    clearLongTimer()
    longTimerRef.current = window.setTimeout(() => {
      if (movedRef.current) return
      const seg = hitSegment(local)
      if (seg && startClientRef.current) {
        longFiredRef.current = true
        onLongPressSegment(seg.id, startClientRef.current.x, startClientRef.current.y)
      }
    }, LONG_PRESS_MS)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const start = startLocalRef.current
    if (!start || longFiredRef.current) return
    const p = toLocal(e.clientX, e.clientY)
    if (!movedRef.current && distance(start, p) > MOVE_THRESHOLD) {
      // 動いた → 描画モードに確定（ロングタップはキャンセル）
      movedRef.current = true
      clearLongTimer()
    }
    if (movedRef.current) {
      const snappedStart = snapToEndpoints(start, allEndpoints(), ENDPOINT_SNAP)
      const { end } = snapToIsometric(snappedStart, p)
      setPreview({ start: snappedStart, end })
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    clearLongTimer()
    const start = startLocalRef.current
    startLocalRef.current = null
    startClientRef.current = null

    if (longFiredRef.current) {
      // ロングタップ選択済み → 描画はしない
      setPreview(null)
      return
    }
    if (start && movedRef.current) {
      const p = toLocal(e.clientX, e.clientY)
      const snappedStart = snapToEndpoints(start, allEndpoints(), ENDPOINT_SNAP)
      const { end, angle } = snapToIsometric(snappedStart, p)
      const snappedEnd = snapToEndpoints(end, allEndpoints(), ENDPOINT_SNAP)
      onAddSegment({ start: snappedStart, end: snappedEnd, angle })
    }
    // 静止したままの短いタップは何もしない（描画の妨げにしない）
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
      {/* アイソメ（等角投影）グリッド：30°/150° の菱形パターン */}
      <g className="iso-grid" pointerEvents="none">
        {gridLines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>

      {/* 確定済みセグメント（タップ判定は JS 側のヒットテストで行うため pointerEvents は無効） */}
      {segments.map((s) => {
        const selected = s.id === selectedId
        return (
          <g key={s.id} pointerEvents="none">
            <line
              x1={s.start.x}
              y1={s.start.y}
              x2={s.end.x}
              y2={s.end.y}
              stroke={selected ? '#f59e0b' : '#38bdf8'}
              strokeWidth={selected ? 5 : 3}
              strokeLinecap="round"
            />
            <circle cx={s.start.x} cy={s.start.y} r={4} fill="#94a3b8" />
            <circle cx={s.end.x} cy={s.end.y} r={4} fill="#94a3b8" />
            {s.size && (
              <text
                className="seg-label"
                x={(s.start.x + s.end.x) / 2}
                y={(s.start.y + s.end.y) / 2 - 8}
                textAnchor="middle"
              >
                {s.size}
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
