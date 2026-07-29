import { useEffect, useMemo, useRef, useState } from 'react'
import { DrawingCanvas } from './components/DrawingCanvas'
import { SegmentPanel, DrawSettingsPanel } from './components/AttributePanel'
import { PartsPalette } from './components/PartsPalette'
import { DisclaimerModal } from './components/DisclaimerModal'
import { DailyGreetingModal } from './components/DailyGreetingModal'
import { BomModal } from './components/BomModal'
import { MenuOrderModal } from './components/MenuOrderModal'
import { DEFAULT_MENU_ORDER, sanitizeMenuOrder, type MenuItemId } from './lib/menuOrder'
import { DrawingLauncher } from './components/DrawingLauncher'
import { QuickCalc } from './components/QuickCalc'
import { ShareExportModal } from './components/ShareExportModal'
import { NotePanel } from './components/NotePanel'
import {
  parseShareFile,
  makeNoteId,
  SHARE_PERMISSION_LABELS,
  type SharePermission,
  type SegmentNote,
} from './lib/shareFile'
import { loadShareMeta, saveShareMeta } from './lib/shareStore'
import { computeBom } from './lib/bom'
import { useLocalStorage } from './hooks/useLocalStorage'
import {
  type DrawingMeta,
  type FolderMeta,
  type StatusColor,
  makeDrawingId,
  makeFolderId,
  loadDrawingSegments,
  saveDrawingSegments,
  deleteDrawingSegments,
  saveIndex,
  loadFolders,
  saveFolders,
  migrateLegacyDrawing,
} from './lib/drawingStore'
import { FolderShelf } from './components/FolderShelf'
import {
  distance,
  distanceToSegment,
  projectOnSegment,
  samePoint,
} from './lib/isometric'
import type { Point } from './types'
import { computeCrossoverGaps } from './lib/crossover'
import { normalizeBranchSplits } from './lib/branching'
import { computeAllCut } from './lib/cutlength'
import { findTeeContext, isReducerId } from './lib/takeout'
import { detectElbowClashes, applyElbowSuggestion, type ElbowClash } from './lib/elbowClash'
import {
  buildSegmentMap,
  computeEffective,
  inheritedPipeType,
  inheritedSize,
} from './lib/inheritance'
import { computeAssemblyNumbers } from './lib/assemblyNumbers'
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

