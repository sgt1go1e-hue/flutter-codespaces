import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Segment } from '../types'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import type { TeeContext } from '../lib/takeout'
import type { ElbowClash } from '../lib/elbowClash'
import {
  fittings,
  pipeTypes,
  sizesForPipeType,
  getSizeInfo,
  getPipeType,
  getFitting,
  getConnectionMethod,
  connectionMethods,
} from '../data/masters'
import { isSlopeEligible, effectiveSlopeDenom, SLOPE_DENOM_OPTIONS } from '../lib/slope'
import {
  initialCalcState,
  calcStateFromValue,
  calcCurrentTotal,
  calcEvaluate,
  type CalcState,
} from '../lib/calcExpr'
import { CalcKeypad } from './CalcKeypad'
import { LINE_COLOR_PALETTE, lineColorHex } from '../data/lineColors'
import { GEN_GOU_QUALIFIER_PRESETS } from '../lib/genGou'

const round1 = (x: number) => Math.round(x * 10) / 10

interface DimCalcInputProps {
  className?: string
  placeholder?: string
  value: number | undefined
  onCommit: (value: number | undefined) => void
}

// 芯々寸法などの寸法入力欄。クイック計算(芯引き)の「全体寸法」欄と全く
// 同じテンキー(CalcKeypad、calcExpr.tsの電卓ロジックをそのまま使用)で
// 「180+20」のような式を入力できるようにする。クイック計算は専用画面に
// テンキーを常時表示するが、こちらは詳細パネルの1項目でしかないため、
// 見た目・操作感はこれまで通り「タップして入力する欄」のままにし、
// タップした時だけテンキーをポップアップ表示、入力が終わったら閉じられる
// ようにする(＝キー、閉じるボタン、または欄の外側タップで閉じる)。
const DimCalcInput = forwardRef<HTMLButtonElement, DimCalcInputProps>(function DimCalcInput(
  { className, placeholder, value, onCommit },
  ref,
) {
  const [open, setOpen] = useState(false)
  const [calc, setCalc] = useState<CalcState>(initialCalcState)

  function openKeypad() {
    setCalc(value != null ? calcStateFromValue(value) : initialCalcState)
    setOpen(true)
  }

  // ポップアップを閉じる（＝キー・閉じるボタン・外側タップの共通処理）。
  // その時点までに入力された式を確定してから閉じる。空にして閉じれば
  // 未入力に戻り、無効な式のまま閉じようとした場合は変更を反映しない
  // （直前の値を保持する。既存の切り寸法計算を壊れた値で汚さないため）。
  function commitAndClose() {
    if (!calc.error) {
      if (calc.display === '') {
        if (value != null) onCommit(undefined)
      } else {
        const total = calcCurrentTotal(calc)
        if (total != null && total !== value) onCommit(total)
      }
    }
    setOpen(false)
  }

  function pressEqual() {
    const { value: v, error } = calcEvaluate(calc)
    if (error) {
      setCalc((s) => ({ ...s, error }))
      return
    }
    if (v != null && v !== value) onCommit(v)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${className ?? ''} dim-calc-trigger`}
        onFocus={openKeypad}
        onClick={openKeypad}
      >
        {value != null ? (
          value
        ) : (
          <span className="dim-calc-placeholder">{placeholder}</span>
        )}
      </button>
      {open &&
        createPortal(
          <div className="dim-calc-backdrop" onClick={commitAndClose}>
            <div className="dim-calc-popup" onClick={(e) => e.stopPropagation()}>
              <div className="dim-calc-popup-header">
                <span className={calc.error ? 'dim-calc-error' : ''}>
                  {calc.error ?? '寸法を入力(mm)'}
                </span>
                <button type="button" className="dim-calc-close" onClick={commitAndClose}>
                  閉じる
                </button>
              </div>
              <div className="qc-overall-display">{calc.display || '0'}</div>
              <CalcKeypad onChange={setCalc} onEqual={pressEqual} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
})

export interface DrawDefaults {
  pipeType?: string
  size?: string
  connection?: string
  vpSeries?: 'dv' | 'ts'
  /** 勾配(1/N のN)のベース値。区間ごとに個別上書きが無ければこれを継承する。 */
  slopeDenom?: number
  /**
   * ルートギャップ(mm)。突き合わせ溶接(接続方法=溶接)で裏波を出すために
   * 設ける隙間。全溶接箇所に共通で適用（フランジ引きしろと同じ考え方）。
   */
  rootGap?: number
  /** 相番(合番)表示のON/OFF。未設定(auto)ならセグメント数で自動判定する。 */
  assemblyNumberMode?: 'auto' | 'on' | 'off'
  /**
   * 系統色(data/lineColors.ts のcolorId)。設定している間は、これから描く
   * 線すべてにこの色を自動で付ける(区間ごとに毎回選び直さなくてよいように)。
   * 管種・サイズ等と違い、続きの線かどうかに関わらず常に適用する
   * (接続方法・塩ビ継手タイプと同じ扱い)。
   */
  colorId?: string
}

function roleLabel(role: string): string {
  switch (role) {
    case 'free':
      return 'フリー端'
    case 'straight':
      return '直管'
    case 'elbow':
      return 'エルボ'
    case 'elbow-reducer':
      return 'エルボ＋レジューサー'
    case 'reducer':
      return 'レジューサー'
    case 'tee-run':
      return 'チーズ'
    case 'tee-run-reducer':
      return 'チーズ＋レジューサー'
    case 'tee-branch':
      return 'チーズ'
    case 'wye-run':
      return 'Y継手'
    case 'wye-run-reducer':
      return 'Y継手＋レジューサー'
    case 'wye-branch':
      return 'Y継手'
    default:
      return role
  }
}

// 45°オフセット計算: 現場の標準手法として「オフセット量×1.414」を斜め区間の
// 芯々寸法として使う。三平方の定理(√(横²+縦²)のような二辺入力)ではなく、
// 45°専用のこの係数だけを使う（過去に三平方の定理案が出たことがあるが誤り）。
const OFFSET_45_FACTOR = 1.414

// オフセット入力(45°キック)の対象になる継手id。45°側(斜めへ振る側)と、
// 90°側寄り(まっすぐ受ける側)を分けて判定する。
const isFortyFiveFitting = (id?: string) =>
  id === 'elbow45_long' ||
  id === 'elbow45_socket' ||
  id === 'elbow45_thread' ||
  id === 'elbow45_vp_dv' ||
  id === 'elbow45_vp_ts' ||
  id === 'y45_vp_dv' ||
  id === 'y45_reducing_vp_dv'
const isNinetyIshFitting = (id?: string) =>
  id === 'elbow90_short' ||
  id === 'elbow90_long' ||
  id === 'elbow90_socket' ||
  id === 'elbow90_thread' ||
  id === 'elbow90_vp_dv' ||
  id === 'elbow90_ll_vp_dv' ||
  id === 'elbow90_vp_ts' ||
  id === 'y90lt_vp_dv' ||
  id === 'y90lt_reducing_vp_dv'
// オフセット入力の対象になる区間の両端の「役割」。エルボtoエルボの従来ケースに
// 加え、45°Yの本管/枝(wye-run・wye-branch)が絡む斜め区間もここに含める。
const KICK_ROLES = new Set(['elbow', 'wye-run', 'wye-run-reducer', 'wye-branch'])

// ============================================================
// 寸法・属性パネル（線を選択したときに表示）
// ============================================================
interface SegmentPanelProps {
  segment: Segment
  effective?: Effective
  inheritedPipeType?: string
  inheritedSize?: string
  cut?: CutResult
  /** この区間がエルボtoエルボで芯々寸法不足のとき、45°×2 / 90°+45° への振り分け提案 */
  elbowClash?: ElbowClash
  onApplyElbowClash?: () => void
  /** 分岐(チーズ)ノードに接続していれば「メイン管／枝管」の構成情報 */
  teeContext?: TeeContext
  /** メイン管／枝管サイズの直接編集（対象セグメントid配列とサイズを渡す） */
  onSetTeeSize: (segmentIds: string[], size: string | undefined) => void
  /**
   * 選択中の区間がレジューサーの「メイン側」または「先端側」なら、
   * もう一方(パートナー)の区間と切り寸法。メイン側/先端側の芯々寸法を
   * 1箇所でまとめて入力できるようにするために使う。
   */
  reducerPartner?: {
    segment: Segment
    cut?: CutResult
    selectedRole: 'main' | 'tip'
  }
  /** レジューサーのメイン側/先端側の芯々寸法をまとめて更新する */
  onChangeReducerPair: (mainId: string, tipId: string, patch: { main?: number; tip?: number }) => void
  /** 配管設定(ベース)の勾配(1/N のN)。区間自身に個別上書きが無いときに使う。 */
  baseSlopeDenom?: number
  /** 切り寸法の丸め方（全体設定・既定=四捨五入） */
  roundMode: 'round' | 'floor'
  onRoundModeChange: (mode: 'round' | 'floor') => void
  /** フランジの引きしろ(mm)・全フランジ共通 */
  flangeAllow: number
  onFlangeAllowChange: (mm: number) => void
  /** ルートギャップ(mm)・全溶接箇所共通 */
  rootGap: number
  onRootGapChange: (mm: number) => void
  /** パッキン(ガスケット)を加味するか・厚み(mm) */
  gasketOn: boolean
  gasketMm: number
  onGasketChange: (on: boolean, mm: number) => void
  /** 相番(合番)表示が有効か（セグメント数による自動判定 or 手動ON/OFF） */
  assemblyNumberActive?: boolean
  /** この区間の実効相番（自動採番 or 手動上書き済みの値）。芯々未入力なら undefined。 */
  assemblyNumber?: number
  /**
   * 配管ライン色分け(系統)。この図面で有効な色↔系統名の対応表(フォルダの
   * 既定または図面側の上書き。App側で解決済みの値をそのまま渡す)。
   */
  colorLabels: Record<string, string>
  /** 系統名を1色ぶんだけ変更する（色選択の近くの小さい入力欄用）。 */
  onChangeColorLabel: (colorId: string, label: string) => void
  /** 全色まとめて編集する画面を開く。 */
  onOpenColorLabels: () => void
  onChange: (patch: Partial<Segment>) => void
  onDelete: () => void
  /** パネルを閉じる（選択解除）。常に押しやすい固定位置のボタンとして用意。 */
  onClose: () => void
  /**
   * 図面共有機能で「寸法のみ編集可」で開いているときは false。継手・管種・
   * サイズ・接続方法・フランジ・相番など、芯々/芯先の寸法値以外の全項目を
   * 編集不可にする（削除・自動採番の上書き・エルボ振り分け提案の適用も含む）。
   * 芯々寸法・オフセット寸法・レジューサーのメイン側/先端側寸法の入力欄
   * だけは、この値によらず常に編集可能。
   */
  canEditStructure?: boolean
}

export function SegmentPanel({
  segment,
  effective,
  inheritedPipeType,
  inheritedSize,
  cut,
  elbowClash,
  onApplyElbowClash,
  teeContext,
  onSetTeeSize,
  reducerPartner,
  onChangeReducerPair,
  baseSlopeDenom,
  roundMode,
  onRoundModeChange,
  flangeAllow,
  onFlangeAllowChange,
  rootGap,
  onRootGapChange,
  gasketOn,
  gasketMm,
  onGasketChange,
  assemblyNumberActive,
  assemblyNumber,
  colorLabels,
  onChangeColorLabel,
  onOpenColorLabels,
  onChange,
  onDelete,
  onClose,
  canEditStructure = true,
}: SegmentPanelProps) {
  const dimRef = useRef<HTMLButtonElement>(null)
  const offsetRef = useRef<HTMLInputElement>(null)

  // 45°の継手(45°エルボ・45°Y等)に挟まれた斜めのキック区間かどうか。現場では
  // 横方向の逃げ寸法(オフセット)しか測らないことが多く、芯々（斜め管の実寸）は
  // 逆算するものなので、この区間を選んだときはオフセット欄を優先して見せる・
  // フォーカスする。少なくとも片側が45°系の継手で、両端とも45°系または
  // 90°寄りの継手(まっすぐ受ける側)であることを条件にする。
  const isKickSegment =
    !!cut?.startRole &&
    KICK_ROLES.has(cut.startRole) &&
    !!cut?.endRole &&
    KICK_ROLES.has(cut.endRole) &&
    (isFortyFiveFitting(cut?.startFittingId) || isFortyFiveFitting(cut?.endFittingId)) &&
    (isFortyFiveFitting(cut?.startFittingId) || isNinetyIshFitting(cut?.startFittingId)) &&
    (isFortyFiveFitting(cut?.endFittingId) || isNinetyIshFitting(cut?.endFittingId))

  // 別の線を選ぶたびに、キック区間ならオフセット欄へ、それ以外は芯々寸法欄へ
  // フォーカス（連続入力を最短タップに）。芯々寸法欄(DimCalcInput)は、
  // フォーカスされるとテンキーのポップアップを自動で開くようになっている
  // ため、これだけで従来の「フォーカス+全選択」と同じ「すぐ入力できる」
  // 体験になる。
  useEffect(() => {
    if (isKickSegment) {
      offsetRef.current?.focus()
      offsetRef.current?.select()
    } else {
      dimRef.current?.focus()
    }
  }, [segment.id, isKickSegment])

  const effPipe = segment.pipeType ?? inheritedPipeType
  const sizes = sizesForPipeType(effPipe)
  const od = getSizeInfo(segment.size ?? inheritedSize)?.od
  const effFittingId = effective?.fitting
  const isReducer =
    effFittingId === 'reducer_concentric' || effFittingId === 'reducer_eccentric'
  // 径違いチーズは「メイン管サイズ／枝管サイズ」欄で実サイズを直接編集するため、
  // 相手径待ちのUI(reducer-grid)はレジューサー(同心/偏心)のみに限定する。
  const needsCounterpart = isReducer

  const pipeShort = effPipe ? (getPipeType(effPipe)?.short ?? effPipe) : '—'
  const sizeText = segment.size ?? inheritedSize ?? '—'
  const fittingName = effective
    ? (getFitting(effective.fitting)?.name ?? effective.fitting)
    : '—'

  const pipeEmpty = inheritedPipeType
    ? `継承（${getPipeType(inheritedPipeType)?.short ?? inheritedPipeType}）`
    : '未設定'
  const sizeEmpty = inheritedSize ? `継承（${inheritedSize}）` : '未設定'
  const fittingEmpty = effective
    ? `自動（${getFitting(effective.fitting)?.name ?? effective.fitting}）`
    : '自動'
  // 接続方法が「差込（ソケット）」なら差込式、「ねじ込み」ならねじ込み式、それ以外は
  // 突き合わせ溶接系だけを選択肢に出す（種類が混在すると選び間違えやすいため）。
  // 塩ビ(VP)は管種で専用継手に絞り込む（接続方法は差込のみで選ばせる必要がない）。
  const visibleFittings = fittings.filter((f) => {
    if (f.id === 'none') return true
    const isVpDvFitting = f.id.endsWith('_vp_dv')
    const isVpTsFitting = f.id.endsWith('_vp_ts')
    if (effective?.pipeType === 'vp') {
      return segment.vpSeries === 'ts' ? isVpTsFitting : isVpDvFitting
    }
    if (isVpDvFitting || isVpTsFitting) return false
    const isSocketFitting = f.source?.includes('socket') ?? false
    const isThreadFitting = f.source?.includes('thread') ?? false
    if (segment.connection === 'socket') return isSocketFitting
    if (segment.connection === 'thread') return isThreadFitting
    return !isSocketFitting && !isThreadFitting
  })

  function onPipeTypeChange(pipeType: string) {
    const available = sizesForPipeType(pipeType || inheritedPipeType).map((s) => s.code)
    const patch: Partial<Segment> = { pipeType: pipeType || undefined }
    if (segment.size && !available.includes(segment.size)) patch.size = undefined
    onChange(patch)
  }

  // 管種・サイズは「分岐や口径変更があるときだけ重要」なため、継承のまま(既定)は
  // 控えめに、この区間で個別に上書きしているときだけ強調表示する。既存の
  // pipeEmpty/sizeEmpty と同じ segment.pipeType/segment.size の判定を流用するのみで、
  // 新しい継承ロジックは追加しない。
  const pipeSizeOverridden = segment.pipeType != null || segment.size != null

  return (
    <section className="attr-panel open">
      <div className="panel-header static">
        <span className="panel-summary">
          <b>{pipeShort}</b>
          <b>{sizeText}</b>
          <span className="sum-fit">{fittingName}</span>
        </span>
        {canEditStructure && (
          <span className="panel-delete" role="button" onClick={onDelete}>
            削除
          </span>
        )}
        {/* 常に押しやすい固定位置のクローズボタン（キーボード表示中もここは隠れない） */}
        <button type="button" className="panel-close" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="panel-body">
        {/* 相番(合番)。相番表示が有効(自動判定 or 手動ON)かつ芯々寸法入力済みの
            区間だけ表示する。既定値は配管の接続順で自動採番された番号。ここで
            数値を変えると、その値が優先され(手動上書き)、自動採番のやり直しでも
            上書きされなくなる。空にすると自動採番へ戻る。 */}
        {assemblyNumberActive && cut && cut.status !== 'none' && canEditStructure && (
          <div className="assembly-number-row">
            <span className="field-label">相番</span>
            <input
              className="num-input"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={segment.assemblyNumberOverride ?? assemblyNumber ?? ''}
              onChange={(e) => {
                const v = e.target.value
                onChange({
                  assemblyNumberOverride:
                    v === '' ? undefined : Math.max(1, Math.round(Number(v))),
                })
              }}
            />
            {segment.assemblyNumberOverride != null && (
              <button
                type="button"
                className="assembly-number-reset"
                onClick={() => onChange({ assemblyNumberOverride: undefined })}
              >
                自動採番に戻す
              </button>
            )}
          </div>
        )}
        {/* ① 継手・分岐タイプ選択（最重要・スクロール不要で見える最上部） */}
        <fieldset className="panel-grid" disabled={!canEditStructure}>
          <label className="field">
            <span className="field-label">継手</span>
            <select
              value={segment.fitting ?? ''}
              onChange={(e) => onChange({ fitting: e.target.value || undefined })}
            >
              <option value="">{fittingEmpty}</option>
              {visibleFittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          {/* 分岐(チーズ)接続時: もう一方(メイン管 or 枝管)のサイズもここで直接編集できる。
              「サイズ」と「相手径」のような曖昧な関係をやめ、メイン管/枝管という
              実務の呼び方で対になるサイズを直接編集する方式にした。 */}
          {teeContext && (
            <label className="field">
              <span className="field-label">
                {teeContext.selectedIsMain ? '枝管サイズ' : 'メイン管サイズ'}
              </span>
              <select
                value={
                  (teeContext.selectedIsMain
                    ? teeContext.branchSize
                    : teeContext.mainSize) ?? ''
                }
                onChange={(e) => {
                  const ids = teeContext.selectedIsMain
                    ? teeContext.branchSegId
                      ? [teeContext.branchSegId]
                      : []
                    : teeContext.mainSegIds
                  onSetTeeSize(ids, e.target.value || undefined)
                }}
              >
                <option value="">未設定</option>
                {sizes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Y継手(45°Y・90°大曲りY)分岐の本管側: 枝の直後(near)/手前(far)で
              控え寸法が大きく異なり、幾何学的に自動判定できないため明示選択させる。
              反対側の本管区間で既に選んでいれば、そちらの逆を自動で採用する
              （両側どちらから選んでもよい。takeout.ts側のロジックと対応）。 */}
          {(cut?.startRole === 'wye-run' ||
            cut?.startRole === 'wye-run-reducer' ||
            cut?.endRole === 'wye-run' ||
            cut?.endRole === 'wye-run-reducer') && (
            <label className="field">
              <span className="field-label">Y継手 本管の位置</span>
              <select
                value={segment.wyeRole ?? ''}
                onChange={(e) =>
                  onChange({
                    wyeRole: (e.target.value || undefined) as 'near' | 'far' | undefined,
                  })
                }
              >
                <option value="">未選択</option>
                <option value="near">枝の直後（下流側）</option>
                <option value="far">枝の手前（上流側）</option>
              </select>
            </label>
          )}
        </fieldset>

        {cut?.needsWyeRole && (
          <div className="socket-gap-warn">
            <p>
              Y継手（45°Y・90°大曲りY）の本管側で、枝の直後／手前のどちらかを選択してください。未選択のままだと控え寸法が0として計算されます。
            </p>
          </div>
        )}

        {/* レジューサー / 径違いチーズ: 相手径・合わせ面 */}
        {needsCounterpart && (
          <fieldset className="panel-grid reducer-grid" disabled={!canEditStructure}>
            <label className="field">
              <span className="field-label">
                相手径
                <span className="field-note">隣接から自動判定</span>
              </span>
              <select
                value={segment.reducerSize ?? ''}
                onChange={(e) => onChange({ reducerSize: e.target.value || undefined })}
              >
                <option value="">
                  {cut?.autoCounterpart ? `自動（${cut.autoCounterpart}）` : '— 選択 —'}
                </option>
                {sizes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {effFittingId === 'reducer_eccentric' && (
              <label className="field">
                <span className="field-label">合わせ面（必須）</span>
                <select
                  value={segment.reducerAlign ?? ''}
                  onChange={(e) =>
                    onChange({
                      reducerAlign: (e.target.value || undefined) as
                        | 'top'
                        | 'bottom'
                        | undefined,
                    })
                  }
                >
                  <option value="">— 選択 —</option>
                  <option value="top">上面合わせ（TOP）</option>
                  <option value="bottom">下面合わせ（BOTTOM）</option>
                </select>
              </label>
            )}
          </fieldset>
        )}

        {/* レジューサーの面間寸法(H)がマスタ(reducerLengths.ts)に無い組み合わせのとき、
            0にフォールバックさせず手入力を促す。入力するとその値がHとして使われ、
            以後この区間の切り寸法計算に反映される。 */}
        {cut?.needsReducerLength && (
          <div className="field round-field">
            <div className="socket-gap-warn">
              <p>
                このサイズ組み合わせのレジューサー面間寸法(H)がマスタにありません。面間寸法を入力してください。
              </p>
            </div>
            <label className="field">
              <span className="field-label">面間寸法 H(mm) 手入力</span>
              <input
                className="num-input"
                type="number"
                inputMode="decimal"
                placeholder="例: 101.6"
                disabled={!canEditStructure}
                value={segment.reducerLengthOverride ?? ''}
                onChange={(e) =>
                  onChange({
                    reducerLengthOverride:
                      e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        )}

        {/* 偏心レジューサーの芯ズレ表示 */}
        {cut?.eccentric && !cut.needsCounterpart && (
          <div className="ecc-box">
            {cut.eccentric.alignNeeded ? (
              <p className="cut-warn">合わせ面（上面／下面）を選択してください。</p>
            ) : cut.eccentric.offset != null ? (
              <>
                <div className="ecc-line">
                  芯ズレ: <b>{cut.eccentric.offset} mm</b>（
                  {cut.eccentric.align === 'top' ? '上面合わせ' : '下面合わせ'}）
                </div>
                <p className="ecc-note">
                  レジューサー基準面から {cut.eccentric.offset}mm{' '}
                  {cut.eccentric.align === 'top' ? '下' : '上'}に芯がズレています（
                  {cut.eccentric.large}→{cut.eccentric.small}）。下流の立上り／立下り
                  高さ確認の参考にしてください（図の見た目は変わりません）。
                </p>
              </>
            ) : null}
          </div>
        )}

        {/* ② 寸法入力 */}
        <div className="panel-grid">
          {reducerPartner ? (
            (() => {
              // レジューサー区間は「メイン側」(継手〜レジューサー太い方)と
              // 「先端側」(レジューサー細い方〜先)の2つの寸法に分けて入力する。
              // どちらを選んでも(メイン/先端どちらの区間を選択していても)同じ
              // 組で1箇所にまとめて表示し、片方だけ入力すればもう一方は
              // 自動算出値をプレースホルダーで示す(値は書き換えない)。
              const isSelectedMain = reducerPartner.selectedRole === 'main'
              const mainSeg = isSelectedMain ? segment : reducerPartner.segment
              const tipSeg = isSelectedMain ? reducerPartner.segment : segment
              const mainCut = isSelectedMain ? cut : reducerPartner.cut
              const tipCut = isSelectedMain ? reducerPartner.cut : cut
              return (
                <>
                  <label className="field dim-field">
                    <span className="field-label">
                      メイン側寸法(mm)
                      <span className="field-note">継手〜レジューサー太い方</span>
                    </span>
                    <DimCalcInput
                      className="num-input"
                      placeholder={
                        mainCut?.derivedCenter != null
                          ? `自動算出 ${mainCut.derivedCenter}`
                          : '例: 800'
                      }
                      value={mainSeg.centerLength}
                      onCommit={(v) => onChangeReducerPair(mainSeg.id, tipSeg.id, { main: v })}
                    />
                  </label>
                  <label className="field dim-field">
                    <span className="field-label">
                      先端側寸法(mm)
                      <span className="field-note">レジューサー細い方〜先</span>
                    </span>
                    <DimCalcInput
                      className="num-input"
                      placeholder={
                        tipCut?.derivedCenter != null
                          ? `自動算出 ${tipCut.derivedCenter}`
                          : '例: 300'
                      }
                      value={tipSeg.centerLength}
                      onCommit={(v) => onChangeReducerPair(mainSeg.id, tipSeg.id, { tip: v })}
                    />
                  </label>
                  {(mainCut?.needsReducerSpanInput || tipCut?.needsReducerSpanInput) && (
                    <div className="socket-gap-warn">
                      <p>メイン側か先端側のどちらかの寸法を入力してください。</p>
                    </div>
                  )}
                </>
              )
            })()
          ) : (
            (() => {
            const dimField = (
              <label className="field dim-field" key="dim">
                <span className="field-label">
                  {isKickSegment ? '芯々寸法(自動計算, mm)' : '芯々寸法(mm)'}
                </span>
                <DimCalcInput
                  ref={dimRef}
                  className="num-input"
                  placeholder="例: 1200"
                  value={segment.centerLength}
                  onCommit={(v) => onChange({ centerLength: v })}
                />
              </label>
            )
            // 45°エルボが片側以上に入った、2つのエルボに挟まれた区間(斜めのキック管)は、
            // 現場で分かりやすい「オフセット(逃げ)寸法」から芯々寸法を逆算できる。
            // 現場では横方向の逃げ寸法しか測らず、斜め管の実寸(芯々)を直接測ることは
            // ほぼ無いため、この区間ではオフセット欄を芯々欄より前・優先で見せる。
            // 45°×2（平行→平行のローリングオフセット）でも、90°+45°（垂直⇄水平の
            // 切替時、片方を45°ぶんずらして繋ぐ場合）でも、45°Yの分岐脚を使う
            // 場合でも、現場のオフセット計算は共通（斜め区間の芯々寸法＝
            // オフセット量×1.414。三平方の定理(二辺入力)は使わない）。
            const offsetField = isKickSegment && (
              <label className="field offset-field" key="offset">
                <span className="field-label">
                  逃げ寸法(現場実測はこちら, mm)
                </span>
                <input
                  ref={offsetRef}
                  className="num-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="例: 200"
                  value={
                    segment.centerLength != null
                      ? Math.round((segment.centerLength / OFFSET_45_FACTOR) * 10) / 10
                      : ''
                  }
                  onChange={(e) => {
                    if (e.target.value === '') {
                      onChange({ centerLength: undefined })
                      return
                    }
                    const offset = Number(e.target.value)
                    if (Number.isNaN(offset)) return
                    onChange({ centerLength: Math.round(offset * OFFSET_45_FACTOR * 10) / 10 })
                  }}
                />
              </label>
            )
            return isKickSegment ? (
              <>
                {offsetField}
                {dimField}
              </>
            ) : (
              dimField
            )
            })()
          )}

          <div className="field cut-field">
            <span className="field-label">
              切り寸法{cut && cut.status !== 'none' && (
                <span className="field-note">{cut.mode}</span>
              )}
            </span>
            <div
              className={`cut-value${cut?.status === 'over' || cut?.threadTooShortForPipe || cut?.vpTsTooShortForPipe ? ' over' : ''}${cut?.status === 'zero' ? ' zero' : ''}${cut?.socketWeldGapWarning || cut?.threadNearMinNipple ? ' tight' : ''}`}
            >
              {cut?.needsCounterpart
                ? '要相手径'
                : cut?.threadTooShortForPipe
                  ? '加工不可能（丸ニップル使用）'
                  : cut?.vpTsTooShortForPipe
                    ? '加工不可能（差込み代不足）'
                    : cut?.status === 'ok'
                      ? `${cut.cut} mm`
                      : cut?.status === 'zero'
                        ? cut.reducerH != null
                          ? `レジューサー H=${cut.reducerH}mm（継手直結）`
                          : 'パイプ0mm（継手直結）'
                        : cut?.status === 'over'
                          ? '継手が収まりません'
                          : '—'}
            </div>
          </div>

          {/* 下流に隣接する排水勾配区間があり、その高低差が芯々寸法から差し引かれている場合の案内。 */}
          {!!cut?.slopeAdjust && (
            <div className="socket-gap-warn">
              <p>
                下流の勾配区間で生じる高低差ぶん、切り寸法を{cut.slopeAdjust}mm短くしています。
              </p>
            </div>
          )}

          {/* 差込（ソケット）溶接同士を直結していて、継手のツラ（差込み口の開口面）
              同士の隙間が目安未満のときの警告。突き合わせ溶接と違い、ソケット部の
              隅肉溶接同士が近すぎると溶接ビードが干渉し施工できないため。 */}
          {cut?.socketWeldGapWarning && (
            <div className="socket-gap-warn">
              <p>
                差込（ソケット）溶接の継手同士が近いようです（継手のツラ〜ツラ 約
                {cut.socketWeldFaceGap}mm）。
                溶接代の一般的な目安は50mm以上です（現場慣習に基づく参考値・推奨です）。
              </p>
            </div>
          )}

          {/* ねじ込み継手同士の間の切り寸法が、メーカーの最短ニップル(丸ニップル)寸法を
              下回っている（加工不可能）、または近い（丸ニップル使用を推奨）場合の案内。 */}
          {cut?.threadTooShortForPipe && (
            <div className="socket-gap-warn">
              <p>
                この長さ（{cut.cut}mm）は現場でねじ切り加工できません。最短の丸ニップル（
                {cut.threadMinNippleLength}mm）を使用してください。
              </p>
            </div>
          )}
          {!cut?.threadTooShortForPipe && cut?.threadNearMinNipple && (
            <div className="socket-gap-warn">
              <p>
                切り寸法が最短の丸ニップル寸法（{cut.threadMinNippleLength}mm）に近いようです。
                現物合わせで加工するより、最短の丸ニップルを使う方が確実です。
              </p>
            </div>
          )}

          {/* 塩ビ(VP)TS継手のエルボ同士を直結する区間で、切り寸法が両端の差込み深さの
              合計（＝直結できる最短の直管長）を下回っている場合の警告。差込接着は
              ねじ込みと違い突き合わせができないため、両ソケットに届く長さが必須。 */}
          {cut?.vpTsTooShortForPipe && (
            <div className="socket-gap-warn">
              <p>
                この長さ（{cut.cut}mm）では両側のソケットに届かず施工できません。最短の直管長は
                {cut.vpTsMinPipeLength}mmです。
              </p>
            </div>
          )}

          {/* エルボtoエルボの間隔不足の提案は、切り寸法のすぐ下（目に入りやすい位置）に出す。 */}
          {cut?.status === 'over' && elbowClash && onApplyElbowClash && canEditStructure && (
            <div className="elbow-clash-suggest">
              <p>
                {elbowClash.suggestion === 'double45'
                  ? 'エルボtoエルボの間隔が狭いようです。前後を45°エルボ×2に振り分けると芯々を短縮できます。'
                  : 'エルボtoエルボの間隔が狭いようです。前後を90°＋45°エルボに振り分けると芯々を短縮できます。'}
              </p>
              <button type="button" className="elbow-clash-apply" onClick={onApplyElbowClash}>
                {elbowClash.suggestion === 'double45' ? '45°エルボ×2に変更' : '90°＋45°エルボに変更'}
              </button>
            </div>
          )}
        </div>

        {cut?.status === 'over' && (
          <p className="cut-warn danger">
            継手が収まりません（芯々寸法が不足）。芯々寸法を大きくするか継手を見直してください。
          </p>
        )}
        {cut?.status === 'zero' && (
          <p className="cut-hint">
            パイプ長さ0mm（継手同士が直結）。BOM のパイプ材にはカウントされません。
          </p>
        )}
        {cut?.needsCounterpart && (
          <p className="cut-warn">相手径を選択すると加工寸法を計算します。</p>
        )}

        {/* ④ 接続方法 */}
        <fieldset className="panel-grid" disabled={!canEditStructure}>
          <label className="field">
            <span className="field-label">接続方法</span>
            <select
              value={segment.connection ?? ''}
              onChange={(e) => onChange({ connection: e.target.value || undefined })}
            >
              <option value="">未設定</option>
              {connectionMethods.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* SGP管またはVP+DV継手の排水・ドレン配管のみ: 勾配(1/N)を設定できる。
              管種・サイズと同じ継承パターン: 個別に選ばなければ配管設定(ベース)の
              値を継承する(「継承（1/100）」のように表示)。縦区間(90°/270°)自体は
              勾配を持たない（設定は水平寄りの区間側で行い、その高低差は自動で
              上流の縦区間の寸法から差し引かれる）。接続方法に準じる施工設定として
              ここに置く。 */}
          {isSlopeEligible(effective?.pipeType, segment.vpSeries ?? effective?.vpSeries) &&
            segment.angle !== 90 &&
            segment.angle !== 270 && (
              <>
                <label className="field round-field">
                  <span className="field-label">
                    勾配
                    <span className="field-note">横引き管は必ず設定してください</span>
                  </span>
                  <select
                    value={segment.slopeDenom ?? ''}
                    onChange={(e) =>
                      onChange({
                        slopeDenom: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">
                      {baseSlopeDenom ? `継承（1/${baseSlopeDenom}）` : 'なし'}
                    </option>
                    {SLOPE_DENOM_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        1/{d}
                      </option>
                    ))}
                  </select>
                </label>
                {effectiveSlopeDenom(segment, baseSlopeDenom) == null && (
                  <div className="field round-field">
                    <div className="socket-gap-warn">
                      <p>
                        排水・ドレン配管の横引き管には勾配が必須です。勾配が未設定のままです。
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
        </fieldset>

        {/* 角ニップルは個体差・材質でねじ込み量が変わり芯々を一定に算出できない
            ため、本アプリでは扱わない旨を接続方法=ねじ込み選択時に明示する。 */}
        {segment.connection === 'thread' && (
          <div className="socket-gap-warn">
            <p>
              角ニップルは個体差・材質（白ネジ/SUS等）によりねじ込み量が変わるため、本アプリでは芯々寸法の算出対象に含めていません。使用箇所は現場での実寸に基づいて調整してください。
            </p>
          </div>
        )}

        {/* ⑤ 控え寸法の内訳 */}
        {cut && !cut.needsCounterpart && (
          <div className="end-breakdown">
            <div className="end-row">
              <span>始点側（{roleLabel(cut.startRole)}）</span>
              <span>
                {cut.startAllow - cut.startRootGap > 0
                  ? `− ${round1(cut.startAllow - cut.startRootGap)} mm`
                  : cut.startConnected
                    ? '差引なし'
                    : '芯出し基準'}
              </span>
            </div>
            {cut.startRootGap > 0 && (
              <div className="end-row">
                <span>始点側（ルートギャップ）</span>
                <span>− {cut.startRootGap} mm</span>
              </div>
            )}
            <div className="end-row">
              <span>終点側（{roleLabel(cut.endRole)}）</span>
              <span>
                {cut.endAllow - cut.endRootGap > 0
                  ? `− ${round1(cut.endAllow - cut.endRootGap)} mm`
                  : cut.endConnected
                    ? '差引なし'
                    : '芯出し基準'}
              </span>
            </div>
            {cut.endRootGap > 0 && (
              <div className="end-row">
                <span>終点側（ルートギャップ）</span>
                <span>− {cut.endRootGap} mm</span>
              </div>
            )}
          </div>
        )}

        {/* ⑥ 管種・サイズ。分岐や口径変更があるときだけ重要なため、継承のままなら
            控えめに、この区間で個別に上書きしているときだけ枠色とバッジで強調する。 */}
        <fieldset
          className={`panel-grid pipe-size-group${pipeSizeOverridden ? ' overridden' : ''}`}
          disabled={!canEditStructure}
        >
          {pipeSizeOverridden && <span className="pipe-size-badge">個別変更あり</span>}
          <label className="field">
            <span className="field-label">管種</span>
            <select value={segment.pipeType ?? ''} onChange={(e) => onPipeTypeChange(e.target.value)}>
              <option value="">{pipeEmpty}</option>
              {pipeTypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              {teeContext ? (teeContext.selectedIsMain ? 'メイン管サイズ' : '枝管サイズ') : 'サイズ'}
              {od != null && <span className="field-note">⌀{od}</span>}
            </span>
            <select
              value={segment.size ?? ''}
              onChange={(e) => onChange({ size: e.target.value || undefined })}
            >
              <option value="">{sizeEmpty}</option>
              {sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {/* 塩ビ(VP)のみ: DV継手(排水・勾配考慮が必要)/TS継手(給水)で継手寸法が
              異なるため、どちらのシリーズかを選ぶ。接続方法は差込のみで固定。 */}
          {effective?.pipeType === 'vp' && (
            <label className="field">
              <span className="field-label">継手タイプ</span>
              <select
                value={segment.vpSeries ?? ''}
                onChange={(e) =>
                  onChange({ vpSeries: (e.target.value || undefined) as 'dv' | 'ts' | undefined })
                }
              >
                <option value="">未設定（自動でDV継手）</option>
                <option value="dv">DV継手（排水）</option>
                <option value="ts">TS継手（給水）</option>
              </select>
            </label>
          )}
        </fieldset>

        {/* 系統色: 配管の系統(給水・排水など)を色で見分けるための表示専用の
            色分け。色自体に系統の意味は決め打ちせず、系統名(ラベル)は
            ユーザーがこのフォルダ/図面向けに自由に設定する(colorLabels、
            App側でフォルダの既定＋この図面の上書きを解決して渡している)。
            切り寸法・BOM等の計算結果には一切関与しない。 */}
        <fieldset className="panel-grid" disabled={!canEditStructure}>
          <div className="field round-field">
            <span className="field-label">
              系統色
              <span className="field-note">表示のみ・任意</span>
            </span>
            <div className="color-swatch-row">
              <button
                type="button"
                className={`color-swatch color-swatch-none${!segment.colorId ? ' selected' : ''}`}
                onClick={() => onChange({ colorId: undefined })}
                aria-label="色なし"
                title="色なし"
              >
                なし
              </button>
              {LINE_COLOR_PALETTE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`color-swatch${segment.colorId === c.id ? ' selected' : ''}`}
                  style={{ background: c.hex }}
                  onClick={() => onChange({ colorId: c.id })}
                  aria-label={colorLabels[c.id] || '系統名未設定'}
                  title={colorLabels[c.id] || undefined}
                />
              ))}
              <button type="button" className="color-edit-all" onClick={onOpenColorLabels}>
                系統名をまとめて編集
              </button>
            </div>
            {segment.colorId && (
              <label className="field color-label-field">
                <span className="field-label">系統名</span>
                <input
                  type="text"
                  className="num-input"
                  placeholder="例: 給水（空欄可）"
                  value={colorLabels[segment.colorId] ?? ''}
                  onChange={(e) => onChangeColorLabel(segment.colorId!, e.target.value)}
                />
              </label>
            )}
          </div>
        </fieldset>

        {/* ⑦ パーツ（フランジ・レジューサー等） */}
        {/* ルートギャップ（接続方法が溶接のときだけ表示・全溶接箇所共通）。
            突き合わせ溶接で裏波を出すために設ける隙間分、切り寸法から追加で控除する。 */}
        {segment.connection === 'weld' && (
          <fieldset className="panel-grid" disabled={!canEditStructure}>
            <label className="field round-field">
              <span className="field-label">
                ルートギャップ(mm)
                <span className="field-note">全溶接箇所共通</span>
              </span>
              <input
                className="num-input"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="例: 0"
                value={rootGap || ''}
                onChange={(e) =>
                  onRootGapChange(e.target.value === '' ? 0 : Number(e.target.value))
                }
              />
            </label>
          </fieldset>
        )}

        {/* フランジ引きしろ（フランジが付いた端があるときだけ表示・全フランジ共通）。
            溶接フランジ等は引きしろが任意のため手入力する。 */}
        {(segment.startFlange || segment.endFlange) && (
          <fieldset className="panel-grid" disabled={!canEditStructure}>
            <label className="field round-field">
              <span className="field-label">
                フランジ引きしろ(mm)
                <span className="field-note">全フランジ共通</span>
              </span>
              <input
                className="num-input"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="例: 0"
                value={flangeAllow || ''}
                onChange={(e) =>
                  onFlangeAllowChange(
                    e.target.value === '' ? 0 : Number(e.target.value),
                  )
                }
              />
            </label>

            {/* パッキン(ガスケット)。フランジ面間に必ず入る。加味する場合、厚みを切り寸から差し引く。
                片フランジ・両フランジとも同様。全フランジ共通設定。 */}
            <div className="field round-field">
              <label className="gasket-check">
                <input
                  type="checkbox"
                  checked={gasketOn}
                  onChange={(e) =>
                    onGasketChange(e.target.checked, gasketMm || 3)
                  }
                />
                <span>パッキン厚を加味する</span>
              </label>
              {gasketOn && (
                <div className="gasket-thick">
                  <span className="field-note">パッキン厚(mm)</span>
                  <select
                    className="num-input"
                    value={gasketMm || 3}
                    onChange={(e) => onGasketChange(true, Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </fieldset>
        )}

        <details className="panel-more">
          <summary>フランジ（始点 / 終点）</summary>
          <fieldset className="panel-grid" disabled={!canEditStructure}>
            <label className="field">
              <span className="field-label">始点側</span>
              <select
                value={segment.startFlange ?? ''}
                onChange={(e) =>
                  onChange({
                    startFlange: (e.target.value || undefined) as 'double' | 'single' | undefined,
                  })
                }
              >
                <option value="">なし</option>
                <option value="double">両フランジ</option>
                <option value="single">片フランジ</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">終点側</span>
              <select
                value={segment.endFlange ?? ''}
                onChange={(e) =>
                  onChange({
                    endFlange: (e.target.value || undefined) as 'double' | 'single' | undefined,
                  })
                }
              >
                <option value="">なし</option>
                <option value="double">両フランジ</option>
                <option value="single">片フランジ</option>
              </select>
            </label>
          </fieldset>
        </details>

        {/* 現熔マーク(現場溶接マーク): 配管ライン上の1箇所に、工場加工の
            分割点(ここから先は現場で溶接して繋ぐ)を示す三角マークを置く。
            配置自体はパーツパレットの「現熔マーク」チップ(選択→タップ、
            またはドラッグ)で行う。ここではキャンバス上に既に置いてある
            マークの向き・位置の調整のみを行う(未配置の区間には何も
            表示しない)。表示専用の注記で、切り寸法等の計算結果には
            一切影響しない。 */}
        {segment.fieldWeldMark && (
          <fieldset className="panel-grid" disabled={!canEditStructure}>
            <div className="field round-field">
              <span className="field-label">
                現熔マーク
                <span className="field-note">工場加工の分割点（表示のみ・キャンバス上でドラッグして移動可）</span>
              </span>
              {(() => {
                const mark = segment.fieldWeldMark!
                return (
                  <div className="round-toggle">
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ fieldWeldMark: { ...mark, flipped: !mark.flipped } })
                      }
                    >
                      向きを反転
                    </button>
                    {(mark.offsetX != null || mark.offsetY != null) && (
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            fieldWeldMark: { t: mark.t, flipped: mark.flipped },
                          })
                        }
                      >
                        位置をリセット
                      </button>
                    )}
                    <button type="button" onClick={() => onChange({ fieldWeldMark: undefined })}>
                      削除
                    </button>
                  </div>
                )
              })()}
            </div>
          </fieldset>
        )}

        {/* 現場合わせ区間: 現場で寸法を合わせるため、あえて長めに(遊びを
            持たせて)加工している区間であることを示す。ONにすると区間全体
            を二重線で表示し、両端に向き変更可能な三角マークを置く。
            始点側・終点側それぞれの向きは個別に手動で選ぶ(自動判定しない)。
            表示専用のフラグで、切り寸法等の計算結果には一切影響しない。 */}
        <fieldset className="panel-grid" disabled={!canEditStructure}>
          <div className="field round-field">
            <label className="gasket-check">
              <input
                type="checkbox"
                checked={segment.fieldFitAllowance ?? false}
                onChange={(e) => onChange({ fieldFitAllowance: e.target.checked })}
              />
              <span>現場合わせ区間（遊びを持たせて加工）</span>
            </label>
            {segment.fieldFitAllowance && (
              <div className="round-toggle">
                <button
                  type="button"
                  onClick={() =>
                    onChange({ fieldFitStartFlipped: !segment.fieldFitStartFlipped })
                  }
                >
                  始点側の向きを反転
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ fieldFitEndFlipped: !segment.fieldFitEndFlipped })
                  }
                >
                  終点側の向きを反転
                </button>
              </div>
            )}
          </div>
        </fieldset>

        {/* 現合(現物合わせ): 工場出荷時点では寸法が確定せず、現場で実測
            しながら切って合わせる区間であることを示す注記。ONにすると、
            キャンバス上の寸法表示が通常の芯々/切り寸法の2段表記の代わりに
            概算寸法・修飾語を使った1行の注記表示に切り替わる(確定寸法と
            誤読されないようにするため)。上の「現場合わせ区間」(二重線+
            三角マーク)とは独立した項目で、併用できる。あくまで表示専用の
            注記で、切り寸法・BOM等の計算結果には一切影響しない。 */}
        <fieldset className="panel-grid" disabled={!canEditStructure}>
          <div className="field round-field">
            <label className="gasket-check">
              <input
                type="checkbox"
                checked={segment.isGenGou ?? false}
                onChange={(e) => onChange({ isGenGou: e.target.checked })}
              />
              <span>現合（現場で実測して合わせる）</span>
            </label>
            {segment.isGenGou && (
              <div className="gengou-fields">
                <label className="field">
                  <span className="field-label">
                    概算寸法(mm)
                    <span className="field-note">任意・自動計算なし</span>
                  </span>
                  <input
                    className="num-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="例: 1200"
                    value={segment.genGouDimension ?? ''}
                    onChange={(e) =>
                      onChange({
                        genGouDimension: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    修飾語
                    <span className="field-note">プリセットまたは自由入力</span>
                  </span>
                  <div className="round-toggle">
                    {GEN_GOU_QUALIFIER_PRESETS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={segment.genGouQualifier === q ? 'active' : ''}
                        onClick={() => onChange({ genGouQualifier: q })}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <input
                    className="num-input"
                    type="text"
                    placeholder="自由入力も可（未入力なら「現場合わせ」）"
                    value={segment.genGouQualifier ?? ''}
                    onChange={(e) => onChange({ genGouQualifier: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">補足メモ</span>
                  <input
                    className="num-input"
                    type="text"
                    placeholder="例: スラブ面から実測"
                    value={segment.genGouNote ?? ''}
                    onChange={(e) => onChange({ genGouNote: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        </fieldset>

        {/* ⑧ 切り寸法の丸め（最下部・スクロールしないと見えない位置） */}
        <fieldset className="panel-grid" disabled={!canEditStructure}>
          <div className="field round-field">
            <span className="field-label">切り寸法の丸め</span>
            <div className="round-toggle">
              <button
                type="button"
                className={roundMode === 'round' ? 'active' : ''}
                onClick={() => onRoundModeChange('round')}
              >
                四捨五入
              </button>
              <button
                type="button"
                className={roundMode === 'floor' ? 'active' : ''}
                onClick={() => onRoundModeChange('floor')}
              >
                切り捨て
              </button>
            </div>
          </div>
        </fieldset>
      </div>
    </section>
  )
}

// ============================================================
// 作図設定バー（独立して開閉。これから描く線の初期値）
// ============================================================
interface DrawSettingsPanelProps {
  defaults: DrawDefaults
  onChange: (patch: Partial<DrawDefaults>) => void
  open: boolean
  onToggle: () => void
  /** 現在の図面の総セグメント数（相番表示の自動判定の目安表示に使う） */
  segmentCount: number
  /** 画面下段メニューの並び替え設定を開く */
  onOpenMenuOrder: () => void
  /** 図面共有機能でフル編集以外の権限のとき true。作図設定の変更を封じる。 */
  disabled?: boolean
  /** 系統色のラベル表示用(この図面で有効な対応表)。スウォッチのtitle/aria-labelに使う。 */
  colorLabels?: Record<string, string>
}

export function DrawSettingsPanel({
  defaults,
  onChange,
  open,
  onToggle,
  segmentCount,
  onOpenMenuOrder,
  disabled = false,
  colorLabels,
}: DrawSettingsPanelProps) {
  const sizes = sizesForPipeType(defaults.pipeType)
  const od = getSizeInfo(defaults.size)?.od
  const pipeShort = defaults.pipeType
    ? (getPipeType(defaults.pipeType)?.short ?? defaults.pipeType)
    : '未設定'
  const connectionName = getConnectionMethod(defaults.connection)?.name

  return (
    <section className={`attr-panel settings${open ? ' open' : ''}`}>
      <button className="panel-header" onClick={onToggle}>
        <span className="panel-caret">{open ? '▼' : '▲'}</span>
        <span className="panel-summary">
          <span className="sum-mode">配管設定</span>
          <b>{pipeShort}</b>
          <b>{defaults.size ?? '未設定'}</b>
          {connectionName && <b>{connectionName}</b>}
          {defaults.slopeDenom && <b>勾配1/{defaults.slopeDenom}</b>}
          {!!defaults.rootGap && <b>RG{defaults.rootGap}mm</b>}
          {defaults.colorId && (
            <b>
              <span
                className="color-swatch-dot"
                style={{ background: lineColorHex(defaults.colorId) }}
              />
              {colorLabels?.[defaults.colorId] || '系統色'}
            </b>
          )}
        </span>
      </button>
      {open && (
        <div className="panel-body">
          {disabled ? (
            <p className="panel-hint">
              この図面は共有元の権限により、作図・配管設定を変更できません。
            </p>
          ) : (
          <>
          <p className="panel-hint">これから描く線に適用する初期値です（線の選択は不要）。</p>
          <div className="panel-grid">
            <label className="field">
              <span className="field-label">管種</span>
              <select
                value={defaults.pipeType ?? ''}
                onChange={(e) => onChange({ pipeType: e.target.value || undefined })}
              >
                <option value="">未設定</option>
                {pipeTypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">
                サイズ{od != null && <span className="field-note">⌀{od}</span>}
              </span>
              <select
                value={defaults.size ?? ''}
                onChange={(e) => onChange({ size: e.target.value || undefined })}
              >
                <option value="">未設定</option>
                {sizes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">接続方法</span>
              <select
                value={defaults.connection ?? ''}
                onChange={(e) => onChange({ connection: e.target.value || undefined })}
              >
                <option value="">未設定</option>
                {connectionMethods.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {/* 系統色: 設定している間、これから描く線すべてに自動で付く
                (区間ごとに毎回選び直さなくて済むように)。ラベル(系統名)は
                詳細パネル側と同じ対応表(colorLabels)を使う。 */}
            <div className="field round-field">
              <span className="field-label">
                系統色
                <span className="field-note">これから描く線に自動で適用</span>
              </span>
              <div className="color-swatch-row">
                <button
                  type="button"
                  className={`color-swatch color-swatch-none${!defaults.colorId ? ' selected' : ''}`}
                  onClick={() => onChange({ colorId: undefined })}
                  aria-label="色なし"
                  title="色なし"
                >
                  なし
                </button>
                {LINE_COLOR_PALETTE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`color-swatch${defaults.colorId === c.id ? ' selected' : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => onChange({ colorId: c.id })}
                    aria-label={colorLabels?.[c.id] || '系統名未設定'}
                    title={colorLabels?.[c.id] || undefined}
                  />
                ))}
              </div>
            </div>

            {/* 塩ビ(VP)のみ: DV継手(排水・勾配考慮が必要)/TS継手(給水)で継手寸法が
                異なるため、どちらのシリーズかを選ぶ。接続方法は差込のみで固定。 */}
            {defaults.pipeType === 'vp' && (
              <label className="field">
                <span className="field-label">継手タイプ</span>
                <select
                  value={defaults.vpSeries ?? ''}
                  onChange={(e) =>
                    onChange({ vpSeries: (e.target.value || undefined) as 'dv' | 'ts' | undefined })
                  }
                >
                  <option value="">未設定（自動でDV継手）</option>
                  <option value="dv">DV継手（排水）</option>
                  <option value="ts">TS継手（給水）</option>
                </select>
              </label>
            )}

            {/* 角ニップルは個体差・材質でねじ込み量が変わり芯々を一定に算出できない
                ため、本アプリでは扱わない旨を接続方法=ねじ込み選択時に明示する。 */}
            {defaults.connection === 'thread' && (
              <div className="socket-gap-warn">
                <p>
                  角ニップルは個体差・材質（白ネジ/SUS等）によりねじ込み量が変わるため、本アプリでは芯々寸法の算出対象に含めていません。使用箇所は現場での実寸に基づいて調整してください。
                </p>
              </div>
            )}

            {/* これから描く横引き管に適用する勾配のベース値。個々の区間の詳細パネルで
                個別に上書きできる（管種・サイズと同じ継承パターン）。実際に計算へ
                反映されるのはSGP管またはVP+DV継手のときだけだが、管種を切り替えても
                入力欄自体は常に表示する（SUS等でも手動で設定したいケースがあるため。
                管種を切り替えた時点でベース値自体は未設定にリセットされる＝下のonChange参照）。 */}
            <label className="field">
              <span className="field-label">勾配</span>
              <select
                value={defaults.slopeDenom ?? ''}
                onChange={(e) =>
                  onChange({
                    slopeDenom: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              >
                <option value="">未設定</option>
                {SLOPE_DENOM_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    1/{d}
                  </option>
                ))}
              </select>
            </label>

            {/* 突き合わせ溶接(接続方法=溶接)で裏波を出すために設ける隙間。
                切り寸法から溶接箇所ごとに追加で控除する（全溶接箇所共通）。
                実用上は0〜4mm程度を想定するが、上限は特に設けない。 */}
            <label className="field">
              <span className="field-label">ルートギャップ(mm)</span>
              <input
                className="num-input"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="例: 0"
                value={defaults.rootGap || ''}
                onChange={(e) =>
                  onChange({
                    rootGap: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>

            {/* 相番(合番)表示。既定(自動)はセグメント数が10本を超えたら図面上を
                番号だけの表示に切り替える。10本以下でも相番にしたい／逆に本数に
                関わらず寸法直書きのままにしたい、どちらも手動で固定できる。 */}
            <label className="field">
              <span className="field-label">相番表示</span>
              <select
                value={defaults.assemblyNumberMode ?? 'auto'}
                onChange={(e) =>
                  onChange({
                    assemblyNumberMode: e.target.value as 'auto' | 'on' | 'off',
                  })
                }
              >
                <option value="auto">
                  自動（11本以上でON・現在{segmentCount > 10 ? 'ON' : 'OFF'}）
                </option>
                <option value="on">常にON</option>
                <option value="off">常にOFF</option>
              </select>
            </label>
          </div>
          </>
          )}

          {/* 画面下段メニューの並び順を変更する設定への入り口。
              ボタン自体は独立した操作なので管種・サイズ等のグリッドとは
              分けて置く。 */}
          <button type="button" className="menu-order-open" onClick={onOpenMenuOrder}>
            メニューの並び替え
          </button>
        </div>
      )}
    </section>
  )
}
