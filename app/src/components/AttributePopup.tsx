import type { Segment } from '../types'
import { distance } from '../lib/isometric'
import {
  fittings,
  pipeTypes,
  sizesForPipeType,
  getSizeInfo,
  getPipeType,
  connectionMethods,
} from '../data/masters'
import type { CutResult } from '../lib/cutlength'

interface Props {
  segment: Segment
  /** 親から継承される管種（自分未設定時のデフォルト） */
  inheritedPipeType?: string
  /** 親から継承されるサイズ（自分未設定時のデフォルト） */
  inheritedSize?: string
  /** 切断寸法の計算結果 */
  cut: CutResult
  onChange: (patch: Partial<Segment>) => void
  onClose: () => void
}

/**
 * 「寸法・属性を入力」で開くポップアップ（ボトムシート）。
 * 管種 / サイズ / 継手 / 接続方法 をマスタから選択する。
 * 未設定の管種・サイズは上流から継承した値を既定として扱い、
 * 明示的に選ぶとその値が下流にも引き継がれる。
 */
export function AttributePopup({
  segment,
  inheritedPipeType,
  inheritedSize,
  cut,
  onChange,
  onClose,
}: Props) {
  const length = Math.round(distance(segment.start, segment.end))
  // サイズ候補は「実効管種（自分 or 継承）」に合わせる
  const effPipe = segment.pipeType ?? inheritedPipeType
  const sizes = sizesForPipeType(effPipe)
  const od = getSizeInfo(segment.size ?? inheritedSize)?.od

  const pipeEmptyLabel = inheritedPipeType
    ? `継承（${getPipeType(inheritedPipeType)?.short ?? inheritedPipeType}）`
    : '— 未設定 —'
  const sizeEmptyLabel = inheritedSize ? `継承（${inheritedSize}）` : '— 未設定 —'

  function onPipeTypeChange(pipeType: string) {
    const available = sizesForPipeType(pipeType || inheritedPipeType).map(
      (s) => s.code,
    )
    const patch: Partial<Segment> = { pipeType: pipeType || undefined }
    if (segment.size && !available.includes(segment.size)) {
      patch.size = undefined
    }
    onChange(patch)
  }

  return (
    <>
      <div className="sheet-overlay" onPointerDown={onClose} />
      <div className="attr-sheet" onPointerDown={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>セグメント属性</span>
          <button className="sheet-close" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="sheet-body">
          <div className="attr-row">
            <span className="attr-label">角度 / 図面長</span>
            <span className="attr-value">
              {segment.angle}° / {length} px
            </span>
          </div>

          <label className="field">
            <span className="field-label">
              芯々寸法（mm）
              <span className="field-note">中心〜中心の実寸を入力</span>
            </span>
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

          <label className="field">
            <span className="field-label">
              管種
              <span className="field-note">未設定なら上流から継承</span>
            </span>
            <select
              value={segment.pipeType ?? ''}
              onChange={(e) => onPipeTypeChange(e.target.value)}
            >
              <option value="">{pipeEmptyLabel}</option>
              {pipeTypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              サイズ（呼び径）
              {od != null && <span className="field-note">外径 {od} mm</span>}
            </span>
            <select
              value={segment.size ?? ''}
              onChange={(e) => onChange({ size: e.target.value || undefined })}
            >
              <option value="">{sizeEmptyLabel}</option>
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
              value={segment.connection ?? ''}
              onChange={(e) =>
                onChange({ connection: e.target.value || undefined })
              }
            >
              <option value="">— 未設定 —</option>
              {connectionMethods.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              フランジ（始点側）
              <span className="field-note">両=途中接続 / 片=終端エンド</span>
            </span>
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
              <option value="single">片フランジ（終端）</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">フランジ（終点側）</span>
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
              <option value="single">片フランジ（終端）</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">継手（始点側）</span>
            <select
              value={segment.startFitting ?? ''}
              onChange={(e) =>
                onChange({ startFitting: e.target.value || undefined })
              }
            >
              <option value="">— 未選択 —</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">継手（終点側）</span>
            <select
              value={segment.endFitting ?? ''}
              onChange={(e) =>
                onChange({ endFitting: e.target.value || undefined })
              }
            >
              <option value="">— 未選択 —</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          {/* 切断（加工）寸法の内訳 */}
          <div className="cut-summary">
            <div className="cut-title">切断（加工）寸法</div>
            {segment.centerLength == null ? (
              <div className="cut-hint">芯々寸法を入力すると自動計算します。</div>
            ) : (
              <>
                <div className="cut-row">
                  <span>芯々寸法</span>
                  <span>{cut.center} mm</span>
                </div>
                <div className="cut-row">
                  <span>− 始点側 継手・フランジ</span>
                  <span>{cut.startAllow} mm</span>
                </div>
                <div className="cut-row">
                  <span>− 終点側 継手・フランジ</span>
                  <span>{cut.endAllow} mm</span>
                </div>
                <div className="cut-row total">
                  <span>切断長さ</span>
                  <span>{cut.cut} mm</span>
                </div>
                {!cut.sizeKnown && (
                  <div className="cut-hint">
                    ※サイズ未設定のため継手寸法は差し引かれていません。
                  </div>
                )}
              </>
            )}
          </div>

          <p className="sheet-note">
            サイズ・管種を変更すると下流のセグメントにも引き継がれます（別途変更されるまで）。
            継手の集計・CSV出力はフェーズ4で対応します。
          </p>
        </div>
      </div>
    </>
  )
}
