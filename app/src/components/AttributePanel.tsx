import type { Segment } from '../types'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import {
  fittings,
  pipeTypes,
  sizesForPipeType,
  getSizeInfo,
  getPipeType,
  getFitting,
  connectionMethods,
} from '../data/masters'

interface Props {
  segment: Segment | null
  effective?: Effective
  inheritedPipeType?: string
  inheritedSize?: string
  cut?: CutResult
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<Segment>) => void
  onDelete: () => void
}

// 継手プルダウンに出す選択肢（「なし(直管)」も選べる）
const fittingOptions = fittings

/**
 * 描画エリア下部に常設する属性パネル（ポップアップの置き換え）。
 * 選択中セグメントの 管種 / サイズ / 継手 / 接続方法 / 芯々寸法 をその場で編集でき、
 * 現在値を常に一覧表示する。折りたたみで描画スペースを確保できる。
 */
export function AttributePanel({
  segment,
  effective,
  inheritedPipeType,
  inheritedSize,
  cut,
  open,
  onToggle,
  onChange,
  onDelete,
}: Props) {
  const has = segment != null
  const effPipe = segment?.pipeType ?? inheritedPipeType
  const sizes = sizesForPipeType(effPipe)
  const od = getSizeInfo(segment?.size ?? inheritedSize)?.od

  // ヘッダーに出す現在値サマリ
  const pipeShort = effPipe ? (getPipeType(effPipe)?.short ?? effPipe) : '—'
  const sizeText = segment?.size ?? inheritedSize ?? '—'
  const fittingName = effective ? (getFitting(effective.fitting)?.name ?? effective.fitting) : '—'

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
    if (segment?.size && !available.includes(segment.size)) patch.size = undefined
    onChange(patch)
  }

  return (
    <section className={`attr-panel${open ? ' open' : ''}`}>
      <button className="panel-header" onClick={onToggle}>
        <span className="panel-caret">{open ? '▼' : '▲'}</span>
        <span className="panel-summary">
          {has ? (
            <>
              <b>{pipeShort}</b>
              <b>{sizeText}</b>
              <span className="sum-fit">{fittingName}</span>
            </>
          ) : (
            <span className="sum-none">線を長押しで選択</span>
          )}
        </span>
        {has && (
          <span
            className="panel-delete"
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            削除
          </span>
        )}
      </button>

      {open && (
        <div className="panel-body">
          {!has && (
            <p className="panel-hint">
              線を長押しすると選択され、ここで属性を編集できます。
            </p>
          )}
          {has && segment && (
            <>
              <div className="panel-grid">
                <label className="field">
                  <span className="field-label">管種</span>
                  <select
                    value={segment.pipeType ?? ''}
                    onChange={(e) => onPipeTypeChange(e.target.value)}
                  >
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
                    サイズ{od != null && <span className="field-note">⌀{od}</span>}
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

                <label className="field">
                  <span className="field-label">継手</span>
                  <select
                    value={segment.fitting ?? ''}
                    onChange={(e) => onChange({ fitting: e.target.value || undefined })}
                  >
                    <option value="">{fittingEmpty}</option>
                    {fittingOptions.map((f) => (
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

                <label className="field">
                  <span className="field-label">芯々寸法(mm)</span>
                  <input
                    className="num-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="例: 1200"
                    value={segment.centerLength ?? ''}
                    onChange={(e) =>
                      onChange({
                        centerLength:
                          e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>

                <div className="field cut-field">
                  <span className="field-label">切断長さ</span>
                  <div className="cut-value">
                    {cut?.cut != null ? `${cut.cut} mm` : '—'}
                  </div>
                </div>
              </div>

              <details className="panel-more">
                <summary>フランジ（始点 / 終点）</summary>
                <div className="panel-grid">
                  <label className="field">
                    <span className="field-label">始点側</span>
                    <select
                      value={segment.startFlange ?? ''}
                      onChange={(e) =>
                        onChange({
                          startFlange: (e.target.value || undefined) as
                            | 'double'
                            | 'single'
                            | undefined,
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
                          endFlange: (e.target.value || undefined) as
                            | 'double'
                            | 'single'
                            | undefined,
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
            </>
          )}
        </div>
      )}
    </section>
  )
}
