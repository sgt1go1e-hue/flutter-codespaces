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

  // 末端（フリー端）に呼び径ラベルを描く。手書きアイソメと同様、各配管の
  // 開放端に「100A」「50A」などのサイズを載せ、どの径の配管か一目で分かるようにする。
  // ラベル自体をタップするとその区間を選択し、サイズをすぐ変更できる（大きめの当たり判定）。
  function terminusSize(s: Segment, at: 'start' | 'end', size: string) {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    // 端点から外側（配管の反対方向）へ少しずらして配置
    const ox = (pt.x - other.x) / len
    const oy = (pt.y - other.y) / len
    const cx = pt.x + ox * 22
    const cy = pt.y + oy * 22
    // タップでその区間を選択（線が細くても押しやすいよう当たり判定を広めに）
    const onTap = (e: React.PointerEvent) => {
      e.stopPropagation()
      onSelectSegment(s.id)
    }
    return (
      <g pointerEvents="auto" style={{ cursor: 'pointer' }} onPointerDown={onTap}>
        <rect
          x={cx - 22}
          y={cy - 13}
          width={44}
          height={26}
          rx={6}
          fill="transparent"
        />
        <text
          className="seg-label terminus"
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {size}
        </text>
      </g>
    )
  }

  // チーズ横のレジューサー記号を、指定端(=チーズ側)のすぐ内側に描く。
  // 大径側(底辺)をチーズ側に、小径側(頂点)を配管本体側に向ける。チーズから少し離して
  // 描くので、将来チーズとレジューサーの間にパイプが入っても位置関係が分かる。
  function reducerAtEnd(s: Segment, at: 'start' | 'end') {
    const pt = at === 'start' ? s.start : s.end
    const other = at === 'start' ? s.end : s.start
    const len = distance(pt, other) || 1
    const dx = (other.x - pt.x) / len // 端点→本体（内側）方向
    const dy = (other.y - pt.y) / len
    const nx = -dy
    const ny = dx
    const L = 12 // 大径→小径の長さ
    const W = 9 // 底辺の半幅
    const gap = 12 // チーズ節点から少し離す
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

  // レジューサーのシンボル。
  // 同心=二等辺三角形（大径=底辺→小径=頂点）、偏心=直角三角形（斜辺の向きが Top/Bottom 連動）。
  // 常に「上流(大径)側=底辺・下流(小径)側=頂点」。ルート向きが変わっても維持。
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
    // u = 大径→小径 の向き
    const ux = largeAtStart ? dx : -dx
    const uy = largeAtStart ? dy : -dy
    const nx = -uy
    const ny = ux
    const L = 13 // 大径〜小径方向の半長
    const W = 9 // 底辺の半幅
    const largeCx = mx - ux * L
    const largeCy = my - uy * L
    const c1 = { x: largeCx + nx * W, y: largeCy + ny * W }
    const c2 = { x: largeCx - nx * W, y: largeCy - ny * W }
    let apex = { x: mx + ux * L, y: my + uy * L } // 小径側の中心（同心の頂点）
    if (kind === 'eccentric' && align) {
      // 画面上下で「面が揃う側」を決め、その角から頂点を配管方向へ伸ばす（斜辺=反対側）
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
            {/* レジューサーのシンボル（同心=二等辺 / 偏心=直角三角形） */}
            {eff?.fitting === 'reducer_concentric' &&
              reducerSymbol(s, 'concentric', undefined, cutById[s.id]?.reducerLargeAtStart ?? true)}
            {eff?.fitting === 'reducer_eccentric' &&
              reducerSymbol(
                s,
                'eccentric',
                cutById[s.id]?.eccentric?.align,
                cutById[s.id]?.reducerLargeAtStart ?? true,
              )}
            {/* チーズ横のレジューサー記号（径違い＝ツキ合わせ0mmでチーズ直結） */}
            {cutById[s.id]?.startRole === 'tee-run-reducer' &&
              reducerAtEnd(s, 'start')}
            {cutById[s.id]?.endRole === 'tee-run-reducer' &&
              reducerAtEnd(s, 'end')}
            {/* 中間の径変化のみ、線上に1箇所表示（両端フリーでない内部区間だけ。
                フリー端がある区間は末端ラベルで表示するので重複させない）。 */}
            {eff?.showSizeLabel &&
              eff.size &&
              cutById[s.id]?.startConnected &&
              cutById[s.id]?.endConnected && (
                <text
                  className="seg-label"
                  x={(s.start.x + s.end.x) / 2}
                  y={(s.start.y + s.end.y) / 2 - 10}
                  textAnchor="middle"
                >
                  {eff.size}
                </text>
              )}
            {/* 末端（フリー端）に呼び径を表示（手書きアイソメと同様・タップで変更） */}
            {eff?.size &&
              cutById[s.id] &&
              !cutById[s.id].startConnected &&
              terminusSize(s, 'start', eff.size)}
            {eff?.size &&
              cutById[s.id] &&
              !cutById[s.id].endConnected &&
              terminusSize(s, 'end', eff.size)}
            {/* 寸法2段表記: 上段=芯々(入力), 下段=切り寸(緑・下線)。芯々/芯先も表示 */}
            {(() => {
              const c = cutById[s.id]
              if (!c || c.status === 'none') return null
              const mx = (s.start.x + s.end.x) / 2
              const my = (s.start.y + s.end.y) / 2
              return (
                <>
                  <text className="dim-center" x={mx} y={my + 14} textAnchor="middle">
                    {c.mode} {c.center}
                  </text>
                  {c.status === 'ok' && (
                    <text className="dim-cut" x={mx} y={my + 30} textAnchor="middle">
                      切 {c.cut}
                    </text>
                  )}
                  {c.status === 'zero' && (
                    <text className="dim-cut zero" x={mx} y={my + 30} textAnchor="middle">
                      パイプ0（継手直結）
                    </text>
                  )}
                  {c.status === 'over' && (
                    <text className="dim-cut over" x={mx} y={my + 30} textAnchor="middle">
                      継手不足
                    </text>
                  )}
                </>
              )
            })()}
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
