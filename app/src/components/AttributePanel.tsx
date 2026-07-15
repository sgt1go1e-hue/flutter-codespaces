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
  const offsetRef = useRef<HTMLInputElement>(null)

  // 2つのエルボ(45°を含む)に挟まれた斜めのキック区間かどうか。現場では横方向の
  // 逃げ寸法(オフセット)しか測らないことが多く、芯々（斜め管の実寸）は逆算する
  // ものなので、この区間を選んだときはオフセット欄を優先して見せる・フォーカスする。
  const isKickSegment =
    cut?.startRole === 'elbow' &&
    cut?.endRole === 'elbow' &&
    (cut?.startFittingId === 'elbow45_long' || cut?.endFittingId === 'elbow45_long') &&
    (cut?.startFittingId === 'elbow45_long' || cut?.startFittingId === 'elbow90_long') &&
    (cut?.endFittingId === 'elbow45_long' || cut?.endFittingId === 'elbow90_long')

  // 別の線を選ぶたびに、キック区間ならオフセット欄へ、それ以外は芯々寸法欄へ
  // フォーカス（連続入力を最短タップに）。
  useEffect(() => {
    const target = isKickSegment ? offsetRef.current : dimRef.current
    target?.focus()
    target?.select()
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
  const visibleFittings = fittings.filter((f) => {
    if (f.id === 'none') return true
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
          {(() => {
            const dimField = (
              <label className="field dim-field" key="dim">
                <span className="field-label">
                  {isKickSegment ? '芯々寸法(自動計算, mm)' : '芯々寸法(mm)'}
                </span>
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
            )
            // 45°エルボが片側以上に入った、2つのエルボに挟まれた区間(斜めのキック管)は、
            // 現場で分かりやすい「オフセット(逃げ)寸法」から芯々寸法を逆算できる。
            // 現場では横方向の逃げ寸法しか測らず、斜め管の実寸(芯々)を直接測ることは
            // ほぼ無いため、この区間ではオフセット欄を芯々欄より前・優先で見せる。
            // 45°×2（平行→平行のローリングオフセット）でも、90°+45°（垂直⇄水平の
            // 切替時、片方のエルボを45°ぶんずらして繋ぐ場合）でも、斜め管自体は
            // 直角二等辺三角形の斜辺になるため式は共通（トラベル=オフセット×1.4142）。
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
                      ? Math.round((segment.centerLength / Math.SQRT2) * 10) / 10
                      : ''
                  }
                  onChange={(e) => {
                    if (e.target.value === '') {
                      onChange({ centerLength: undefined })
                      return
                    }
                    const offset = Number(e.target.value)
                    if (Number.isNaN(offset)) return
                    onChange({ centerLength: Math.round(offset * Math.SQRT2 * 10) / 10 })
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
          })()}

          <div className="field cut-field">
            <span className="field-label">
              切り寸法{cut && cut.status !== 'none' && (
                <span className="field-note">{cut.mode}</span>
              )}
            </span>
            <div
              className={`cut-value${cut?.status === 'over' || cut?.threadTooShortForPipe ? ' over' : ''}${cut?.status === 'zero' ? ' zero' : ''}${cut?.socketWeldGapWarning || cut?.threadNearMinNipple ? ' tight' : ''}`}
            >
              {cut?.needsCounterpart
                ? '要相手径'
                : cut?.threadTooShortForPipe
                  ? '加工不可能（丸ニップル使用）'
                  : cut?.status === 'ok'
                    ? `${cut.cut} mm`
                    : cut?.status === 'zero'
                      ? 'パイプ0mm（継手直結）'
                      : cut?.status === 'over'
                        ? '継手が収まりません'
                        : '—'}
            </div>
          </div>

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
              {visibleFittings.map((f) => (
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

          {/* 角ニップルは個体差・材質でねじ込み量が変わり芯々を一定に算出できない
              ため、本アプリでは扱わない旨を接続方法=ねじ込み選択時に明示する。 */}
          {segment.connection === 'thread' && (
            <div className="socket-gap-warn">
              <p>
                角ニップルは個体差・材質（白ネジ/SUS等）によりねじ込み量が変わるため、本アプリでは芯々寸法の算出対象に含めていません。使用箇所は現場での実寸に基づいて調整してください。
              </p>
            </div>
          )}
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

            {/* 角ニップルは個体差・材質でねじ込み量が変わり芯々を一定に算出できない
                ため、本アプリでは扱わない旨を接続方法=ねじ込み選択時に明示する。 */}
            {defaults.connection === 'thread' && (
              <div className="socket-gap-warn">
                <p>
                  角ニップルは個体差・材質（白ネジ/SUS等）によりねじ込み量が変わるため、本アプリでは芯々寸法の算出対象に含めていません。使用箇所は現場での実寸に基づいて調整してください。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
