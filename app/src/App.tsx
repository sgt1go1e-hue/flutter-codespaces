import { useEffect, useMemo, useRef, useState } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { SegmentPanel, DrawSettingsPanel } from './components/AttributePanel'
import { PartsPalette } from './components/PartsPalette'
import { DisclaimerModal } from './components/DisclaimerModal'
import { BomModal } from './components/BomModal'
import { DrawingLauncher } from './components/DrawingLauncher'
import { computeBom } from './lib/bom'
import { useLocalStorage } from './hooks/useLocalStorage'
import {
  type DrawingMeta,
  makeDrawingId,
  loadDrawingSegments,
  saveDrawingSegments,
  saveIndex,
  migrateLegacyDrawing,
} from './lib/drawingStore'
import {
  distanceToSegment,
  projectOnSegment,
  samePoint,
} from './lib/isometric'
import type { Point } from './types'
import { computeCrossoverGaps } from './lib/crossover'
import { normalizeBranchSplits } from './lib/branching'
import { computeAllCut } from './lib/cutlength'
import { findTeeContext } from './lib/takeout'
import {
  buildSegmentMap,
  computeEffective,
  inheritedPipeType,
  inheritedSize,
} from './lib/inheritance'
import { getPart } from './data/parts'
import { sizesForPipeType, nextReducerSize } from './data/masters'
import type { Segment } from './types'

// パーツをドロップしたとき、対象セグメントを拾うヒット距離(px)
const DROP_HIT = 28
// 免責事項の版。文面を更新して再同意を求めたい場合はこの数値を上げる。
const CONSENT_VERSION = 1

