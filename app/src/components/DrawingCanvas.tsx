import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point, Segment } from '../types'
import {
  distance,
  distanceToSegment,
  isometricGrid,
  latticeStep,
  projectOnSegment,
  samePoint,
  snapEndFromStart,
  snapToEndpoints,
  snapToLattice,
} from '../lib/isometric'
import { breakLine } from '../lib/crossover'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import { effectiveSlopeDenom } from '../lib/slope'
import {
  estimateTextWidth,
  resolveOverlaps,
  type LabelBox,
  type LabelJob,
} from '../lib/labelLayout'

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
  /** 表示の拡大縮小・平行移動（ピンチズーム）。パーツパレットのドロップ位置
      判定(App側)でも同じ変換が要るため、状態を親へ持ち上げて共有する。 */
  view: { scale: number; tx: number; ty: number }
  onViewChange: (view: { scale: number; tx: number; ty: number }) => void
  /** 配管設定(ベース)の勾配(1/N のN)。区間自身に個別上書きが無いときに使う。 */
  baseSlopeDenom?: number
}

// 「指が動いたかどうか」のごく小さいデッドゾーン(px、画面座標＝ズーム非依存)。
// snapEndFromStartは指が全く動いていなくても最低1格子分の終点を返してしまう
// （実際に描画を確定させる呼び出し用の仕様のため）ので、それより手前で、
// 本当に指がほぼ動いていない(=タップ)ケースをここで弾く。格子スナップ判定
// 自体はズーム非依存なので、このデッドゾーンも通常のタップのぶれを吸収できる
// 程度の小さい値で十分（短いキック区間の描画を妨げない）。
const TAP_DEADZONE_PX = 4
// タップ位置からセグメントを拾うヒット距離(px)
const HIT_DIST = 18
// アイソメグリッドの間隔(px)＝格子スナップの基準。
// 画面幅が狭いほど間隔を詰め、スマホでも1画面に描ける範囲を広くする。
const GRID_GAP_PHONE = 20 // 〜599px（スマホ）
const GRID_GAP_TABLET = 30 // 600〜999px（iPad縦向き等）
const GRID_GAP_WIDE = 40 // 1000px〜（iPad横向き・デスクトップ）
function gridGapForWidth(w: number): number {
  if (w > 0 && w < 600) return GRID_GAP_PHONE
  if (w > 0 && w < 1000) return GRID_GAP_TABLET
  return GRID_GAP_WIDE
}
// またぎ表示の途切れ幅(px)
const CROSS_GAP = 9
// 描画開始点を既存線上の格子点へ吸着する距離(px)。分岐の接続を確実にする。
const START_SNAP = 18
// ピンチズームの拡大率の範囲
const MIN_SCALE = 0.5
const MAX_SCALE = 3