// 日替わり挨拶メッセージの判定に使う「今日の日付」キー(端末のローカル日付、
// YYYY-MM-DD)。toISOString()はUTCに変換されるため、日本時間の深夜前後で
// 日付がずれることがあり使わない。
function todayDateKey(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
  // 安全な最小マージンへスナップする（両側の区間が縮退(長さ0)しない程度の
  // ごく小さな余白）。ドロップ位置をできるだけ忠実に反映するため、区間の
  // 長さに対する割合ではなく、画面上のピクセル距離で余白を決める
  // （割合方式だと長い区間ほど余白が大きくなり、チーズのすぐ近くを狙って
  // ドロップしても区間の遠い側へ大きくずれてしまっていた）。
  const { t: rawT } = projectOnSegment(dropPoint, target.start, target.end)
  const MARGIN_PX = 6
  const totalLen = distance(target.start, target.end) || 1
  const marginFrac = Math.min(0.45, MARGIN_PX / totalLen)
  const t = Math.min(1 - marginFrac, Math.max(marginFrac, rawT))
  const P: Point = {
    x: target.start.x + t * (target.end.x - target.start.x),
    y: target.start.y + t * (target.end.y - target.start.y),
  }

  const bId = makeId()
  // A の新しい終点(P)はレジューサーの内部分割点であり、元のセグメントの
  // 終点(フランジがあれば付いていた場所)ではないため、endFlangeは引き継がない
  // （引き継ぐと存在しない場所にフランジが付いたことになってしまう）。
  // 元の終点はBが引き継ぐので、endFlange・接続方法はBへ渡す。
  //
  // 芯々寸法のルール: レジューサーで分割すると区間は「メイン側」(継手〜
  // レジューサー太い方=A)と「先端側」(レジューサー細い方〜先=B)に分かれる。
  // どちらの寸法にするかは必ず現場判断でユーザーが指定するため、ここでは
  // どちらにも既定値を自動設定しない（A.centerLength は元のtargetの寸法を
  // 引き継がず、いったん未入力にする）。元の全体寸法は reducerSpanLength として
  // Bに凍結しておき、メイン側/先端側のどちらか一方だけ入力されたとき、
  // もう一方をこの値から自動算出できるようにする（未入力ならレジューサー
  // 追加時に寸法入力を促す扱いになる＝ Rule 1）。
  const A: Segment = { ...target, end: P, endFlange: undefined, centerLength: undefined }
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
    reducerSpanLength: target.centerLength,
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
  const [screen, setScreen] = useState<'launcher' | 'drawing' | 'quickcalc'>('launcher')
  const [drawingIndex, setDrawingIndex] = useState<DrawingMeta[]>(() =>
    migrateLegacyDrawing(),
  )
  // 現場・案件フォルダ(1階層のみ)。ホーム画面の整理用で、図面の計算内容とは無関係。
  const [folders, setFolders] = useState<FolderMeta[]>(() => loadFolders())
  // ホーム画面の表示状態: 'shelf'=フォルダ棚、それ以外=そのフォルダ(nullは未分類)の
  // 図面一覧。図面を開いて「過去の図面」で戻ってきたときに元のフォルダ一覧へ
  // 自然に戻れるよう、画面遷移(screen)とは独立に保持する（goToLauncherではリセットしない）。
  const [homeView, setHomeView] = useState<'shelf' | { folderId: string | null }>('shelf')
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 「作図設定」バーの開閉（寸法入力とは独立。既定は畳んだ状態で割り込まない）
  const [settingsOpen, setSettingsOpen] = useState(false)
  // パーツパレットの開閉。キャンバスを広く保つため既定は閉。
  const [partsOpen, setPartsOpen] = useState(false)
  // 消しゴムモード。オンの間はキャンバス上の線をタップすると詳細パネルを
  // 経由せずその場で即削除する（ルート変更等で何本もまとめて消したい場面向け）。
  // 他のメニュー操作を行うと自動的に解除する（誤操作防止）。
  const [eraserMode, setEraserMode] = useState(false)
  // 表示テーマ（暗い/明るい）。屋外の日差しの下では暗い画面が見づらいため、
  // 端末ごとに好みを覚えておいて切り替えられるようにする。
  const [theme, setTheme] = useLocalStorage<'dark' | 'light'>(
    'piping-iso:theme',
    'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  // 免責事項への同意記録（版＋同意日時を端末に保存）
  const [consent, setConsent] = useLocalStorage<{
    version?: number
    agreedAt?: string
  }>('piping-iso:consent', {})
  // 免責事項の再確認モーダル（設定からいつでも表示）
  const [reviewDisclaimer, setReviewDisclaimer] = useState(false)
  // 日替わり挨拶メッセージ。最後に表示した日付(端末保存)と今日の日付が
  // 違えば、その日まだ見せていないので1回だけ表示する。
  const [lastGreetingDate, setLastGreetingDate] = useLocalStorage(
    'piping-iso:dailyGreeting:lastShown',
    '',
  )
  const [showDailyGreeting, setShowDailyGreeting] = useState(false)
  // 材料集計(BOM)モーダルの表示
  const [showBom, setShowBom] = useState(false)
  // 図面共有(権限付きファイル共有)モーダルの表示
  const [showShareExport, setShowShareExport] = useState(false)
  // 現在開いている図面の共有権限。共有ファイルから受け取った図面だけ
  // 'full'以外になる（自分で作った/開いた通常の図面は常にフル編集）。
  const [sharePermission, setSharePermission] = useState<SharePermission>('full')
  // 共有図面(注記のみ)で線ごとに追加したメモ
  const [notes, setNotes] = useState<SegmentNote[]>([])
  // 現在の図面が共有ファイルから受け取ったものかどうか（notesの永続化要否の判定に使う）
  const [isImportedDrawing, setIsImportedDrawing] = useState(false)
  // 画面下段メニューの並び順（端末に保存。並び替え設定でいつでも変更・
  // 初期順序に戻せる）。将来項目が増減しても壊れないよう、読み込み時に
  // sanitizeMenuOrder で必ず全項目が揃った状態に補修する。
  const [menuOrderRaw, setMenuOrderRaw] = useLocalStorage<MenuItemId[]>(
    'piping-iso:menuOrder',
    DEFAULT_MENU_ORDER,
  )
  const menuOrder = useMemo(() => sanitizeMenuOrder(menuOrderRaw), [menuOrderRaw])
  const [showMenuOrder, setShowMenuOrder] = useState(false)
  const needConsent = consent.version !== CONSENT_VERSION
  // 図面共有機能の権限フラグ。'full'(通常の自分の図面、または共有元がフル編集を
  // 許可した図面)のときだけ、作図・削除・全消去・部材配置・配管設定の変更ができる。
  // 'dimensions'は芯々/芯先の寸法値の入力欄だけ、'annotate'は線ごとのメモ追加だけ、
  // 'view'は一切の編集ができない。
  const canEditStructure = sharePermission === 'full'
  const canAnnotate = sharePermission === 'annotate'
  // これから描く線に適用する初期設定（線を選択せず通常画面で入力）
  const [defaults, setDefaults] = useLocalStorage<{
    pipeType?: string
    size?: string
    connection?: string
    /** 塩ビ(VP)の継手タイプ(DV/TS)。管種がVP以外のときは無視される。 */
    vpSeries?: 'dv' | 'ts'
    /** 切り寸法の丸め方（既定=四捨五入）。継手寸法には適用しない。 */
    roundMode?: 'round' | 'floor'
    /** フランジの引きしろ(mm)。フランジが付いた端に共通で適用。 */
    flangeAllow?: number
    /** パッキン(ガスケット)厚を切り寸に加味するか */
    gasketOn?: boolean
    /** パッキン厚(mm, 1〜6) */
    gasketMm?: number
    /**
     * ルートギャップ(mm)。突き合わせ溶接(接続方法=溶接)で裏波を出すために
     * 設ける隙間。全溶接箇所に共通で適用（フランジ引きしろと同じ考え方）。
     */
    rootGap?: number
    /** 勾配(1/N のN)のベース値。区間ごとに個別上書きが無ければこれを継承する。 */
    slopeDenom?: number
    /**
     * 相番(合番)表示のON/OFF。未設定(auto)ならセグメント数が10本を超えたら
     * 自動でON、10本以下ならOFFにする。'on'/'off' で本数によらず固定できる。
     */
    assemblyNumberMode?: 'auto' | 'on' | 'off'
  }>('piping-iso:defaults', {})
  // 配管設定(defaults)で管種・サイズを変更した直後は、たとえ既存の線から
  // 続けて描く（＝親を持つ）新しい線であっても、その変更を次に描く1本には
  // 必ず反映したい（接続方法は元々どの新規線にも毎回適用される仕様のため、
  // 管種・サイズだけ「続きの線は上流から継承」に阻まれて反映されない不具合
  // だった）。継承の仕組み自体（レジューサー等で下流のサイズが自動で縮小
  // 反映される機能）は壊さないよう、defaults変更の直後の1本にだけ明示適用
  // するフラグをここに持つ（適用したら消費して false に戻す）。
  const pendingPipeTypeApplyRef = useRef(false)
  const pendingSizeApplyRef = useRef(false)
  // パーツパレットからのドラッグ状態（画面座標で ghost を追従表示）
  const [partDrag, setPartDrag] = useState<{
    partId: string
    x: number
    y: number
  } | null>(null)
  // キャンバスの表示変換（ピンチズーム・パン）。パーツをドロップした位置を
  // 論理座標へ変換する際、キャンバス側と同じ変換を使う必要があるためここで保持する
  // （以前はキャンバス内部だけの状態だったため、ズーム/パン後にドロップ位置の
  // 判定がずれてフランジ・レジューサーが置けなくなる不具合があった）。
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })

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
    let touchedFolderId: string | null = null
    setDrawingIndex((prev) => {
      const now = Date.now()
      const existing = prev.find((m) => m.id === drawingId)
      if (!existing && segments.length === 0) return prev
      touchedFolderId = existing?.folderId ?? null
      const next = existing
        ? prev.map((m) =>
            m.id === drawingId
              ? { ...m, updatedAt: now, segCount: segments.length }
              : m,
          )
        : [
            ...prev,
            {
              id: drawingId,
              createdAt: now,
              updatedAt: now,
              segCount: segments.length,
              folderId: null,
              statusColor: 'white' as const,
            },
          ]
      saveIndex(next)
      return next
    })
    // 図面が現場・案件フォルダに属していれば、フォルダの最終更新日も連動させる
    // （棚の並び順=最終更新日順に反映するため）。
    if (touchedFolderId) touchFolder(touchedFolderId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, drawingId])

  // 共有ファイルから受け取った図面のメモを自動保存する（通常のローカル図面には
  // このキー自体を作らない）。
  useEffect(() => {
    if (!drawingId || !isImportedDrawing) return
    saveShareMeta(drawingId, { permission: sharePermission, notes })
  }, [drawingId, isImportedDrawing, sharePermission, notes])

  function createNewDrawing() {
    setHistory([])
    setDrawingId(makeDrawingId())
    setSegments([])
    setSelectedId(null)
    setEraserMode(false)
    setSelectedPartId(null)
    setView({ scale: 1, tx: 0, ty: 0 })
    setSharePermission('full')
    setNotes([])
    setIsImportedDrawing(false)
    setScreen('drawing')
  }

  function openDrawing(id: string) {
    setHistory([])
    setDrawingId(id)
    setSegments(loadDrawingSegments(id))
    setSelectedId(null)
    setEraserMode(false)
    setSelectedPartId(null)
    setView({ scale: 1, tx: 0, ty: 0 })
    // 共有ファイルから受け取った図面だけ、保存済みの権限・メモを読み込む
    // （通常のローカル図面にはこのキー自体が存在せず、常にフル編集になる）。
    const shareMeta = loadShareMeta(id)
    setSharePermission(shareMeta?.permission ?? 'full')
    setNotes(shareMeta?.notes ?? [])
    setIsImportedDrawing(shareMeta != null)
    setScreen('drawing')
  }

  // 共有ファイル(LINE・AirDrop等で受け取ったもの)を選んで新しい図面として開く。
  // サーバーは使わず、選んだファイルをその場で読み込むだけ。
  async function importShareFile(file: File) {
    const text = await file.text()
    const parsed = parseShareFile(text)
    if (!parsed) {
      alert('共有ファイルを読み込めませんでした。ファイルが壊れているか、対応していない形式です。')
      return
    }
    const id = makeDrawingId()
    saveDrawingSegments(id, parsed.segments)
    saveShareMeta(id, { permission: parsed.permission, notes: parsed.notes })
    const now = Date.now()
    setDrawingIndex((prev) => {
      const meta: DrawingMeta = {
        id,
        createdAt: now,
        updatedAt: now,
        segCount: parsed.segments.length,
        name: parsed.drawingName ? `${parsed.drawingName}（受信）` : '共有で受信した図面',
        folderId: null,
        statusColor: 'white',
      }
      const next = [...prev, meta]
      saveIndex(next)
      return next
    })
    openDrawing(id)
  }

  // 「注記のみ」権限の図面で、選択中の線にメモを追加する
  function addNote(segmentId: string, text: string) {
    const note: SegmentNote = {
      id: makeNoteId(),
      segmentId,
      text,
      createdAt: new Date().toISOString(),
    }
    setNotes((prev) => [...prev, note])
  }

  function goToLauncher() {
    setEraserMode(false)
    setScreen('launcher')
  }

  function openQuickCalc() {
    setEraserMode(false)
    setScreen('quickcalc')
  }

  // クイック計算を閉じたら、開いていた図面があればそこへ、なければランチャーへ戻る
  function closeQuickCalc() {
    setScreen(drawingId ? 'drawing' : 'launcher')
  }

  function renameDrawing(id: string, currentName: string) {
    const input = window.prompt(
      '図面の名前を入力してください（空にすると未設定に戻ります）',
      currentName,
    )
    if (input === null) return
    const name = input.trim()
    setDrawingIndex((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, name: name || undefined } : m))
      saveIndex(next)
      return next
    })
  }

  function deleteDrawing(id: string) {
    if (!window.confirm('この図面を削除しますか？元に戻せません。')) return
    setDrawingIndex((prev) => {
      const next = prev.filter((m) => m.id !== id)
      saveIndex(next)
      return next
    })
    deleteDrawingSegments(id)
    if (drawingId === id) {
      setDrawingId(null)
      setSegments([])
      setHistory([])
    }
  }

  // --- 現場・案件フォルダ（ホーム画面の整理用。1階層のみ） ---

  /** 図面の更新に連動して、所属フォルダの最終更新日時も進める（棚の並び順に使う）。 */
  function touchFolder(folderId: string) {
    const now = Date.now()
    setFolders((prev) => {
      if (!prev.some((f) => f.id === folderId)) return prev
      const next = prev.map((f) => (f.id === folderId ? { ...f, updatedAt: now } : f))
      saveFolders(next)
      return next
    })
  }

  function createFolder() {
    const input = window.prompt('現場・案件名を入力してください')
    if (input == null) return
    const name = input.trim()
    if (!name) return
    const now = Date.now()
    const folder: FolderMeta = { id: makeFolderId(), name, createdAt: now, updatedAt: now }
    setFolders((prev) => {
      const next = [...prev, folder]
      saveFolders(next)
      return next
    })
  }

  function renameFolder(id: string) {
    const folder = folders.find((f) => f.id === id)
    if (!folder) return
    const input = window.prompt('現場・案件名を入力してください', folder.name)
    if (input == null) return
    const name = input.trim()
    if (!name) return
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name } : f))
      saveFolders(next)
      return next
    })
  }

  function deleteFolder(id: string) {
    const containedCount = drawingIndex.filter((m) => m.folderId === id).length
    const msg =
      containedCount > 0
        ? `このフォルダを削除しますか？中の${containedCount}件の図面は「未分類」に戻ります。`
        : 'このフォルダを削除しますか？'
    if (!window.confirm(msg)) return
    setFolders((prev) => {
      const next = prev.filter((f) => f.id !== id)
      saveFolders(next)
      return next
    })
    setDrawingIndex((prev) => {
      const next = prev.map((m) => (m.folderId === id ? { ...m, folderId: null } : m))
      saveIndex(next)
      return next
    })
    setHomeView((v) => (v !== 'shelf' && v.folderId === id ? 'shelf' : v))
  }

  /** 図面を別の現場・案件フォルダ（またはnull=未分類）へ移動する。 */
  function moveDrawingToFolder(id: string, folderId: string | null) {
    setDrawingIndex((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, folderId } : m))
      saveIndex(next)
      return next
    })
    if (folderId) touchFolder(folderId)
  }

  /** 図面の進捗ステータス色（白/赤/緑/青、意味はユーザー自由）を設定する。 */
  function setDrawingStatusColor(id: string, statusColor: StatusColor) {
    setDrawingIndex((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, statusColor } : m))
      saveIndex(next)
      return next
    })
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
        defaults.slopeDenom,
        defaults.rootGap ?? 0,
      ),
    [
      segments,
      effectiveById,
      defaults.roundMode,
      defaults.flangeAllow,
      defaults.gasketOn,
      defaults.gasketMm,
      defaults.slopeDenom,
      defaults.rootGap,
    ],
  )
  // 相番(合番)表示: セグメント数が10本を超えたら自動でON、10本以下ならOFF
  // （既定=自動判定）。defaults.assemblyNumberMode で手動に上書き可能。
  const assemblyNumberActive =
    defaults.assemblyNumberMode === 'on'
      ? true
      : defaults.assemblyNumberMode === 'off'
        ? false
        : segments.length > 10
  // 相番の割り当て（都度算出・非破壊。既存の芯々/切り寸法計算には触れない）。
  const assemblyNumberById = useMemo(
    () => computeAssemblyNumbers(segments, cutById),
    [segments, cutById],
  )

  // 選択中セグメントがレジューサー区間の「メイン側」または「先端側」なら、
  // もう一方(パートナー)の区間とその切り寸法を返す。詳細パネルで
  // メイン側/先端側の寸法をまとめて1箇所で入力できるようにするために使う。
  const reducerPartner = useMemo(() => {
    if (!selected) return undefined
    if (isReducerId(selected.fitting)) {
      const main = selected.parentId ? segments.find((s) => s.id === selected.parentId) : undefined
      if (!main) return undefined
      return { segment: main, cut: cutById[main.id], selectedRole: 'tip' as const }
    }
    const tip = segments.find((s) => s.parentId === selected.id && isReducerId(s.fitting))
    if (!tip) return undefined
    return { segment: tip, cut: cutById[tip.id], selectedRole: 'main' as const }
  }, [selected, segments, cutById])

  // レジューサー区間のメイン側/先端側の芯々寸法をまとめて更新する。
  // 片方だけ渡せばその区間だけ更新し、もう一方は cutlength.ts 側の
  // deriveReducerCenterLength が自動算出する（データは書き換えない）。
  function updateReducerPair(mainId: string, tipId: string, patch: { main?: number; tip?: number }) {
    setSegments((prev) =>
      prev.map((s) => {
        if (s.id === mainId && 'main' in patch) return { ...s, centerLength: patch.main }
        if (s.id === tipId && 'tip' in patch) return { ...s, centerLength: patch.tip }
        return s
      }),
    )
  }

  // 材料集計(BOM)。モーダルを開いたときに使う。
  const bom = useMemo(
    () => computeBom(segments, effectiveById, cutById),
    [segments, effectiveById, cutById],
  )
  // エルボtoエルボで芯々寸法が足りず継手が収まらない箇所（45°×2 / 90°+45° 振り分けの提案対象）
  const elbowClashes = useMemo(
    () => detectElbowClashes(segments, cutById),
    [segments, cutById],
  )
  const selectedClash = useMemo(
    () => (selectedId ? elbowClashes.find((c) => c.midSegId === selectedId) : undefined),
    [elbowClashes, selectedId],
  )
  function applyElbowClash(clash: ElbowClash) {
    mutateSegments((prev) => applyElbowSuggestion(prev, clash))
  }

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
    if (!canEditStructure) return
    const parentId = findParentId(seg.start)
    const applied: Segment = { ...seg, id: makeId(), parentId }
    // 接続方法は継承対象外なので、全ての新規線に初期設定を適用
    if (defaults.connection) applied.connection = defaults.connection
    // 塩ビの継手タイプ(DV/TS)も接続方法と同様、継承対象外で毎回適用
    if (defaults.vpSeries) applied.vpSeries = defaults.vpSeries
    // 管種・サイズは基本、ルート(接続元なし)にのみ付与し、続きの線は上流から
    // 継承する（レジューサー等で下流のサイズが自動的に縮小反映される仕組みの
    // 土台のため）。ただし配管設定でたった今どちらかを変更した直後は、続きの
    // 線であってもその変更を次の1本に明示反映する（pendingフラグ、消費後リセット）。
    if (!parentId || pendingPipeTypeApplyRef.current) {
      if (defaults.pipeType) applied.pipeType = defaults.pipeType
    }
    if (!parentId || pendingSizeApplyRef.current) {
      if (defaults.size) applied.size = defaults.size
    }
    pendingPipeTypeApplyRef.current = false
    pendingSizeApplyRef.current = false
    // 追加後、分岐点で貫通している本管を自動分割（奥側を独立して寸法入力可能に）
    mutateSegments((prev) => normalizeBranchSplits([...prev, applied], makeId))
  }

  // 作図設定（defaults）の更新。管種変更時はサイズ整合をとる。
  function updateDefaults(patch: Partial<typeof defaults>) {
    // 管種・サイズを変更した直後は、続きの線であっても次の1本にだけ明示的に
    // 反映する（addSegment側のpendingフラグ、詳細はそちらのコメント参照）。
    if ('pipeType' in patch) pendingPipeTypeApplyRef.current = true
    if ('size' in patch) pendingSizeApplyRef.current = true
    setDefaults((d) => {
      const next = { ...d, ...patch }
      if ('pipeType' in patch) {
        const avail = sizesForPipeType(next.pipeType).map((s) => s.code)
        if (next.size && !avail.includes(next.size)) next.size = undefined
        // 勾配(1/N)は排水配管(VP/SGP)特有の概念のため、管種が実際に変わった
        // ときだけベース値を未設定に戻す（既に個別上書き済みの線の勾配には
        // 影響しない）。サイズ・接続方法だけの変更では保持したままでよい。
        if (next.pipeType !== d.pipeType) next.slopeDenom = undefined
      }
      return next
    })
  }

  // レジューサー区間のメイン側/先端側の芯々寸法(centerLength)は、片方だけ
  // 入力されているとき、もう片方を reducerSpanLength(分割前の全体寸法) から
  // 「継手/レジューサーの控え寸法込みで自動算出」する。この算出は
  // cutlength.ts 側でセグメントのデータを書き換えずに読み取り時に行う
  // （effectiveSlopeDenom 等と同じ「都度算出」パターン）ため、サイズや
  // 相手径を変更してレジューサーの取り出し寸法(H)が変わっても、未入力のまま
  // 残しているデータは自動的に追従する。そのため updateSelected 側では
  // レジューサー専用の特別なサイズ変更処理は不要（通常のパッチ適用のみでよい）。
  function updateSelected(patch: Partial<Segment>) {
    if (!selectedId) return
    setSegments((prev) => prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)))
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

  // 相番(合番)の手動上書き。BOMの対応表・詳細パネルどちらからも呼べる
  // （どちらも同じ assemblyNumberOverride フィールドを直接書き換えるだけ）。
  // undefined を渡すと上書きを解除し、自動採番(接続順)に戻す。
  function setAssemblyNumberOverride(id: string, num: number | undefined) {
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, assemblyNumberOverride: num } : s)),
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
    if (!selectedId || !canEditStructure) return
    if (confirm('このセグメントを削除しますか？')) {
      mutateSegments((prev) => prev.filter((s) => s.id !== selectedId))
    }
    closeSelection()
  }

  // 消しゴムモード中、線をタップした瞬間に確認なしで即削除する。詳細パネルは
  // 経由しない。何本もまとめて消したい操作を素早く行えるようにするための
  // ものなので、1本ずつ確認ダイアログを出すと本来の目的を損なう（「元に戻す」で
  // 復元できるため安全性は確保している）。
  function eraseSegment(id: string) {
    if (!canEditStructure) return
    mutateSegments((prev) => prev.filter((s) => s.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // 現場溶接マーク・現場合わせ区間の三角マークは、キャンバス上のマーク自体を
  // タップすると向きを反転できる（詳細パネルの反転ボタンと同じ操作を、
  // マークの直接タップでも行えるようにするための最短経路）。表示専用の
  // トグル値であり、切り寸法等の計算結果には一切影響しない。
  function toggleFieldWeldFlip(id: string) {
    if (!canEditStructure) return
    mutateSegments((prev) =>
      prev.map((s) =>
        s.id === id && s.fieldWeldMark
          ? { ...s, fieldWeldMark: { ...s.fieldWeldMark, flipped: !s.fieldWeldMark.flipped } }
          : s,
      ),
    )
  }
  function toggleFieldFitFlip(id: string, at: 'start' | 'end') {
    if (!canEditStructure) return
    const key = at === 'start' ? 'fieldFitStartFlipped' : 'fieldFitEndFlipped'
    mutateSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [key]: !s[key] } : s)),
    )
  }

  // 現場溶接マークをドラッグして移動したとき、対象点(t位置)からの相対
  // オフセットを確定して保存する（表示専用。切り寸法等には無関係）。
  function moveFieldWeldMark(id: string, offsetX: number, offsetY: number) {
    if (!canEditStructure) return
    mutateSegments((prev) =>
      prev.map((s) =>
        s.id === id && s.fieldWeldMark
          ? { ...s, fieldWeldMark: { ...s.fieldWeldMark, offsetX, offsetY } }
          : s,
      ),
    )
  }

  function undo() {
    if (history.length === 0) return
    const prevState = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setSegments(prevState)
    setEraserMode(false)
    closeSelection()
  }

  function clearAll() {
    if (segments.length === 0 || !canEditStructure) return
    if (confirm('図面をすべて消去しますか？')) {
      // 「元に戻す」履歴も一緒に消す。mutateSegments経由だと消去前の
      // segmentsが履歴に積まれてしまい、全消去の直後に元に戻すを押すと
      // 消去前の古い区間(古い管種・寸法・相番等)がまるごと復元されて
      // しまう（「新しく描いた線のはずが古いデータが残っている」ように
      // 見える不具合の原因）。新規作成/図面を開くときと同様、全消去も
      // 完全なリセットとして扱うため、履歴には積まずに直接空にする。
      setHistory([])
      setSegments([])
      setEraserMode(false)
      closeSelection()
    }
  }

  function agreeDisclaimer() {
    setConsent({ version: CONSENT_VERSION, agreedAt: new Date().toISOString() })
  }

  // 初回同意(ベータロックとは独立)が済み、通常のアプリ画面が表示される
  // タイミングで、今日まだ挨拶メッセージを見せていなければ1回だけ出す。
  useEffect(() => {
    if (needConsent) return
    if (lastGreetingDate !== todayDateKey()) {
      setShowDailyGreeting(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needConsent])

  function closeDailyGreeting() {
    setLastGreetingDate(todayDateKey())
    setShowDailyGreeting(false)
  }

  // --- パーツ配置（ドラッグ&ドロップ / 選択→タップ の両方から使う共通処理） ---
  // 論理座標（キャンバスのセグメントと同じ座標系）の1点を受け取り、そこに
  // 最も近い区間へパーツを配置する。ドラッグ&ドロップ(dropPart, 画面座標→
  // 論理座標へ変換してから呼ぶ)と、選択→タップ(placePartTap, DrawingCanvas
  // 側で既に論理座標へ変換済みの点をそのまま渡す)の両方から同じロジックを
  // 使うことで、配置の計算(スプリット位置・レジューサーのサイズ決め等)を
  // 完全に共通化し、操作方法によって挙動が変わらないようにする。
  function placePartAtPoint(partId: string, p: Point) {
    if (!canEditStructure) return
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
      const { segments: next, newId } = splitForReducer(
        segments,
        targetId,
        dropPoint,
        kind,
        large,
        small,
      )
      // 芯々寸法(メイン側/先端側)は、どちらもここでは自動設定しない
      // （現場でどちらを実測して入力するかはユーザーが選ぶ。片方だけ入力
      // すれば、もう片方は分割前の全体寸法から自動算出される）。
      mutateSegments(() => next)
      if (newId) {
        // 置いた直後に選択状態にして、寸法入力欄(メイン側/先端側)とサイズ
        // 選択パネルをすぐ開けるようにする（下の setSelectedId(null) は
        // 上書きしない）。
        setSelectedId(newId)
        return
      }
    } else if (part.action.type === 'fieldWeldMark') {
      // 現熔マーク: 分割はせず、タップ/ドロップ位置に最も近い点(t)へ
      // その区間の現場溶接マークとして置く（1本のセグメントにつき最大1箇所、
      // 既に置いてあれば上書き）。表示専用の注記で、切り寸法等の計算結果
      // には一切影響しない。フランジと同様、置いた後に選択状態へは
      // しない（選択すると寸法欄が自動フォーカスしてテンキーが開いてしまい、
      // 「置いただけ」のつもりが詳細パネルへ強制的に飛ばされる形になって
      // しまうため。向き反転等はキャンバス上のマーク直接タップで行える）。
      const { t } = projectOnSegment(dropPoint, best.start, best.end)
      mutateSegments((prev) =>
        prev.map((s) => (s.id === targetId ? { ...s, fieldWeldMark: { t, flipped: false } } : s)),
      )
    }
    // 分割後は選択状態をリセット（前後が別データになるため）
    setSelectedId(null)
  }

  // ドラッグ&ドロップ用: 画面座標(client)をキャンバスと同じ論理座標へ変換してから
  // placePartAtPoint を呼ぶ（キャンバスがピンチズーム・パンされていると、画面座標を
  // そのまま論理座標として使うとずれてしまうため、<g transform>と同じ逆変換が必要）。
  function dropPart(partId: string, clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    }
    placePartAtPoint(partId, p)
  }
  // 選択→タップ用: パーツパレットでタップ選択したパーツid。ドラッグ中(partDrag)とは
  // 独立に管理し、キャンバス側のタップを配置操作として扱うかどうかを切り替える。
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  function placePartTap(point: Point) {
    if (!selectedPartId) return
    placePartAtPoint(selectedPartId, point)
    setSelectedPartId(null)
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

  // 画面下段メニューの各ボタン本体。表示順は menuOrder に従うため、ここでは
  // idごとの中身(機能・見た目)だけを定義する（並び替えの影響を受けない）。
  const menuItemNodes: Record<MenuItemId, React.ReactNode> = {
    newDrawing: (
      <button key="newDrawing" onClick={createNewDrawing}>
        新規作成
      </button>
    ),
    openLauncher: (
      <button key="openLauncher" onClick={goToLauncher}>
        過去の図面
      </button>
    ),
    quickCalc: (
      <button key="quickCalc" onClick={openQuickCalc}>
        🧮 クイック計算
      </button>
    ),
    undo: (
      <button key="undo" onClick={undo} disabled={history.length === 0 || !canEditStructure}>
        元に戻す
      </button>
    ),
    clearAll: (
      <button
        key="clearAll"
        onClick={clearAll}
        disabled={segments.length === 0 || !canEditStructure}
      >
        全消去
      </button>
    ),
    eraser: (
      <button
        key="eraser"
        className={`eraser-toggle${eraserMode ? ' active' : ''}`}
        onClick={() => {
          if (!canEditStructure) return
          setEraserMode((m) => !m)
          setSelectedId(null)
          setSelectedPartId(null)
        }}
        disabled={segments.length === 0 || !canEditStructure}
        title="オンの間は線をタップするとその場で即削除します"
      >
        🧹 消しゴム{eraserMode ? '中' : ''}
      </button>
    ),
    bom: (
      <button
        key="bom"
        className="primary"
        onClick={() => {
          setEraserMode(false)
          setShowBom(true)
        }}
        disabled={segments.length === 0}
      >
        集計・拾い出し
      </button>
    ),
    share: (
      <button
        key="share"
        onClick={() => {
          setEraserMode(false)
          setShowShareExport(true)
        }}
        disabled={segments.length === 0}
      >
        📤 共有
      </button>
    ),
    disclaimer: (
      <button
        key="disclaimer"
        onClick={() => {
          setEraserMode(false)
          setReviewDisclaimer(true)
        }}
      >
        免責
      </button>
    ),
    theme: (
      <button
        key="theme"
        onClick={() => {
          setEraserMode(false)
          setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
        }}
        title="屋外の明るい場所では「明るい画面」が見やすくなります"
      >
        {theme === 'dark' ? '☀️ 明るい画面' : '🌙 暗い画面'}
      </button>
    ),
  }

  return (
    <div className="app">
      {screen === 'launcher' &&
        (homeView === 'shelf' ? (
          <FolderShelf
            folders={folders}
            drawings={drawingIndex}
            onOpenFolder={(folderId) => setHomeView({ folderId })}
            onCreateFolder={createFolder}
            onRenameFolder={renameFolder}
            onDeleteFolder={deleteFolder}
            onCreate={createNewDrawing}
            onQuickCalc={openQuickCalc}
            onImportFile={importShareFile}
          />
        ) : (
          <DrawingLauncher
            drawings={drawingIndex}
            folders={folders}
            folderId={homeView.folderId}
            onBack={() => setHomeView('shelf')}
            onOpen={openDrawing}
            onRename={renameDrawing}
            onDelete={deleteDrawing}
            onMoveToFolder={moveDrawingToFolder}
            onSetStatusColor={setDrawingStatusColor}
          />
        ))}

      {screen === 'quickcalc' && <QuickCalc onClose={closeQuickCalc} />}

      {screen === 'drawing' && (
        <>
      {/* 図面共有機能で権限が制限されているとき、常に見える位置で権限を明示する
          （なぜ編集できないか分かるように）。 */}
      {sharePermission !== 'full' && (
        <div className="share-permission-banner">
          共有権限: <b>{SHARE_PERMISSION_LABELS[sharePermission]}</b>
          <button type="button" onClick={() => setShowShareExport(true)}>
            送り返す
          </button>
        </div>
      )}

      {/* パーツ(両フランジ・レジューサー等)は画面上部に常設（親指の届く下部は
          「元に戻す」等の頻用メニューに譲る。ドラッグして配管上へ配置する
          操作自体は位置に関係なく機能する）。フル編集権限のときだけ表示する。 */}
      {canEditStructure && (
        <PartsPalette
          onDragStart={(partId, x, y) => {
            setSelectedPartId(null)
            setPartDrag({ partId, x, y })
          }}
          draggingId={partDrag?.partId ?? null}
          selectedId={selectedPartId}
          onSelect={(partId) => {
            setEraserMode(false)
            setSelectedPartId((cur) => (cur === partId ? null : partId))
          }}
          open={partsOpen}
          onToggle={() => setPartsOpen((v) => !v)}
        />
      )}

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
          partPlaceMode={selectedPartId != null}
          onPlacePartTap={placePartTap}
          onCancelPartPlace={() => setSelectedPartId(null)}
          disableDraw={!canEditStructure}
          view={view}
          onViewChange={setView}
          baseSlopeDenom={defaults.slopeDenom}
          eraserMode={eraserMode && canEditStructure}
          onEraseSegment={eraseSegment}
          assemblyNumberActive={assemblyNumberActive}
          assemblyNumberById={assemblyNumberById}
          onToggleFieldWeldFlip={canEditStructure ? toggleFieldWeldFlip : undefined}
          onToggleFieldFitFlip={canEditStructure ? toggleFieldFitFlip : undefined}
          onMoveFieldWeldMark={canEditStructure ? moveFieldWeldMark : undefined}
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
          segmentCount={segments.length}
          onOpenMenuOrder={() => setShowMenuOrder(true)}
          disabled={!canEditStructure}
        />
      </main>

      {/* 寸法・属性の編集パネル（線を選択したときだけ表示。作図設定とは独立）。
          共有権限が「注記のみ」なら通常のパネルの代わりにメモ専用パネルを、
          「閲覧のみ」ならどちらも表示しない。 */}
      {selected && canAnnotate && (
        <NotePanel
          segment={selected}
          effective={effectiveById[selected.id]}
          cut={cutById[selected.id]}
          notes={notes.filter((n) => n.segmentId === selected.id)}
          onAddNote={(text) => addNote(selected.id, text)}
          onClose={closeSelection}
        />
      )}
      {selected && sharePermission !== 'view' && !canAnnotate && (
        <SegmentPanel
          segment={selected}
          effective={effectiveById[selected.id]}
          inheritedPipeType={inheritedPipeType(selected, byId)}
          inheritedSize={inheritedSize(selected, byId)}
          cut={cutById[selected.id]}
          elbowClash={selectedClash}
          onApplyElbowClash={() => selectedClash && applyElbowClash(selectedClash)}
          teeContext={teeContext}
          onSetTeeSize={setSizeForSegments}
          reducerPartner={reducerPartner}
          onChangeReducerPair={updateReducerPair}
          baseSlopeDenom={defaults.slopeDenom}
          roundMode={defaults.roundMode ?? 'round'}
          onRoundModeChange={(mode) => updateDefaults({ roundMode: mode })}
          flangeAllow={defaults.flangeAllow ?? 0}
          onFlangeAllowChange={(mm) => updateDefaults({ flangeAllow: mm })}
          rootGap={defaults.rootGap ?? 0}
          onRootGapChange={(mm) => updateDefaults({ rootGap: mm })}
          gasketOn={defaults.gasketOn ?? false}
          gasketMm={defaults.gasketMm ?? 0}
          onGasketChange={(on, mm) =>
            updateDefaults({ gasketOn: on, gasketMm: mm })
          }
          assemblyNumberActive={assemblyNumberActive}
          assemblyNumber={assemblyNumberById[selected.id]}
          onChange={updateSelected}
          onDelete={deleteSelected}
          onClose={closeSelection}
          canEditStructure={canEditStructure}
        />
      )}

      {/* メニュー(元に戻す・消しゴム・全消去・集計拾い出し・クイック計算・
          新規作成・過去の図面・免責・テーマ切替)は画面下部(親指の届きやすい
          位置)に配置。特に「元に戻す・消しゴム・全消去」は使用頻度が高いため
          左寄せの既定順にしている。表示順は menuOrder(並び替え設定で変更・
          端末に保存)に従う。ボタン自体の機能・見た目は並び替えの対象外。 */}
      <header className="topbar">
        <div className="title">配管アイソメ図</div>
        <div className={`tools-wrap${toolsOverflow ? ' has-more' : ''}`}>
          <div className="tools" ref={toolsRef}>
            {menuOrder.map((id) => menuItemNodes[id])}
          </div>
          <span className="tools-scroll-hint" aria-hidden="true">
            ›
          </span>
        </div>
      </header>

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
          baseSlopeDenom={defaults.slopeDenom}
          assemblyNumberById={assemblyNumberById}
          onRenumber={canEditStructure ? setAssemblyNumberOverride : () => {}}
          onClose={() => setShowBom(false)}
        />
      )}

      {/* 画面下段メニューの並び替え設定 */}
      {showMenuOrder && (
        <MenuOrderModal
          order={menuOrder}
          onChange={setMenuOrderRaw}
          onClose={() => setShowMenuOrder(false)}
        />
      )}

      {/* 図面共有(エクスポート)。フル編集権限で自分の図面から新規共有する場合と、
          制限付き権限で受け取った図面を編集後に送り返す場合の両方で使う
          （送り返す場合は現在の権限を初期選択にしておく）。 */}
      {showShareExport && (
        <ShareExportModal
          segments={segments}
          notes={notes}
          initialPermission={isImportedDrawing ? sharePermission : undefined}
          drawingName={drawingIndex.find((d) => d.id === drawingId)?.name}
          onClose={() => setShowShareExport(false)}
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
      {/* 日替わり挨拶（初回同意が済んでいる通常画面でのみ、その日1回だけ表示） */}
      {!needConsent && showDailyGreeting && (
        <DailyGreetingModal onClose={closeDailyGreeting} />
      )}
    </div>
  )
}
