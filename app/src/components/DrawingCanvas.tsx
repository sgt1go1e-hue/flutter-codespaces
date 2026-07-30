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
import { chooseDimSide, dimExtensionLine, dimGeometry, DIM_STANDOFF } from '../lib/dimensionLine'
import {
  fieldFitDoubleLines,
  fieldFitEndMarkGeometry,
  fieldWeldMarkGeometry,
} from '../lib/fieldMarks'
import { lineColorHex } from '../data/lineColors'
import { genGouLabelText } from '../lib/genGou'
import { PanJoystick } from './PanJoystick'

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
  /**
   * パーツパレットで部材(フランジ・レジューサー等)を選択中(タップ配置待ち)か。
   * 有効な間は、新しい線の描画(ドラッグ)を無効化し、タップは通常の選択では
   * なくパーツ配置(onPlacePartTap)に振り替える。inputDisabledと異なり、
   * ポインタ操作自体は通常通り受け付ける(タップ判定を使うため)。
   */
  partPlaceMode?: boolean
  /** partPlaceMode中、線の上をタップしたときに呼ぶ（論理座標のタップ位置） */
  onPlacePartTap?: (point: Point) => void
  /** partPlaceMode中、何もない場所をタップしたとき（配置をキャンセルする用） */
  onCancelPartPlace?: () => void
  /** 表示の拡大縮小・平行移動（ピンチズーム）。パーツパレットのドロップ位置
      判定(App側)でも同じ変換が要るため、状態を親へ持ち上げて共有する。 */
  view: { scale: number; tx: number; ty: number }
  onViewChange: (view: { scale: number; tx: number; ty: number }) => void
  /** 配管設定(ベース)の勾配(1/N のN)。区間自身に個別上書きが無いときに使う。 */
  baseSlopeDenom?: number
  /**
   * 消しゴムモード。オンの間は新しい線の描画(ドラッグ)を無効化し、線を
   * タップすると詳細パネルを経由せずその場で onEraseSegment を呼ぶ。
   */
  eraserMode?: boolean
  onEraseSegment?: (id: string) => void
  /**
   * 図面共有機能で「閲覧のみ／注記のみ／寸法のみ編集可」で開いているとき、
   * 新しい線の作図(ドラッグ)だけを無効化する。inputDisabledと違い、タップに
   * よる選択やピンチズーム・パンはそのまま使える（読む・確認する用途のため）。
   */
  disableDraw?: boolean
  /**
   * 相番(合番)表示が有効か（セグメント数による自動判定 or 手動ON/OFF）。
   * 有効な区間は、芯々/切り寸法の2段表記の代わりに番号だけを表示する
   * （既存の芯々/切り寸法の計算結果自体は変えない。表示の切り替えのみ）。
   */
  assemblyNumberActive?: boolean
  /** 区間ごとの実効相番。芯々未入力の区間には含まれない。 */
  assemblyNumberById?: Record<string, number>
  /** 現場溶接マークの三角をタップしたとき、その向きを反転する（表示専用トグル）。 */
  onToggleFieldWeldFlip?: (segId: string) => void
  /**
   * 現場溶接マークの三角をドラッグして移動したとき、対象点からの相対
   * オフセット(表示スケール=1のときのpx相当)を確定する（表示専用）。
   */
  onMoveFieldWeldMark?: (segId: string, offsetX: number, offsetY: number) => void
  /** 現場合わせ区間の端点三角をタップしたとき、その向きを反転する（表示専用トグル）。 */
  onToggleFieldFitFlip?: (segId: string, at: 'start' | 'end') => void
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
// 相番(合番)バッジの円の半径(px)。老眼等でも読み取れるよう、通常の寸法
// ラベルよりかなり大きめにする（重なり回避のジョブサイズもこれに合わせる）。
const ASSEMBLY_BADGE_R = 17
// 画面幅に応じた表示スケール係数。iPhone相当の画面幅を基準(=1.0)とし、
// 画面が広くなるほどグリッドのマス目・線の太さ・寸法ラベルの文字・
// ノード(点)の大きさを比例して拡大する。iPadのような大きい画面で、
// これらの要素が画面サイズに対して相対的に小さく(グリッドが必要以上に
// 細かく)見えてしまう不具合の対策。iPhone幅では従来と完全に同じ見た目
// になる(scale=1.0)よう、基準幅以下では拡大しない。上限を設けているのは、
// デスクトップ等の非常に広い画面でグリッドが粗くなりすぎるのを防ぐため。
// 芯々寸法等の計算ロジックには一切関与しない、表示専用の係数。
const UI_SCALE_BASE_WIDTH = 430 // 〜iPhone Pro Max相当の幅までは scale=1.0
const UI_SCALE_MAX = 2 // 上限(iPhone比 最大2倍)
function uiScaleForWidth(w: number): number {
  if (w <= 0) return 1
  const scale = 1 + Math.max(0, w - UI_SCALE_BASE_WIDTH) / 800
  return Math.min(UI_SCALE_MAX, scale)
}
// アイソメグリッドの間隔(px)＝格子スナップの基準。uiScaleに比例するため、
// 画面が広いほど間隔も広がる(スマホでは従来通り20px)。
const GRID_GAP_BASE = 20
function gridGapForWidth(w: number): number {
  return GRID_GAP_BASE * uiScaleForWidth(w)
}
// またぎ表示の途切れ幅(px)
const CROSS_GAP = 9
// 描画開始点を既存線上の格子点へ吸着する距離(px)。分岐の接続を確実にする。
const START_SNAP = 18
// ズームの拡大率の範囲（ピンチ操作・後述のズームボタン共通）。
// 密集した図面を全体表示したい場面向けに、最小値(最大縮小率)を
// 従来(0.5)よりさらに縮小できるよう拡張している。
const MIN_SCALE = 0.25
const MAX_SCALE = 3
// ズームボタン1回あたりの変化幅（ピンチより小刻みに調整したい場面向け）。
const ZOOM_BUTTON_STEP = 0.05

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
  partPlaceMode,
  onPlacePartTap,
  onCancelPartPlace,
  view,
  onViewChange,
  baseSlopeDenom,
  eraserMode = false,
  onEraseSegment,
  disableDraw = false,
  assemblyNumberActive = false,
  assemblyNumberById = {},
  onToggleFieldWeldFlip,
  onToggleFieldFitFlip,
  onMoveFieldWeldMark,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [preview, setPreview] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 画面幅に応じた表示スケール係数・格子間隔（iPhone幅では1.0=従来どおり、
  // iPad等の広い画面では線・文字・ノードも比例して大きく表示する）。
  const uiScale = useMemo(() => uiScaleForWidth(size.w), [size.w])
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
  // タッチ開始位置が呼び径ラベルの当たり判定(terminusSize)に乗っていた場合の
  // セグメントid。ラベルは線の実ジオメトリから離れた位置に大きめの当たり判定を
  // 持つため、ここで押した情報を覚えておき、実際に指がほぼ動かず離された
  // （＝タップ）と判定できたときだけ選択に使う。ラベルの押下だけで即座に
  // 選択してしまうと、そこを起点にドラッグして新しい線を描こうとした操作まで
  // タップ扱いになり、詳細パネルが誤って開いてしまう（密集した図面で頻発）。
  const labelPointerDownSegIdRef = useRef<string | null>(null)

  // 現場溶接マーク(三角)のドラッグ移動用。タップ(=向き反転)とドラッグ(=移動)を
  // 「離すまでの移動量」で判定する(TAP_DEADZONE_PXと同じ考え方)。移動中は
  // fieldWeldDrag(state)でその場でプレビューを更新し、離した時点で確定して
  // 親(App)へ相対オフセットを渡す。ジェスチャの起点情報自体はrefで持ち、
  // 毎フレームの再レンダーには影響させない。
  const fieldWeldDragRef = useRef<{
    pointerId: number
    segId: string
    startClientX: number
    startClientY: number
    startOffsetX: number
    startOffsetY: number
    moved: boolean
  } | null>(null)
  const [fieldWeldDrag, setFieldWeldDrag] = useState<{
    segId: string
    offsetX: number
    offsetY: number
  } | null>(null)

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
      labelPointerDownSegIdRef.current = null
      setPreview(null)
      beginGesture()
      return
    }
    // ラベルの onPointerDown は先(バブリング順で子→親)に発火しているはずなので、
    // ここではリセットしない（このイベントで押されたラベルの情報を保持する）。
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
    if (eraserMode || disableDraw || partPlaceMode) {
      // 消しゴムモード中、共有権限で作図が無効化されているとき、またはパーツ
      // 配置待ち(パレットで選択中)のときは、新しい線のプレビュー(＝描画)を
      // 出さない。タップ判定自体(タップ/ドラッグの区別)は handlePointerUp 側で
      // そのまま使い、ドラッグと判定された場合は「何もしない」に倒す
      // （誤って線を描かない・誤ってパーツを配置しない）。
      return
    }
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
      labelPointerDownSegIdRef.current = null
      setPreview(null)
      return
    }

    const start = startLocalRef.current
    const s = snappedStartRef.current
    const startScreen = startScreenRef.current
    const labelSegId = labelPointerDownSegIdRef.current
    startLocalRef.current = null
    snappedStartRef.current = null
    startScreenRef.current = null
    labelPointerDownSegIdRef.current = null

    if (start && s) {
      const pScreen = toScreenLocal(e.clientX, e.clientY)
      const inDeadzone = startScreen != null && distance(startScreen, pScreen) < TAP_DEADZONE_PX
      // デッドゾーン内(ほぼ動いていない)ならタップ。それ以外は、離した位置が
      // 開始点と同じ格子点に吸着するか(タップ)、別の格子点に吸着するか
      // (ドラッグ=描画)で判定する（pointerup時点の位置で確定判定）。
      const p = toLocal(e.clientX, e.clientY)
      const { end, angle } = snapEndFromStart(s, p, GRID_GAP)
      const isTap = inDeadzone || samePoint(s, end)
      if (partPlaceMode) {
        // パーツ配置待ち中は、ドラッグしても新しい線は描かない。タップだった
        // 場合だけ、線上ならそこへ配置(onPlacePartTap)、何もない場所なら
        // 配置をキャンセルする(onCancelPartPlace)。ラベル(呼び径表示)の上を
        // タップした場合も、その下にある線として扱う。
        if (isTap) {
          const seg = labelSegId
            ? segments.find((sg) => sg.id === labelSegId)
            : hitSegment(start)
          if (seg) onPlacePartTap?.(start)
          else onCancelPartPlace?.()
        }
      } else if (eraserMode) {
        // 消しゴムモード中は新しい線を描かない。タップだった場合のみ、その場の
        // 線を確認なしで即削除する（ドラッグはタップ/ドラッグ判定はそのまま
        // 使うが、結果を「何もしない」に倒す誤操作防止）。
        if (isTap) {
          const seg = labelSegId
            ? segments.find((sg) => sg.id === labelSegId)
            : hitSegment(start)
          if (seg) onEraseSegment?.(seg.id)
        }
      } else if (!isTap) {
        // ドラッグ = 描画（呼び径ラベルの上から描き始めていても、動かした以上は
        // 常に新しい線の描画として扱う。タップは発生させない）。共有権限で
        // 作図が無効化されているときは何もしない（プレビューも出していないため
        // 実害はないが、念のためここでも確実に弾く）。
        if (!disableDraw) onAddSegment({ start: s, end, angle })
      } else {
        // タップ（動かさず離す）= 呼び径ラベルの上で押していればそれを優先、
        // なければ通常どおり線上の当たり判定で選択。どちらもなければ選択解除。
        const seg = labelSegId
          ? segments.find((sg) => sg.id === labelSegId)
          : hitSegment(start)
        if (seg) onSelectSegment(seg.id)
        else onBackgroundTap()
      }
    }
    setPreview(null)
  }

  // 実際に描かれる45°マークの位置（寸法線を出す側の判定に使う。マークを
  // 持つセグメント自身だけでなく、ノードを共有する隣接セグメント側からも
  // 近さで判定するため、レンダー側(寸法線の実描画)でも同じ値を参照する）。
  const elbow45Marks = useMemo(
    () => allElbow45MarkPositions(segments, effectiveById, cutById),
    [segments, effectiveById, cutById],
  )

  // 末端の呼び径ラベル・寸法(外側/内側レーン)の基準位置(重なり回避の押し出し前)を
  // 全セグメント分まとめて求め、重なりを解消した最終位置を得る。
  // ズーム・パン(view)には依存しない（すべて論理座標＝segment座標系で計算するため）。
  const resolvedLabels = useMemo(() => {
    const jobs: LabelJob[] = []
    // 1) 中間の径変化ラベル（セグメント中点の上側）
    for (const s of segments) {
      const eff = effectiveById[s.id]
      const c = cutById[s.id]
      if (!eff?.showSizeLabel || !eff.size || !c?.startConnected || !c?.endConnected)
        continue
      const mx = (s.start.x + s.end.x) / 2
      const my = (s.start.y + s.end.y) / 2
      const w = estimateTextWidth(eff.size, 12 * uiScale) + 8 * uiScale
      jobs.push({
        key: `seg-${s.id}`,
        cx: mx,
        cy: my - 10 * uiScale,
        w,
        h: 18 * uiScale,
        pushX: 0,
        pushY: -1,
      })
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
      // 相番(合番)表示が有効な区間は、寸法2段表記の代わりに番号だけの
      // 小さな丸バッジを出す（既存の芯々/切り寸法テキストの計算・幅取りは
      // 使わない）。相番の値自体は cutlength.ts の計算結果とは無関係の
      // 表示専用データ（App側でassemblyNumberByIdとして都度算出）。
      const assemblyNum = assemblyNumberActive ? assemblyNumberById[s.id] : undefined
      const isNumbered = assemblyNum != null
      // 寸法線を出す側(パイプに垂直な単位ベクトル)は、セグメントに対して固定
      // する（セグメントの向きなりに押すと、切り立った斜め/縦の配管では押し出しが
      // ほぼ線に沿った方向になってしまい、ラベルが自分の区間を越えて隣の区間の
      // 場所までズレて、どちらの配管の寸法か分からなくなる事故があったため）。
      // 45°マークがこの区間にあるときは、マークと反対側に寄せる（「次の配管が
      // 曲がった先の進行方向の逆」に出すと重ならず収まりやすいという現場の
      // 感覚に合わせたもの）。マークが無ければ従来どおり画面下側を既定にする。
      const markPos = nearestElbow45Mark(elbow45Marks, mx, my)
      const side = chooseDimSide(s.start, s.end, markPos ?? undefined)
      if (isNumbered) {
        // 相番(合番)表示が有効な区間は、寸法線ではなく番号だけの小さな丸バッジを
        // 出す（別表(BOM対応表)で芯々/切り寸法を確認する運用のため）。
        jobs.push({
          key: `dim-${s.id}`,
          cx: mx + side.nx * DIM_STANDOFF * uiScale,
          cy: my + side.ny * DIM_STANDOFF * uiScale,
          w: (ASSEMBLY_BADGE_R * 2 + 4) * uiScale,
          h: (ASSEMBLY_BADGE_R * 2 + 4) * uiScale,
          pushX: side.nx,
          pushY: side.ny,
        })
        continue
      }
      // ISOGEN流(海外の配管業界で広く使われる自動アイソメ生成ソフトのスタイル)を
      // 参考に、パイプ本体から離した1本の寸法線の上に、芯々/芯先(1行目)と
      // 切り寸法(2行目、参照寸法を示す括弧書き)を2行で表示する。当初は外側/
      // 内側の2レーンに分けて別々の寸法線で表示していたが、2本の線・矢印が
      // 近接して重なって見づらいというフィードバックを受け、線は1本にまとめた。
      // ここではその2行の文字位置を重なり回避の対象ジョブとして登録するだけで、
      // 実際の寸法線・矢羽根・補助線の描画はレンダー側(下のsegments.map)で
      // segment自身の座標から都度計算する(このジョブの位置はテキストの
      // 「基準位置／押し出し先」としてのみ使う)。
      const line1 = `${c.mode} ${c.center}`
      const line2 =
        c.status === 'ok'
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
      const fs1 = 10.5 * uiScale
      const fs2 =
        (c.status === 'ok' && !c.threadTooShortForPipe && !c.vpTsTooShortForPipe ? 12.5 : 11) *
        uiScale
      const geom = dimGeometry(s.start, s.end, side, uiScale)
      const w1 = estimateTextWidth(line1, fs1) + 6 * uiScale
      const w2 = estimateTextWidth(line2, fs2) + 6 * uiScale
      const lineBoxH = 16 * uiScale
      // 文字が縦向き(±90度寄り)に回転しているときは、当たり判定の箱もw/hを
      // 入れ替える(縦長の箱として扱う)。斜め(±30度)はおおむね元の箱のままで
      // 妥当な近似として扱う。1本の線に2行を積んでいるため、行の回転角は共通。
      const rotated = Math.abs(geom.textRotateDeg) > 45
      jobs.push({
        key: `dim-line1-${s.id}`,
        cx: geom.text1X,
        cy: geom.text1Y,
        w: rotated ? lineBoxH : w1,
        h: rotated ? w1 : lineBoxH,
        pushX: side.nx,
        pushY: side.ny,
      })
      jobs.push({
        key: `dim-line2-${s.id}`,
        cx: geom.text2X,
        cy: geom.text2Y,
        w: rotated ? lineBoxH : w2,
        h: rotated ? w2 : lineBoxH,
        pushX: side.nx,
        pushY: side.ny,
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
      const w = estimateTextWidth(`勾配1/${denom}`, 11 * uiScale) + 6 * uiScale
      jobs.push({
        key: `slope-${s.id}`,
        cx: mx,
        cy: my + 16 * uiScale,
        w,
        h: 18 * uiScale,
        pushX: 0,
        pushY: 1,
      })
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
        const along = 20 * uiScale + latticeStep(s.angle, GRID_GAP)
        const perp = 14 * uiScale
        const cx = pt.x + ox * along + nx * perp
        const cy = pt.y + oy * along + ny * perp
        const w = estimateTextWidth(eff.size, 13 * uiScale) + 14 * uiScale
        jobs.push({
          key: `term-${s.id}-${at}`,
          cx,
          cy,
          w,
          h: 26 * uiScale,
          pushX: nx,
          pushY: ny,
        })
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
          w: 40 * uiScale,
          h: 40 * uiScale,
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
        const gap = 20 * uiScale
        const off = 11 * uiScale
        elbow45Obstacles.push({
          cx: pt.x + dx * gap + nx * off,
          cy: pt.y + dy * gap + ny * off,
          w: 34 * uiScale,
          h: 22 * uiScale,
        })
      }
    }
    return resolveOverlaps(jobs, [...crossObstacles, ...elbow45Obstacles])
  }, [
    segments,
    cutById,
    effectiveById,
    crossoverGaps,
    GRID_GAP,
    uiScale,
    baseSlopeDenom,
    assemblyNumberActive,
    assemblyNumberById,
  ])

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
    // タップでその区間を選択（線が細くても押しやすいよう当たり判定を広めに）。
    // ここではまだ選択を確定しない（押した位置を覚えるだけ）。実際にタップ
    // だったか、ここを起点にドラッグして新しい線を描こうとしたのかは、通常の
    // キャンバス側のジェスチャ判定(handlePointerUp)に委ねる。stopPropagation
    // もしない（キャンバス側のジェスチャ検出を止めないため）。
    const onLabelPointerDown = () => {
      labelPointerDownSegIdRef.current = s.id
    }
    return (
      <g pointerEvents="auto" style={{ cursor: 'pointer' }} onPointerDown={onLabelPointerDown}>
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

  // 現場合わせ区間（現場で寸法を合わせるため、あえて長めに加工している区間）
  // の二重線。既存の線のすぐ両側に平行な線を1本ずつ添える（表示専用、
  // 計算結果には影響しない）。
  function fieldFitDoubleLine(s: Segment) {
    const { line1, line2 } = fieldFitDoubleLines(s.start, s.end, uiScale)
    return (
      <>
        <line x1={line1.x1} y1={line1.y1} x2={line1.x2} y2={line1.y2} className="field-fit-line" />
        <line x1={line2.x1} y1={line2.y1} x2={line2.x2} y2={line2.y2} className="field-fit-line" />
      </>
    )
  }

  // 現場合わせ区間の端点(始点/終点)の三角マーク。タップで向きを反転できる
  // （キャンバス側の直接タップ＝onToggleFieldFitFlip、詳細パネル側にも
  // 同じ操作のボタンを用意している）。stopPropagationで、キャンバス本体の
  // ドラッグ/タップ判定(線を引く・選択する等)に巻き込まれないようにする。
  function fieldFitEndMark(s: Segment, at: 'start' | 'end', flipped: boolean) {
    const points = fieldFitEndMarkGeometry(s, at, flipped, uiScale)
    return (
      <polygon
        className="field-fit-mark"
        points={points}
        // 塗りつぶしなし(輪郭のみ)のため、pointer-events="auto"のままだと
        // 線の内側(塗りが無い部分)がタップを拾えない。"all"にして、輪郭で
        // 囲まれた領域全体をタップ対象にする。
        pointerEvents="all"
        style={{ cursor: onToggleFieldFitFlip ? 'pointer' : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onToggleFieldFitFlip?.(s.id, at)}
      />
    )
  }

  // 現場溶接マーク（工場での加工分割点。「ここから先は現場で溶接して繋ぐ」の目印）。
  // 動かさずに離せばタップ＝向き反転、動かして離せばドラッグ＝移動確定。
  // 寸法線と同じ「避けたい点」(45°マーク)を渡し、既定配置が寸法線と同じ側に
  // 来てしまわないようにする（fieldFitEndMarkと同じ理由でstopPropagationする）。
  function fieldWeldMark(s: Segment) {
    const mark = s.fieldWeldMark
    if (!mark) return null
    const at = {
      x: s.start.x + (s.end.x - s.start.x) * mark.t,
      y: s.start.y + (s.end.y - s.start.y) * mark.t,
    }
    const avoidPoint = nearestElbow45Mark(elbow45Marks, at.x, at.y) ?? undefined
    const dragging = fieldWeldDrag && fieldWeldDrag.segId === s.id
    const customOffset = dragging
      ? { x: fieldWeldDrag.offsetX, y: fieldWeldDrag.offsetY }
      : mark.offsetX != null && mark.offsetY != null
        ? { x: mark.offsetX, y: mark.offsetY }
        : undefined
    const { points } = fieldWeldMarkGeometry(s, mark.t, mark.flipped, uiScale, avoidPoint, customOffset)
    return (
      <polygon
        className={`field-weld-mark${dragging ? ' dragging' : ''}`}
        points={points}
        pointerEvents="all"
        style={{ cursor: onToggleFieldWeldFlip || onMoveFieldWeldMark ? 'pointer' : undefined }}
        onPointerDown={(e) => handleFieldWeldPointerDown(e, s)}
        onPointerMove={handleFieldWeldPointerMove}
        onPointerUp={handleFieldWeldPointerUp}
        onPointerCancel={handleFieldWeldPointerUp}
      />
    )
  }

  function handleFieldWeldPointerDown(e: React.PointerEvent<SVGPolygonElement>, s: Segment) {
    e.stopPropagation()
    const mark = s.fieldWeldMark
    if (!mark) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = {
      x: s.start.x + (s.end.x - s.start.x) * mark.t,
      y: s.start.y + (s.end.y - s.start.y) * mark.t,
    }
    const avoidPoint = nearestElbow45Mark(elbow45Marks, at.x, at.y) ?? undefined
    const customOffset =
      mark.offsetX != null && mark.offsetY != null ? { x: mark.offsetX, y: mark.offsetY } : undefined
    const { baseCenter } = fieldWeldMarkGeometry(s, mark.t, mark.flipped, uiScale, avoidPoint, customOffset)
    const startOffsetX = (baseCenter.x - at.x) / uiScale
    const startOffsetY = (baseCenter.y - at.y) / uiScale
    fieldWeldDragRef.current = {
      pointerId: e.pointerId,
      segId: s.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX,
      startOffsetY,
      moved: false,
    }
    setFieldWeldDrag({ segId: s.id, offsetX: startOffsetX, offsetY: startOffsetY })
  }

  function handleFieldWeldPointerMove(e: React.PointerEvent<SVGPolygonElement>) {
    const d = fieldWeldDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    const dxScreen = e.clientX - d.startClientX
    const dyScreen = e.clientY - d.startClientY
    if (Math.abs(dxScreen) > TAP_DEADZONE_PX || Math.abs(dyScreen) > TAP_DEADZONE_PX) {
      d.moved = true
    }
    // 画面座標の移動量 -> 論理座標(パン・ズームの逆変換)、さらにuiScaleを
    // 割り戻して「基準スケール(=1)のときのpx相当」の相対オフセットにする
    // (fieldWeldMarkGeometry側で uiScale 倍して使うのと対になる)。
    const offsetX = d.startOffsetX + dxScreen / view.scale / uiScale
    const offsetY = d.startOffsetY + dyScreen / view.scale / uiScale
    setFieldWeldDrag({ segId: d.segId, offsetX, offsetY })
  }

  function handleFieldWeldPointerUp(e: React.PointerEvent<SVGPolygonElement>) {
    const d = fieldWeldDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    fieldWeldDragRef.current = null
    if (d.moved) {
      const final = fieldWeldDrag && fieldWeldDrag.segId === d.segId ? fieldWeldDrag : null
      onMoveFieldWeldMark?.(d.segId, final?.offsetX ?? d.startOffsetX, final?.offsetY ?? d.startOffsetY)
    } else {
      onToggleFieldWeldFlip?.(d.segId)
    }
    setFieldWeldDrag(null)
  }

  // 現合(現物合わせ)区間の補足メモアイコン。常時全文表示すると画面が
  // 煩雑になるため、メモがあるときだけ小さいアイコンを出し、タップした
  // ときだけ内容を確認できるようにする。寸法線が出る側と重ならないよう
  // 反対側に置く（現場溶接マーク等と同じ考え方）。
  function genGouNoteIcon(s: Segment) {
    if (!s.genGouNote) return null
    const mx = (s.start.x + s.end.x) / 2
    const my = (s.start.y + s.end.y) / 2
    const markPos = nearestElbow45Mark(elbow45Marks, mx, my)
    const side = chooseDimSide(s.start, s.end, markPos ?? undefined)
    const off = 24 * uiScale
    const cx = mx - side.nx * off
    const cy = my - side.ny * off
    const r = 10 * uiScale
    return (
      <g
        className="gengou-note-icon"
        pointerEvents="all"
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => window.alert(s.genGouNote)}
      >
        <circle cx={cx} cy={cy} r={r} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
          !
        </text>
      </g>
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

  // ズームボタン(－/＋)。ピンチ操作は連続的だが指先での微調整が難しいため、
  // 密集した図面を少しだけ縮小して全体を見渡したい、といった細かい調整を
  // 確実に行えるようにする（ピンチと同じ MIN_SCALE/MAX_SCALE の範囲・
  // 画面中央を基準にズームする点も共通）。
  function zoomByStep(dir: 1 | -1) {
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, view.scale + dir * ZOOM_BUTTON_STEP),
    )
    if (newScale === view.scale) return
    const anchor = { x: size.w / 2, y: size.h / 2 }
    const logicalX = (anchor.x - view.tx) / view.scale
    const logicalY = (anchor.y - view.ty) / view.scale
    onViewChange({
      scale: newScale,
      tx: anchor.x - logicalX * newScale,
      ty: anchor.y - logicalY * newScale,
    })
  }

  return (
    <>
    <svg
      ref={svgRef}
      className={`canvas${eraserMode ? ' eraser-active' : ''}`}
      // CSS変数として渡し、寸法ラベル等の共有スタイル(styles.css)側で
      // calc(基準px * var(--ui-scale, 1)) の形で参照する。PrintIsometric
      // (PDF出力)側はこの変数を持たないため既定値1のまま影響を受けない。
      style={{ '--ui-scale': uiScale } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* ピンチズーム・パン用の変換。中身は全て論理座標(=セグメント座標系)のまま描き、
          この<g>だけを拡大縮小・移動する。
          以前ここに will-change: transform を付けて専用の合成レイヤーに昇格させて
          いたが、iPhone実機で「ズームインすると図面の一部が消え、パンしても
          戻らず、ズームアウトすると戻る」という不具合が発生した。これは
          will-change による合成レイヤーの裏側テクスチャが、この<g>の中身
          (描いた全セグメントを含む＝図面が広いほど大きい)×拡大率のサイズで
          確保されるため、モバイルGPUの最大テクスチャサイズを超えると描画が
          欠落する(パンでは直らず、縮小してサイズが上限を下回ると直る)という
          症状と一致する。図面が広いほど・拡大するほど再現しやすい。
          安定して動く保証がない最適化よりも欠落しないことを優先し、
          will-change は付けない。 */}
      <g
        transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
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
        // 色: 選択=橙(最優先) / 系統色を設定していればその色 / 未設定なら
        // 従来通り属性確定=水色・未確定=グレー（ライト/ダークテーマで色を
        // 出し分け）。系統色は表示専用の任意設定で、未確定(dashed)かどうかの
        // 判定には関与しない（未確定でも系統色自体は見えたほうが分かりやすいため）。
        const stroke = selected
          ? 'var(--seg-selected)'
          : (s.colorId && lineColorHex(s.colorId)) ||
            (resolved ? 'var(--seg-resolved)' : 'var(--seg-unresolved)')
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
                strokeWidth={(selected ? 5 : 3) * uiScale}
                strokeLinecap="round"
                strokeDasharray={dashed ? '6 5' : undefined}
              />
            ))}
            <circle cx={s.start.x} cy={s.start.y} r={4 * uiScale} fill="var(--seg-dot)" />
            <circle cx={s.end.x} cy={s.end.y} r={4 * uiScale} fill="var(--seg-dot)" />
            {s.startFlange && flangeMarker(s, 'start', s.startFlange)}
            {s.endFlange && flangeMarker(s, 'end', s.endFlange)}
            {/* 現場合わせ区間: 二重線＋両端の三角マーク（表示専用、計算結果には無関係） */}
            {s.fieldFitAllowance && fieldFitDoubleLine(s)}
            {s.fieldFitAllowance && fieldFitEndMark(s, 'start', s.fieldFitStartFlipped ?? false)}
            {s.fieldFitAllowance && fieldFitEndMark(s, 'end', s.fieldFitEndFlipped ?? false)}
            {/* 現場溶接マーク: セグメント上の1点に置く三角マーク（表示専用） */}
            {fieldWeldMark(s)}
            {/* 現合(現物合わせ)区間の補足メモアイコン（表示専用） */}
            {s.isGenGou && genGouNoteIcon(s)}
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
            {/* 寸法表記(ISOGEN流): パイプから離した1本の寸法線の上に、芯々/芯先
                (1行目)と切り寸法(2行目、参照寸法を示す括弧書き)を2行で表示する。
                当初は外側/内側の2レーンに分けて別々の寸法線を引いていたが、
                2本の線・矢印が近接して重なって見づらいため、線は1本にまとめた。
                補助線+矢羽根は1組のみ。文字はその区間の向きに沿って傾ける。
                表示位置は重なり回避で押し出された最終位置（無ければ幾何計算
                どおりの基準位置）を使う。 */}
            {(() => {
              const c = cutById[s.id]
              if (!c || c.status === 'none') return null
              let t = 0.5
              if (!c.startConnected && c.endConnected) t = 0.3
              else if (c.startConnected && !c.endConnected) t = 0.7
              const mx = s.start.x + (s.end.x - s.start.x) * t
              const my = s.start.y + (s.end.y - s.start.y) * t
              // 相番(合番)表示が有効な区間は、寸法線の代わりに番号だけの
              // 丸バッジを表示する（別表(BOM対応表)で芯々/切り寸法を確認する
              // 運用のため、図面上は密集を避けて番号のみにする）。
              const assemblyNum = assemblyNumberActive ? assemblyNumberById[s.id] : undefined
              if (assemblyNum != null) {
                const resolved = resolvedLabels.get(`dim-${s.id}`)
                const cx = resolved?.cx ?? mx
                const cCenter = resolved?.cy ?? my + DIM_STANDOFF * uiScale
                return (
                  <g className="assembly-badge">
                    <circle cx={cx} cy={cCenter} r={ASSEMBLY_BADGE_R * uiScale} />
                    <text x={cx} y={cCenter} textAnchor="middle" dominantBaseline="central">
                      {assemblyNum}
                    </text>
                  </g>
                )
              }
              const markPos = nearestElbow45Mark(elbow45Marks, mx, my)
              const side = chooseDimSide(s.start, s.end, markPos ?? undefined)
              const geom = dimGeometry(s.start, s.end, side, uiScale)
              const extStart = dimExtensionLine(s.start, side, uiScale)
              const extEnd = dimExtensionLine(s.end, side, uiScale)
              const line1Resolved = resolvedLabels.get(`dim-line1-${s.id}`)
              const line1X = line1Resolved?.cx ?? geom.text1X
              const line1Y = line1Resolved?.cy ?? geom.text1Y
              const line2Resolved = resolvedLabels.get(`dim-line2-${s.id}`)
              const line2X = line2Resolved?.cx ?? geom.text2X
              const line2Y = line2Resolved?.cy ?? geom.text2Y
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
                  {/* 現合(現物合わせ)区間: 確定寸法として誤読されないよう、通常の
                      芯々/切り寸法の2段表記の代わりに1行だけの注記表示にする
                      (色も専用のものにして明確に見た目を変える)。 */}
                  {s.isGenGou ? (
                    <text
                      className="dim-gengou"
                      x={line1X}
                      y={line1Y}
                      textAnchor="middle"
                      transform={`rotate(${geom.textRotateDeg} ${line1X} ${line1Y})`}
                    >
                      {genGouLabelText(s.genGouQualifier, s.genGouDimension)}
                    </text>
                  ) : (
                    <>
                  {/* 1行目: 芯々/芯先(入力値そのまま) */}
                  <text
                    className="dim-center"
                    x={line1X}
                    y={line1Y}
                    textAnchor="middle"
                    transform={`rotate(${geom.textRotateDeg} ${line1X} ${line1Y})`}
                  >
                    {c.mode} {c.center}
                  </text>
                  {/* 2行目: 切り寸法(計算後の参照寸法。括弧書きで示す) */}
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

      {/* 描画中のプレビュー */}
      {preview && (
        <line
          x1={preview.start.x}
          y1={preview.start.y}
          x2={preview.end.x}
          y2={preview.end.y}
          stroke="var(--seg-preview)"
          strokeWidth={3 * uiScale}
          strokeDasharray="8 6"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
      </g>
    </svg>
    {/* ズームボタン(－/＋)。ピンチでの微調整が難しい場面向けの保険。
        表示専用で、寸法・計算結果には一切影響しない。 */}
    <div className="zoom-controls">
      <button
        type="button"
        onClick={() => zoomByStep(-1)}
        disabled={view.scale <= MIN_SCALE}
        aria-label="縮小"
      >
        －
      </button>
      <span className="zoom-percent">{Math.round(view.scale * 100)}%</span>
      <button
        type="button"
        onClick={() => zoomByStep(1)}
        disabled={view.scale >= MAX_SCALE}
        aria-label="拡大"
      >
        ＋
      </button>
    </div>
    {/* パン(移動)ジョイスティック。二本指ドラッグでのパン操作は変えず、
        片手の親指でも連続的に画面を動かせる保険として追加。 */}
    <PanJoystick view={view} onViewChange={onViewChange} uiScale={uiScale} />
    </>
  )
}