// アイソメ図上に実際に表示される「45°」マークの位置を全て求める
// （DrawingCanvasの描画条件と同じ: 継手が elbow45_long のセグメント自身の
// エルボ端）。この位置は、そのマークを描いているセグメント自身だけでなく、
// ノードを共有する隣接セグメント（キック区間など）の寸法ラベルからも
// 見えるため、寸法ラベル側は「自分がその継手を持っているか」ではなく
// 「近くにマークが実在するか」で反対側へ避ける必要がある。
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
  view,
  onViewChange,
  baseSlopeDenom,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 画面幅に応じた格子間隔（スマホは詰め、iPad/デスクトップは従来どおり）
  const GRID_GAP = useMemo(() => gridGapForWidth(size.w), [size.w])

  // ジェスチャ状態
  const startLocalRef = useRef<Point | null>(null)
  // ドラッグ/タップの判定は「指の移動距離(px)」ではなく「離した位置が、押した
  // 位置と同じ格子点に吸着するか、別の格子点に吸着するか」で行う。ピクセル距離
  // 判定だと、ズームインしているときほど同じ指の移動量が小さい論理距離になり、
  // 短い区間（キック区間等）を描こうとしただけで「動いていない」＝タップ扱いに
  // なって既存線の選択（寸法入力パネルが開く）に化けてしまっていたため。
  // snapStartで一度確定させた開始点の格子スナップ結果をここに保持する。
  const snappedStartRef = useRef<Point | null>(null)
  // TAP_DEADZONE_PX判定用（画面座標、ズーム非依存）。
  const startScreenRef = useRef<Point | null>(null)
  const movedRef = useRef(false)
  // 同時に触れている指（screen-local座標）。2本以上でピンチ/パンに切り替える。
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<{
    id1: number
    id2: number
    startDist: number
    startMidScreen: Point
    startScale: number
    startTx: number
    startTy: number
  } | null>(null)
  // このタッチシーケンス中に2本指ジェスチャが発生したか（描画/選択を抑止するため）
  const gestureActiveRef = useRef(false)

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

  // 現在表示中の論理領域(パン・ズーム後)を覆うグリッドを再生成する
  const gridLines = useMemo(() => {
    const ox = -view.tx / view.scale
    const oy = -view.ty / view.scale
    const w = size.w / view.scale
    const h = size.h / view.scale
    return isometricGrid(w, h, GRID_GAP, ox, oy)
  }, [size.w, size.h, GRID_GAP, view])

  // 画面座標(client) -> キャンバス要素基準のローカル座標(拡大縮小・移動前)
  function toScreenLocal(clientX: number, clientY: number): Point {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  // 画面座標(client) -> 論理座標(セグメント等が持つ座標系。パン・ズームの逆変換を適用)
  function toLocal(clientX: number, clientY: number): Point {
    const s = toScreenLocal(clientX, clientY)
    return { x: (s.x - view.tx) / view.scale, y: (s.y - view.ty) / view.scale }
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

  // 描画開始点のスナップ。既存の端点(セグメントの始点・終点)が近ければ最優先で
  // そこへ厳密に吸着する（見た目はつながっているのに実は接続していない、と
  // いう事故を防ぐため）。しきい値は画面上の見た目の距離を一定に保つよう
  // ズーム倍率で補正する。端点が無ければ、既存線の近くならその線上の格子点へ
  // 吸着して分岐（チーズ）が確実に接続するようにする。それ以外は通常の格子スナップ。
  function snapStart(raw: Point): Point {
    const endpoints: Point[] = []
    for (const s of segments) {
      endpoints.push(s.start, s.end)
    }
    const toEndpoint = snapToEndpoints(raw, endpoints, START_SNAP / view.scale)
    if (toEndpoint !== raw) return toEndpoint

    const global = snapToLattice(raw, GRID_GAP)
    // すでにいずれかの線上に乗っていればそのまま
    for (const s of segments) {
      if (distanceToSegment(global, s.start, s.end) < 1.5) return global
    }
    // 近くの線を探し、その線上の最寄り格子点へ
    let best: Segment | null = null
    let bestDist = START_SNAP / view.scale
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

  // 現在アクティブな2本指の組でピンチ/パンの基準(開始距離・中点・その時のview)を取り直す。
  // 3本指以上で1本増減した場合や、ピンチ開始時にも呼ぶ。
  function beginGesture() {
    const ids = [...pointersRef.current.keys()]
    const id1 = ids[0]
    const id2 = ids[1]
    const p1 = pointersRef.current.get(id1)
    const p2 = pointersRef.current.get(id2)
    if (!p1 || !p2) return
    gestureRef.current = {
      id1,
      id2,
      startDist: distance(p1, p2) || 1,
      startMidScreen: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      startScale: view.scale,
      startTx: view.tx,
      startTy: view.ty,
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (inputDisabled) return
    svgRef.current?.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, toScreenLocal(e.clientX, e.clientY))

    if (pointersRef.current.size >= 2) {
      // 2本指以上 = ピンチ/パン開始。進行中だった単指の描画開始はキャンセルする。
      gestureActiveRef.current = true
      startLocalRef.current = null
      snappedStartRef.current = null
      startScreenRef.current = null
      setPreview(null)
      beginGesture()
      return
    }
    startLocalRef.current = toLocal(e.clientX, e.clientY)
    snappedStartRef.current = snapStart(startLocalRef.current)
    startScreenRef.current = toScreenLocal(e.clientX, e.clientY)
    movedRef.current = false
    setPreview(null)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, toScreenLocal(e.clientX, e.clientY))
    }

    if (gestureActiveRef.current && gestureRef.current) {
      const g = gestureRef.current
      const p1 = pointersRef.current.get(g.id1)
      const p2 = pointersRef.current.get(g.id2)
      if (p1 && p2) {
        const dist = distance(p1, p2) || 1
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, g.startScale * (dist / g.startDist)),
        )
        // ピンチ開始時の中点にあった論理座標が、常に今の2本指の中点に来るよう
        // tx,ty を解く（つまんだ場所を中心にズーム＋2本指パンを同時に実現）。
        const logicalX = (g.startMidScreen.x - g.startTx) / g.startScale
        const logicalY = (g.startMidScreen.y - g.startTy) / g.startScale
        onViewChange({
          scale: newScale,
          tx: mid.x - logicalX * newScale,
          ty: mid.y - logicalY * newScale,
        })
      }
      return
    }

    const start = startLocalRef.current
    const s = snappedStartRef.current
    if (!start || !s) return
    const pScreen = toScreenLocal(e.clientX, e.clientY)
    if (startScreenRef.current && distance(startScreenRef.current, pScreen) < TAP_DEADZONE_PX) {
      // ほぼ動いていない(デッドゾーン内)。snapEndFromStartは動いていなくても
      // 最低1格子分の終点を返してしまうため、ここで先に弾いてタップ扱いにする。
      movedRef.current = false
      setPreview(null)
      return
    }
    const p = toLocal(e.clientX, e.clientY)
    const { end } = snapEndFromStart(s, p, GRID_GAP)
    movedRef.current = !samePoint(s, end)
    if (movedRef.current) {
      // グリッド交点間・アイソメ角に拘束したプレビュー
      setPreview({ start: s, end })
    } else {
      setPreview(null)
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId)

    if (gestureActiveRef.current) {
      if (pointersRef.current.size >= 2) {
        // 3本指以上から1本離した等 → 残っているペアで基準を引き直して続行
        beginGesture()
      } else if (pointersRef.current.size === 0) {
        // 全ての指を離した → ジェスチャ終了（このシーケンスでは描画/選択は発生させない）
        gestureActiveRef.current = false
        gestureRef.current = null
      }
      startLocalRef.current = null
      snappedStartRef.current = null
      startScreenRef.current = null
      setPreview(null)
      return
    }

    const start = startLocalRef.current
    const s = snappedStartRef.current
    const startScreen = startScreenRef.current
    startLocalRef.current = null
    snappedStartRef.current = null
    startScreenRef.current = null

    if (start && s) {
      const pScreen = toScreenLocal(e.clientX, e.clientY)
      const inDeadzone = startScreen != null && distance(startScreen, pScreen) < TAP_DEADZONE_PX
      // デッドゾーン内(ほぼ動いていない)ならタップ。それ以外は、離した位置が
      // 開始点と同じ格子点に吸着するか(タップ)、別の格子点に吸着するか
      // (ドラッグ=描画)で判定する（pointerup時点の位置で確定判定）。
      const p = toLocal(e.clientX, e.clientY)
      const { end, angle } = snapEndFromStart(s, p, GRID_GAP)
      if (!inDeadzone && !samePoint(s, end)) {
        // ドラッグ = 描画
        onAddSegment({ start: s, end, angle })
      } else {
        // タップ（動かさず離す）= 線上なら選択、そうでなければ選択解除
        const seg = hitSegment(start)
        if (seg) onSelectSegment(seg.id)
        else onBackgroundTap()
      }
    }
    setPreview(null)
  }

  // 末端の呼び径ラベル・寸法2段表記(dim block)の基準位置(重なり回避の押し出し前)を
  // 全セグメント分まとめて求め、重なりを解消した最終位置を得る。
  // ズーム・パン(view)には依存しない（すべて論理座標＝segment座標系で計算するため）。
  const resolvedLabels = useMemo(() => {
    const jobs: LabelJob[] = []
    // 実際に描かれる45°マークの位置を先に全部集めておく（寸法ラベルの
    // 押し出し方向の判定に使う。マークを持つセグメント自身だけでなく、
    // ノードを共有する隣接セグメント側からも近さで判定するため）。
    const elbow45Marks = allElbow45MarkPositions(segments, effectiveById, cutById)
    // 1) 中間の径変化ラベル（セグメント中点の上側）
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
    // 2) 寸法2段表記（もっとも重要な情報のため優先度を高くする）
    for (const s of segments) {
      const c = cutById[s.id]
      if (!c || c.status === 'none') continue
      // 既定の基準位置は中点だが、片端がフリー端（開放された空間側）のときは
      // そちら寄りに置く。中点は他区間との結合部や交差点に近くなりがちで、
      // 読み取りにくい位置に固定されてしまうことがあったため、より開けている
      // フリー端側へ寄せておくことで見やすい場所に出やすくする。
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
            ? c.reducerH != null
              ? `レジューサー H=${c.reducerH}（継手直結）`
              : 'パイプ0（継手直結）'
            : '継手不足'
      const fs2 = c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe ? 12.5 : 11
      const w =
        Math.max(estimateTextWidth(line1, 10.5), estimateTextWidth(line2, fs2)) + 6
      // 押し出す向きはセグメントに対して垂直な向きに固定する（セグメントの向き
      // なりに押すと、切り立った斜め/縦の配管では押し出しがほぼ線に沿った方向に
      // なってしまい、ラベルが自分の区間を越えて隣の区間の場所までズレて、
      // どちらの配管の寸法か分からなくなる事故があったため）。
      const len = distance(s.start, s.end) || 1
      const dx = (s.end.x - s.start.x) / len
      const dy = (s.end.y - s.start.y) / len
      let perpX = -dy
      let perpY = dx
      // 45°マークがこの区間にあるときは、マークと反対側に寄せる（「次の配管が
      // 曲がった先の進行方向の逆」に出すと重ならず収まりやすいという現場の
      // 感覚に合わせたもの）。マークが無ければ従来どおり画面下側を既定にする。
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
    // 3) 排水勾配の「勾配1/N」マーク（区間中点のやや下）。個別上書きが無い
    //    区間は配管設定(ベース)の値を継承して表示する。他のラベルや
    //    互いどうしとも重ならないよう、同じジョブ列に混ぜて解決する。
    for (const s of segments) {
      const denom = effectiveSlopeDenom(s, baseSlopeDenom)
      if (denom == null) continue
      const mx = (s.start.x + s.end.x) / 2
      const my = (s.start.y + s.end.y) / 2
      const w = estimateTextWidth(`勾配1/${denom}`, 11) + 6
      jobs.push({ key: `slope-${s.id}`, cx: mx, cy: my + 16, w, h: 18, pushX: 0, pushY: 1 })
    }
    // 4) 末端の呼び径ラベル（寸法表記を避ける向きへ、必要ならさらに押し出す）
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
        // 端点(=新しい線を引き始めるタップ位置)にラベルの当たり判定が近すぎると、
        // 続けて線を引こうとしたタップがラベル選択として拾われてしまう。
        // 元の位置から格子1マス分さらに離して、近すぎず遠すぎない位置にする。
        const along = 20 + latticeStep(s.angle, GRID_GAP)
        const perp = 14
        const cx = pt.x + ox * along + nx * perp
        const cy = pt.y + oy * along + ny * perp
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
  }, [segments, cutById, effectiveById, crossoverGaps, GRID_GAP, baseSlopeDenom])

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
    const ox = (pt.x - other.x) / len
    const oy = (pt.y - other.y) / len
    let nx = -oy
    let ny = ox
    if (ny > 0) {
      nx = -nx
      ny = -ny
    }
    // 端点(=新しい線を引き始めるタップ位置)にラベルの当たり判定が近すぎると、
    // 続けて線を引こうとしたタップがラベル選択として拾われてしまう。
    // 元の位置から格子1マス分さらに離して、近すぎず遠すぎない位置にする。
    const along = 20 + latticeStep(s.angle, GRID_GAP)
    const perp = 14
    // 重なり回避で押し出された最終位置（無ければ基準位置にフォールバック）
    const resolved = resolvedLabels.get(`term-${s.id}-${at}`)
    const cx = resolved?.cx ?? pt.x + ox * along + nx * perp
    const cy = resolved?.cy ?? pt.y + oy * along + ny * perp
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

  // 排水勾配(1/N)を設定した区間に「1/100」等のマークを表示する
  // （区間の中点、線の少し下側が基準位置。重なり回避で押し出された
  // 最終位置があればそちらを使う）。
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
      {/* ピンチズーム・パン用の変換。中身は全て論理座標(=セグメント座標系)のまま描き、
          この<g>だけを拡大縮小・移動する。 */}
      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
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
        // 色: 選択=橙 / 属性確定=水色 / 未確定=グレー（ライト/ダークテーマで色を出し分け）
        const stroke = selected
          ? 'var(--seg-selected)'
          : resolved
            ? 'var(--seg-resolved)'
            : 'var(--seg-unresolved)'
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
            <circle cx={s.start.x} cy={s.start.y} r={4} fill="var(--seg-dot)" />
            <circle cx={s.end.x} cy={s.end.y} r={4} fill="var(--seg-dot)" />
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
            {/* チーズ／エルボ横のレジューサー記号（径違い＝ツキ合わせ0mmで継手に直結） */}
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
              eff?.fitting === 'elbow45_long' &&
              elbow45Mark(s, 'start')}
            {(cutById[s.id]?.endRole === 'elbow' ||
              cutById[s.id]?.endRole === 'elbow-reducer') &&
              eff?.fitting === 'elbow45_long' &&
              elbow45Mark(s, 'end')}
            {/* 排水勾配を設定した区間には「勾配1/N」を線の中点に表示する
                （個別上書きが無ければ配管設定のベース値を継承して表示） */}
            {effectiveSlopeDenom(s, baseSlopeDenom) != null &&
              slopeMark(s, effectiveSlopeDenom(s, baseSlopeDenom)!)}
            {/* 中間の径変化のみ、線上に1箇所表示（両端フリーでない内部区間だけ。
                フリー端がある区間は末端ラベルで表示するので重複させない）。 */}
            {eff?.showSizeLabel &&
              eff.size &&
              cutById[s.id]?.startConnected &&
              cutById[s.id]?.endConnected &&
              (() => {
                const resolved = resolvedLabels.get(`seg-${s.id}`)
                const cx = resolved?.cx ?? (s.start.x + s.end.x) / 2
                const cy = resolved?.cy ?? (s.start.y + s.end.y) / 2 - 10
                return (
                  <text className="seg-label" x={cx} y={cy} textAnchor="middle">
                    {eff.size}
                  </text>
                )
              })()}
            {/* 末端（フリー端）に呼び径を表示（手書きアイソメと同様・タップで変更） */}
            {eff?.size &&
              cutById[s.id] &&
              !cutById[s.id].startConnected &&
              terminusSize(s, 'start', eff.size)}
            {eff?.size &&
              cutById[s.id] &&
              !cutById[s.id].endConnected &&
              terminusSize(s, 'end', eff.size)}
            {/* 寸法2段表記: 上段=芯々(入力), 下段=切り寸(緑・下線)。芯々/芯先も表示
                位置は重なり回避で押し出された最終位置（無ければ基準位置）を使う。 */}
            {(() => {
              const c = cutById[s.id]
              if (!c || c.status === 'none') return null
              let t = 0.5
              if (!c.startConnected && c.endConnected) t = 0.3
              else if (c.startConnected && !c.endConnected) t = 0.7
              const mx = s.start.x + (s.end.x - s.start.x) * t
              const my = s.start.y + (s.end.y - s.start.y) * t
              const resolved = resolvedLabels.get(`dim-${s.id}`)
              const cx = resolved?.cx ?? mx
              const cCenter = resolved?.cy ?? my + 22
              const y1 = cCenter - 8
              const y2 = cCenter + 8
              return (
                <>
                  <text className="dim-center" x={cx} y={y1} textAnchor="middle">
                    {c.mode} {c.center}
                  </text>
                  {c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe && (
                    <>
                      {/* 縁取り(読みやすさ用)は下線を含めない別レイヤーで描く。
                          同じテキストに縁取り(stroke)と下線(text-decoration)を
                          両方かけると、下線にも縁取りが付いて二重線に見えるため分離。 */}
                      <text
                        className="dim-cut-outline"
                        x={cx}
                        y={y2}
                        textAnchor="middle"
                        aria-hidden="true"
                      >
                        切 {c.cut}
                      </text>
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
                    </>
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
                      {c.reducerH != null
                        ? `レジューサー H=${c.reducerH}（継手直結）`
                        : 'パイプ0（継手直結）'}
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

      {/* 描画中のプレビュー */}
      {preview && (
        <line
          x1={preview.start.x}
          y1={preview.start.y}
          x2={preview.end.x}
          y2={preview.end.y}
          stroke="var(--seg-preview)"
          strokeWidth={3}
          strokeDasharray="8 6"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
      </g>
    </svg>
  )
}