function makeId(): string {
  return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// 両フランジ: 対象セグメントを投影点で前後2本に分割する。
// A(上流) は元の属性を保持、B(下流) は A を親にして継承。接合ノードの両側にフランジを付ける。
function splitForDoubleFlange(
  segments: Segment[],
  targetId: string,
  dropPoint: Point,
): Segment[] {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return segments
  const { point: P, t } = projectOnSegment(dropPoint, target.start, target.end)

  // 端点に極端に近い場合は分割せず、その端にフランジを付けるだけ
  if (t < 0.02) {
    return segments.map((s) =>
      s.id === targetId ? { ...s, startFlange: 'double' } : s,
    )
  }
  if (t > 0.98) {
    return segments.map((s) =>
      s.id === targetId ? { ...s, endFlange: 'double' } : s,
    )
  }

  const bId = makeId()
  const A: Segment = { ...target, end: P, endFlange: 'double' }
  const B: Segment = {
    id: bId,
    start: P,
    end: target.end,
    angle: target.angle,
    parentId: target.id,
    startFlange: 'double',
    connection: 'flange',
    // pipeType/size/fitting は持たせない → A から継承・自動
  }
  A.connection = target.connection ?? 'flange'

  const result: Segment[] = []
  for (const s of segments) {
    if (s.id === targetId) {
      result.push(A)
      continue
    }
    // 元セグメントの子のうち、下流(B)側に接続しているものは B を親に付け替える
    if (s.parentId === targetId) {
      const dA = distanceToSegment(s.start, A.start, A.end)
      const dB = distanceToSegment(s.start, B.start, B.end)
      result.push(dB < dA ? { ...s, parentId: bId } : s)
      continue
    }
    result.push(s)
  }
  const idx = result.findIndex((s) => s.id === targetId)
  result.splice(idx + 1, 0, B)
  return result
}

// レジューサー: ドロップ位置でセグメントを前後に分割し、下流(B)を1段小さいサイズにする。
// A(上流)は元サイズを保持、B(下流)は小径＋レジューサー継手＋相手径=A径。交点以外にも挿入可。
// 戻り値の newId は、芯々寸法の既定値（継手直結=0mm）を後段で設定するために使う。
function splitForReducer(
  segments: Segment[],
  targetId: string,
  dropPoint: Point,
  kind: 'concentric' | 'eccentric',
  largeSize: string | undefined,
  smallSize: string | undefined,
): { segments: Segment[]; newId?: string } {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return { segments }
  // 隣の継手のすぐ際へ置きたいことが多いため、端に寄った位置は弾かず、
  // 安全な最小マージンへスナップする（ピクセル単位で狙わなくても確実に置ける）。
  const { t: rawT } = projectOnSegment(dropPoint, target.start, target.end)
  const MARGIN = 0.03
  const t = Math.min(1 - MARGIN, Math.max(MARGIN, rawT))
  const P: Point = {
    x: target.start.x + t * (target.end.x - target.start.x),
    y: target.start.y + t * (target.end.y - target.start.y),
  }

  const bId = makeId()
  // A の新しい終点(P)はレジューサーの内部分割点であり、元のセグメントの
  // 終点(フランジがあれば付いていた場所)ではないため、endFlangeは引き継がない
  // （引き継ぐと存在しない場所にフランジが付いたことになってしまう）。
  // 元の終点はBが引き継ぐので、endFlange・接続方法はBへ渡す。
  const A: Segment = { ...target, end: P, endFlange: undefined }
  const B: Segment = {
    id: bId,
    start: P,
    end: target.end,
    angle: target.angle,
    parentId: target.id,
    size: smallSize,
    fitting: `reducer_${kind}`,
    reducerSize: largeSize,
    endFlange: target.endFlange,
    connection: target.connection,
  }
  const result: Segment[] = []
  for (const s of segments) {
    if (s.id === targetId) {
      result.push(A)
      continue
    }
    if (s.parentId === targetId) {
      const dA = distanceToSegment(s.start, A.start, A.end)
      const dB = distanceToSegment(s.start, B.start, B.end)
      result.push(dB < dA ? { ...s, parentId: bId } : s)
      continue
    }
    result.push(s)
  }
  const idx = result.findIndex((s) => s.id === targetId)
  result.splice(idx + 1, 0, B)
  return { segments: result, newId: bId }
}

// 片フランジ: 分割せず、ドロップ位置に近い端を終端フランジとしてマークする。
function markSingleFlange(
  segments: Segment[],
  targetId: string,
  dropPoint: Point,
): Segment[] {
  const target = segments.find((s) => s.id === targetId)
  if (!target) return segments
  const { t } = projectOnSegment(dropPoint, target.start, target.end)
  const at = t < 0.5 ? 'startFlange' : 'endFlange'
  return segments.map((s) =>
    s.id === targetId
      ? { ...s, [at]: 'single', connection: s.connection ?? 'flange' }
      : s,
  )
}

export default function App() {
  // 起動時は必ず「新規作成／過去の図面」を選ぶ画面から始める。
  // 図面は名前を付けず自動保存され、複数を切り替えて管理できる。
  const [screen, setScreen] = useState<'launcher' | 'drawing'>('launcher')
  const [drawingIndex, setDrawingIndex] = useState<DrawingMeta[]>(() =>
    migrateLegacyDrawing(),
  )
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 「作図設定」バーの開閉（寸法入力とは独立。既定は畳んだ状態で割り込まない）
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 免責事項への同意記録（版＋同意日時を端末に保存）
  const [consent, setConsent] = useLocalStorage<{
    version?: number
    agreedAt?: string
  }>('piping-iso:consent', {})
  // 免責事項の再確認モーダル（設定からいつでも表示）
  const [reviewDisclaimer, setReviewDisclaimer] = useState(false)
  // 材料集計(BOM)モーダルの表示
  const [showBom, setShowBom] = useState(false)
  const needConsent = consent.version !== CONSENT_VERSION
  // これから描く線に適用する初期設定（線を選択せず通常画面で入力）
  const [defaults, setDefaults] = useLocalStorage<{
    pipeType?: string
    size?: string
    connection?: string
    /** 切り寸法の丸め方（既定=四捨五入）。継手寸法には適用しない。 */
    roundMode?: 'round' | 'floor'
    /** フランジの引きしろ(mm)。フランジが付いた端に共通で適用。 */
    flangeAllow?: number
    /** パッキン(ガスケット)厚を切り寸に加味するか */
    gasketOn?: boolean
    /** パッキン厚(mm, 1〜6) */
    gasketMm?: number
  }>('piping-iso:defaults', {})
  // パーツパレットからのドラッグ状態（画面座標で ghost を追従表示）
  const [partDrag, setPartDrag] = useState<{
    partId: string
    x: number
    y: number
  } | null>(null)

  const stageRef = useRef<HTMLElement>(null)

  // 「元に戻す」の履歴。配列の並び順に依存せず、作図・パーツ配置・削除等の
  // 構造的な操作を行った直前の状態を積んでおき、常に本当に最後に行った操作から
  // 正しい順序で戻せるようにする（segments配列の末尾要素を消すだけの実装だと、
  // レジューサー等の分割で配列の途中に挿入された場合に無関係な要素が消えてしまう）。
  const [history, setHistory] = useState<Segment[][]>([])
  function mutateSegments(updater: (prev: Segment[]) => Segment[]) {
    // setSegments の更新関数の中で setHistory を呼ぶと、React 18 の
    // StrictMode(開発時)がその更新関数を2回呼ぶ影響で履歴が二重に積まれて
    // しまうため、setHistory/setSegments は互いに独立した通常の呼び出しにする。
    const next = updater(segments)
    if (next !== segments) {
      setHistory((h) => [...h, segments].slice(-50))
      setSegments(next)
    }
  }

  // 指定セグメント区間の取り出し寸法合計(継手直結=0mmになる芯々寸法)を求める。
  // レジューサー配置直後の既定値や、サイズ変更時の再計算に使う。
  function reducerButtAllowance(segs: Segment[], segId: string): number {
    const eff = computeEffective(segs)
    const cut = computeAllCut(
      segs,
      eff,
      defaults.roundMode ?? 'round',
      defaults.flangeAllow ?? 0,
      defaults.gasketOn ? (defaults.gasketMm ?? 0) : 0,
    )
    return (cut[segId]?.startAllow ?? 0) + (cut[segId]?.endAllow ?? 0)
  }

  // ツールバーが横スクロール可能なとき、右端に「まだ続きがある」ヒントを出す
  // （初見でも「集計・拾い出し」等がスクロール先にあると気づけるように）。
  const toolsRef = useRef<HTMLDivElement>(null)
  const [toolsOverflow, setToolsOverflow] = useState(false)
  useEffect(() => {
    const el = toolsRef.current
    if (!el) return
    const update = () =>
      setToolsOverflow(el.scrollWidth - el.scrollLeft - el.clientWidth > 4)
    update()
    el.addEventListener('scroll', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [screen])

  // 開いている図面を自動保存し、一覧の更新日時・セグメント数を更新する。
  // 新規作成直後、まだ何も描いていない図面は一覧を汚さないよう登録を見送る。
  useEffect(() => {
    if (!drawingId) return
    saveDrawingSegments(drawingId, segments)
    setDrawingIndex((prev) => {
      const now = Date.now()
      const exists = prev.some((m) => m.id === drawingId)
      if (!exists && segments.length === 0) return prev
      const next = exists
        ? prev.map((m) =>
            m.id === drawingId
              ? { ...m, updatedAt: now, segCount: segments.length }
              : m,
          )
        : [...prev, { id: drawingId, createdAt: now, updatedAt: now, segCount: segments.length }]
      saveIndex(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, drawingId])

  function createNewDrawing() {
    setHistory([])
    setDrawingId(makeDrawingId())
    setSegments([])
    setSelectedId(null)
    setScreen('drawing')
  }

  function openDrawing(id: string) {
    setHistory([])
    setDrawingId(id)
    setSegments(loadDrawingSegments(id))
    setSelectedId(null)
    setScreen('drawing')
  }

  function goToLauncher() {
    setScreen('launcher')
  }

  const selected = useMemo(
    () => segments.find((s) => s.id === selectedId) ?? null,
    [segments, selectedId],
  )

  // 実効属性（継承後）と、またぎ表示の途切れ位置をまとめて計算
  const effectiveById = useMemo(() => computeEffective(segments), [segments])
  // 選択中セグメントが分岐(チーズ)ノードに繋がっていれば「メイン管／枝管」情報を得る
  const teeContext = useMemo(
    () =>
      selected ? findTeeContext(segments, effectiveById, selected.id) : undefined,
    [segments, effectiveById, selected],
  )
  const crossoverGaps = useMemo(() => computeCrossoverGaps(segments), [segments])
  const byId = useMemo(() => buildSegmentMap(segments), [segments])
  // 各区間の切断（加工）寸法
  const cutById = useMemo(
    () =>
      computeAllCut(
        segments,
        effectiveById,
        defaults.roundMode ?? 'round',
        defaults.flangeAllow ?? 0,
        defaults.gasketOn ? (defaults.gasketMm ?? 0) : 0,
      ),
    [
      segments,
      effectiveById,
      defaults.roundMode,
      defaults.flangeAllow,
      defaults.gasketOn,
      defaults.gasketMm,
    ],
  )
  // 材料集計(BOM)。モーダルを開いたときに使う。
  const bom = useMemo(
    () => computeBom(segments, effectiveById, cutById),
    [segments, effectiveById, cutById],
  )

  // 新規セグメントの親（上流）を、始点が接続している既存セグメントから決定する
  function findParentId(start: Segment['start']): string | undefined {
    const ends = segments.filter((s) => samePoint(s.end, start))
    if (ends.length) return ends[ends.length - 1].id
    const starts = segments.filter((s) => samePoint(s.start, start))
    if (starts.length) return starts[starts.length - 1].id
    // 中間分岐（チーズ）: 既存セグメントの途中に始点が乗っている場合
    const onLine = segments.filter(
      (s) => distanceToSegment(start, s.start, s.end) < 1.5,
    )
    if (onLine.length) return onLine[onLine.length - 1].id
    return undefined
  }

  function addSegment(seg: Omit<Segment, 'id'>) {
    const parentId = findParentId(seg.start)
    const applied: Segment = { ...seg, id: makeId(), parentId }
    // 接続方法は継承対象外なので、全ての新規線に初期設定を適用
    if (defaults.connection) applied.connection = defaults.connection
    // 管種・サイズはルート(接続元なし)にのみ付与。続きの線は上流から継承。
    if (!parentId) {
      if (defaults.pipeType) applied.pipeType = defaults.pipeType
      if (defaults.size) applied.size = defaults.size
    }
    // 追加後、分岐点で貫通している本管を自動分割（奥側を独立して寸法入力可能に）
    mutateSegments((prev) => normalizeBranchSplits([...prev, applied], makeId))
  }

  // 作図設定（defaults）の更新。管種変更時はサイズ整合をとる。
  function updateDefaults(patch: Partial<typeof defaults>) {
    setDefaults((d) => {
      const next = { ...d, ...patch }
      if ('pipeType' in patch) {
        const avail = sizesForPipeType(next.pipeType).map((s) => s.code)
        if (next.size && !avail.includes(next.size)) next.size = undefined
      }
      return next
    })
  }

  function updateSelected(patch: Partial<Segment>) {
    if (!selectedId) return
    setSegments((prev) => {
      const cur = prev.find((s) => s.id === selectedId)
      if (!cur) return prev
      const isReducer =
        cur.fitting === 'reducer_concentric' || cur.fitting === 'reducer_eccentric'
      const sizeChanged =
        ('size' in patch && patch.size !== cur.size) ||
        ('reducerSize' in patch && patch.reducerSize !== cur.reducerSize)
      // レジューサー区間のサイズ(自分側/相手側)を変えたとき、芯々寸法がまだ
      // 変更前サイズの「継手直結(0mm)」既定値のままなら、新サイズに合わせて
      // 再計算する。既定のまま次のサイズへ変えると、前のサイズ用の取り出し
      // 寸法が残ってしまい「継手不足」エラーになるのを防ぐ（手動で芯々寸法を
      // 調整済みの場合は上書きしない）。
      if (isReducer && sizeChanged) {
        const oldAllow = reducerButtAllowance(prev, selectedId)
        const atDefault =
          cur.centerLength != null && Math.abs(cur.centerLength - oldAllow) < 0.6
        const next = prev.map((s) =>
          s.id === selectedId ? { ...s, ...patch } : s,
        )
        if (atDefault) {
          const newAllow = reducerButtAllowance(next, selectedId)
          return next.map((s) =>
            s.id === selectedId
              ? { ...s, centerLength: Math.round(newAllow * 10) / 10 }
              : s,
          )
        }
        return next
      }
      return prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s))
    })
  }

  // 分岐(チーズ)の「メイン管サイズ／枝管サイズ」編集用。指定したセグメント群の
  // 実サイズ(size)を直接書き換える（選択中セグメント以外も対象になり得る）。
  function setSizeForSegments(segmentIds: string[], size: string | undefined) {
    if (segmentIds.length === 0) return
    const idSet = new Set(segmentIds)
    setSegments((prev) =>
      prev.map((s) => (idSet.has(s.id) ? { ...s, size } : s)),
    )
  }

  // タップで選択（寸法パネルが自動で出る。作図設定は開かない）。
  function handleSelect(id: string) {
    setSelectedId(id)
  }

  function closeSelection() {
    setSelectedId(null)
  }

  function deleteSelected() {
    if (!selectedId) return
    if (confirm('このセグメントを削除しますか？')) {
      mutateSegments((prev) => prev.filter((s) => s.id !== selectedId))
    }
    closeSelection()
  }

  function undo() {
    if (history.length === 0) return
    const prevState = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setSegments(prevState)
    closeSelection()
  }

  function clearAll() {
    if (segments.length === 0) return
    if (confirm('図面をすべて消去しますか？')) {
      mutateSegments(() => [])
      closeSelection()
    }
  }

  function agreeDisclaimer() {
    setConsent({ version: CONSENT_VERSION, agreedAt: new Date().toISOString() })
  }

  // --- パーツ ドラッグ&ドロップ ---
  function dropPart(partId: string, clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = { x: clientX - rect.left, y: clientY - rect.top }
    let best: Segment | null = null
    let bestDist = DROP_HIT
    for (const s of segments) {
      const d = distanceToSegment(p, s.start, s.end)
      if (d <= bestDist) {
        bestDist = d
        best = s
      }
    }
    if (!best) return
    const part = getPart(partId)
    if (!part) return
    const targetId = best.id
    const dropPoint = p
    if (part.action.type === 'flange') {
      if (part.action.flange === 'double') {
        mutateSegments((prev) => splitForDoubleFlange(prev, targetId, dropPoint))
      } else {
        mutateSegments((prev) => markSingleFlange(prev, targetId, dropPoint))
      }
    } else if (part.action.type === 'reducer') {
      const kind = part.action.reducer
      const large = effectiveById[targetId]?.size
      // 反対側(小径側)のサイズは、置いた時点では仮の値にしておき、選択パネルを
      // 自動で開いて実際のサイズをすぐ選び直せるようにする（置いた直後に
      // サイズを選ぶ、という流れの方が迷いにくいため）。仮の値はレジューサー
      // の実カタログに実在する組み合わせから選ぶ（呼び径の並び上の1段小さい
      // サイズだと規格に無い組み合わせになり得るため）。
      const small = nextReducerSize(large)
      const target = segments.find((s) => s.id === targetId)
      const originalCenter = target?.centerLength
      const { segments: next, newId } = splitForReducer(
        segments,
        targetId,
        dropPoint,
        kind,
        large,
        small,
      )
      if (newId) {
        // 新しくできた区間(レジューサー〜隣の継手側)は、既定で「継手直結(0mm)」に
        // なる芯々寸法を自動設定する（レジューサーと隣の継手が突き合わせという
        // 最も一般的なケースを既定値にする。間に配管を入れたい場合は芯々寸法を
        // 増やせばよい）。上流側には、元の芯々寸法からその分を差し引いた残りを
        // 引き継ぎ、分割前に入力していた全体の実測値を保つ。
        const bAllow = reducerButtAllowance(next, newId)
        const round1 = (x: number) => Math.round(x * 10) / 10
        const withDefaults = next.map((s) => {
          if (s.id === newId) return { ...s, centerLength: round1(bAllow) }
          if (s.id === targetId && originalCenter != null)
            return { ...s, centerLength: round1(originalCenter - bAllow) }
          return s
        })
        mutateSegments(() => withDefaults)
        // 置いた直後に選択状態にして、サイズ選択パネルをすぐ開けるようにする
        // （下の setSelectedId(null) は上書きしない）。
        setSelectedId(newId)
        return
      }
      mutateSegments(() => next)
    }
    // 分割後は選択状態をリセット（前後が別データになるため）
    setSelectedId(null)
  }
  // 最新の dropPart / segments を参照するための ref
  const dropRef = useRef(dropPart)
  dropRef.current = dropPart

  useEffect(() => {
    if (!partDrag) return
    const onMove = (e: PointerEvent) =>
      setPartDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    const onUp = (e: PointerEvent) => {
      const d = partDrag
      if (d) dropRef.current(d.partId, e.clientX, e.clientY)
      setPartDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // partDrag の開始/終了でのみ再バインド
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partDrag?.partId])

  return (
    <div className="app">
      {screen === 'launcher' && (
        <DrawingLauncher
          drawings={drawingIndex}
          onCreate={createNewDrawing}
          onOpen={openDrawing}
        />
      )}

      {screen === 'drawing' && (
        <>
      <header className="topbar">
        <div className="title">配管アイソメ図</div>
        <div className={`tools-wrap${toolsOverflow ? ' has-more' : ''}`}>
          <div className="tools" ref={toolsRef}>
            <button onClick={createNewDrawing}>新規作成</button>
            <button onClick={goToLauncher}>過去の図面</button>
            <button onClick={undo} disabled={history.length === 0}>
              元に戻す
            </button>
            <button onClick={clearAll} disabled={segments.length === 0}>
              全消去
            </button>
            <button
              className="primary"
              onClick={() => setShowBom(true)}
              disabled={segments.length === 0}
            >
              集計・拾い出し
            </button>
            <button onClick={() => setReviewDisclaimer(true)}>免責</button>
          </div>
          <span className="tools-scroll-hint" aria-hidden="true">
            ›
          </span>
        </div>
      </header>

      <main className="stage" ref={stageRef}>
        <DrawingCanvas
          segments={segments}
          selectedId={selectedId}
          onAddSegment={addSegment}
          onSelectSegment={handleSelect}
          onBackgroundTap={closeSelection}
          effectiveById={effectiveById}
          crossoverGaps={crossoverGaps}
          cutById={cutById}
          inputDisabled={partDrag !== null}
        />

        {/* ドラッグ中のパーツ ghost */}
        {partDrag && (
          <div
            className="part-ghost"
            style={{ left: partDrag.x, top: partDrag.y }}
          >
            {getPart(partDrag.partId)?.icon}
          </div>
        )}

        {/* 作図設定（左上に浮かせて常設。これから描く線の初期値。選択時は自動で開かない） */}
        <DrawSettingsPanel
          defaults={defaults}
          onChange={updateDefaults}
          open={settingsOpen}
          onToggle={() => setSettingsOpen((v) => !v)}
        />
      </main>

      {/* 寸法・属性の編集パネル（線を選択したときだけ表示。作図設定とは独立） */}
      {selected && (
        <SegmentPanel
          segment={selected}
          effective={effectiveById[selected.id]}
          inheritedPipeType={inheritedPipeType(selected, byId)}
          inheritedSize={inheritedSize(selected, byId)}
          cut={cutById[selected.id]}
          teeContext={teeContext}
          onSetTeeSize={setSizeForSegments}
          roundMode={defaults.roundMode ?? 'round'}
          onRoundModeChange={(mode) => updateDefaults({ roundMode: mode })}
          flangeAllow={defaults.flangeAllow ?? 0}
          onFlangeAllowChange={(mm) => updateDefaults({ flangeAllow: mm })}
          gasketOn={defaults.gasketOn ?? false}
          gasketMm={defaults.gasketMm ?? 0}
          onGasketChange={(on, mm) =>
            updateDefaults({ gasketOn: on, gasketMm: mm })
          }
          onChange={updateSelected}
          onDelete={deleteSelected}
          onClose={closeSelection}
        />
      )}

      <PartsPalette
        onDragStart={(partId, x, y) => setPartDrag({ partId, x, y })}
        draggingId={partDrag?.partId ?? null}
      />

      <footer className="statusbar">
        <span className="count">セグメント数: {segments.length}</span>
      </footer>

      {/* 材料集計(BOM) */}
      {showBom && (
        <BomModal
          bom={bom}
          segments={segments}
          effectiveById={effectiveById}
          crossoverGaps={crossoverGaps}
          cutById={cutById}
          onClose={() => setShowBom(false)}
        />
      )}
        </>
      )}

      {/* 初回同意（同意するまで他操作をブロック）。画面(launcher/drawing)を問わず表示する。 */}
      {needConsent && (
        <DisclaimerModal mode="consent" onAgree={agreeDisclaimer} />
      )}
      {/* 設定からの再確認（同意済みのときのみ） */}
      {!needConsent && reviewDisclaimer && (
        <DisclaimerModal
          mode="review"
          agreedAt={consent.agreedAt}
          onAgree={() => setReviewDisclaimer(false)}
          onClose={() => setReviewDisclaimer(false)}
        />
      )}
    </div>
  )
}
