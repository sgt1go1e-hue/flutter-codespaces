import { useEffect, useRef } from 'react'
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

export interface DrawDefaults {
  pipeType?: string
  size?: string
  connection?: string
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
    default:
      return role
  }
}

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
  /** 切り寸法の丸め方（全体設定・既定=四捨五入） */
  roundMode: 'round' | 'floor'
  onRoundModeChange: (mode: 'round' | 'floor') => void
  /** フランジの引きしろ(mm)・全フランジ共通 */
  flangeAllow: number
  onFlangeAllowChange: (mm: number) => void
  /** パッキン(ガスケット)を加味するか・厚み(mm) */
  gasketOn: boolean
  gasketMm: number
  onGasketChange: (on: boolean, mm: number) => void
  onChange: (patch: Partial<Segment>) => void
  onDelete: () => void
  /** パネルを閉じる（選択解除）。常に押しやすい固定位置のボタンとして用意。 */
  onClose: () => void
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
  roundMode,
  onRoundModeChange,
  flangeAllow,
  onFlangeAllowChange,
  gasketOn,
  gasketMm,
  onGasketChange,
  onChange,
  onDelete,
  onClose,
}: SegmentPanelProps) {
  const dimRef = useRef<HTMLInputElement>(null)

  // 別の線を選ぶたびに芯々寸法欄へフォーカス（連続入力を最短タップに）
  useEffect(() => {
    dimRef.current?.focus()
    dimRef.current?.select()
  }, [segment.id])

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

  function onPipeTypeChange(pipeType: string) {
    const available = sizesForPipeType(pipeType || inheritedPipeType).map((s) => s.code)
    const patch: Partial<Segment> = { pipeType: pipeType || undefined }
    if (segment.size && !available.includes(segment.size)) patch.size = undefined
    onChange(patch)
  }

  return (
    <section className="attr-panel open">
      <div className="panel-header static">
        <span className="panel-summary">
          <b>{pipeShort}</b>
          <b>{sizeText}</b>
          <span className="sum-fit">{fittingName}</span>
        </span>
        <span className="panel-delete" role="button" onClick={onDelete}>
          削除
        </span>
        {/* 常に押しやすい固定位置のクローズボタン（キーボード表示中もここは隠れない） */}
        <button type="button" className="panel-close" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="panel-body">
        <div className="panel-grid">
          <label className="field dim-field">
            <span className="field-label">芯々寸法(mm)</span>
            <input
              ref={dimRef}
              className="num-input"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="例: 1200"
              value={segment.centerLength ?? ''}
              onChange={(e) =>
                onChange({
                  centerLength: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          </label>

          {/* 45°エルボ×2に挟まれた区間(ローリングオフセットのトラベル管)は、
              現場で分かりやすい「オフセット(逃げ)寸法」から芯々寸法を逆算できる。
              トラベル = オフセット ÷ sin45°（= オフセット × 1.4142）。 */}
          {cut?.startRole === 'elbow' &&
            cut?.endRole === 'elbow' &&
            cut?.startFittingId === 'elbow45_long' &&
            cut?.endFittingId === 'elbow45_long' && (
              <label className="field offset-field">
                <span className="field-label">
                  オフセット寸法(逃げ, mm)
                  <span className="field-note">45°×2 芯々=オフセット×1.4142</span>
                </span>
                <input
                  className="num-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="例: 200"
                  onChange={(e) => {
                    if (e.target.value === '') return
                    const offset = Number(e.target.value)
                    if (Number.isNaN(offset)) return
                    onChange({ centerLength: Math.round(offset * Math.SQRT2 * 10) / 10 })
                  }}
                />
              </label>
            )}

          <div className="field cut-field">
            <span className="field-label">
              切り寸法{cut && cut.status !== 'none' && (
                <span className="field-note">{cut.mode}</span>
              )}
            </span>
            <div
              className={`cut-value${cut?.status === 'over' ? ' over' : ''}${cut?.status === 'zero' ? ' zero' : ''}`}
            >
              {cut?.needsCounterpart
                ? '要相手径'
                : cut?.status === 'ok'
                  ? `${cut.cut} mm`
                  : cut?.status === 'zero'
                    ? 'パイプ0mm（継手直結）'
                    : cut?.status === 'over'
                      ? '継手が収まりません'
                      : '—'}
            </div>
          </div>

          {/* エルボtoエルボの間隔不足の提案は、スクロールしないと気づけない下部の
              詳細情報より先に、寸法入力のすぐ下（目に入りやすい位置）に出す。 */}
          {cut?.status === 'over' && elbowClash && onApplyElbowClash && (
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

          {/* 切り寸法の丸め（全体設定）。継手の取り出し寸法には適用しない。 */}
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

          {/* フランジ引きしろ（フランジが付いた端があるときだけ表示・全フランジ共通）。
              溶接フランジ等は引きしろが任意のため手入力する。 */}
          {(segment.startFlange || segment.endFlange) && (
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
          )}

          {/* パッキン(ガスケット)。フランジ面間に必ず入る。加味する場合、厚みを切り寸から差し引く。
              片フランジ・両フランジとも同様。全フランジ共通設定。 */}
          {(segment.startFlange || segment.endFlange) && (
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
          )}

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

          <label className="field">
            <span className="field-label">継手</span>
            <select
              value={segment.fitting ?? ''}
              onChange={(e) => onChange({ fitting: e.target.value || undefined })}
            >
              <option value="">{fittingEmpty}</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

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
        </div>

        {/* レジューサー / 径違いチーズ: 相手径・合わせ面 */}
        {needsCounterpart && (
          <div className="panel-grid reducer-grid">
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
          </div>
        )}

        {/* 端ごとの差引/フリー端の内訳 */}
        {cut && !cut.needsCounterpart && (
          <div className="end-breakdown">
            <div className="end-row">
              <span>始点側（{roleLabel(cut.startRole)}）</span>
              <span>
                {cut.startAllow > 0
                  ? `− ${cut.startAllow} mm`
                  : cut.startConnected
                    ? '差引なし'
                    : '芯出し基準'}
              </span>
            </div>
            <div className="end-row">
              <span>終点側（{roleLabel(cut.endRole)}）</span>
              <span>
                {cut.endAllow > 0
                  ? `− ${cut.endAllow} mm`
                  : cut.endConnected
                    ? '差引なし'
                    : '芯出し基準'}
              </span>
            </div>
          </div>
        )}

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

        <details className="panel-more">
          <summary>フランジ（始点 / 終点）</summary>
          <div className="panel-grid">
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
          </div>
        </details>
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
}

export function DrawSettingsPanel({ defaults, onChange, open, onToggle }: DrawSettingsPanelProps) {
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
        </span>
      </button>
      {open && (
        <div className="panel-body">
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
          </div>
        </div>
      )}
    </section>
  )
}
