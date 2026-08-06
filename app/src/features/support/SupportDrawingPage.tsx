// 【サポート架台図面】ページ本体。
// アイソメアプリの「アイソメの新規作成」の下から開く1画面。
// 計算＝supportSpec/hangerDesign（純ロジック）、図面＝SupportFigure（SVG）。
// スタイルはクイック計算・窒素計算と同じ土台(.qc-screen/.qc-body/.field/
// .round-toggle/.n2-row*)を流用し、アプリのダークテーマに揃えてある。

import { useState } from 'react'
import SupportFigure from './SupportFigure'
import {
  HangerDesign,
  createHangerDesign,
  compute,
  addPipe,
  removePipe,
  missing,
} from './hangerDesign'
import { PIPE_SIZES, SLEEPER_THICKNESSES, fmtMm } from './supportSpec'

const GAUGE_OPTIONS = [15, 18, 20, 22, 23, 25, 28, 30]

interface Props {
  onClose: () => void
}

export function SupportDrawingPage({ onClose }: Props) {
  const [d, setD] = useState<HangerDesign>(() => createHangerDesign())
  const patch = (p: Partial<HangerDesign>) => setD((cur) => ({ ...cur, ...p }))

  const miss = missing(d)
  const r = miss.length === 0 ? compute(d) : null

  return (
    <div className="qc-screen">
      <header className="topbar">
        <div className="title">サポート架台図面</div>
        <div className="tools">
          <button onClick={onClose}>作図に戻る</button>
        </div>
      </header>

      <div className="qc-body">
        <div className="field">
          <span className="field-label">材料</span>
          <Seg
            value={d.memberChannel}
            options={[
              [false, 'アングル'],
              [true, 'チャンネル'],
            ]}
            onChange={(v) => patch({ memberChannel: v })}
          />
        </div>

        <div className="field">
          <span className="field-label">吊り穴</span>
          <Seg
            value={d.hasHanger}
            options={[
              [true, 'あり'],
              [false, 'なし'],
            ]}
            onChange={(v) => patch({ hasHanger: v, modeB: v ? d.modeB : false })}
          />
        </div>

        {d.hasHanger && (
          <div className="field">
            <span className="field-label">基準</span>
            <Seg
              value={d.modeB}
              options={[
                [false, '配管芯々'],
                [true, '吊り元'],
              ]}
              onChange={(v) => patch({ modeB: v })}
            />
          </div>
        )}

        <div className="field">
          <span className="field-label">{d.memberChannel ? '背向き' : '刃向き'}</span>
          <Seg
            value={d.bladeTop}
            options={[
              [false, '手前'],
              [true, '奥'],
            ]}
            onChange={(v) => patch({ bladeTop: v })}
          />
        </div>

        <div className="field">
          <span className="field-label">
            {d.memberChannel ? '背側' : '刃側'}から穴まで（ゲージ, mm）
          </span>
          <div className="support-chip-row">
            {GAUGE_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                className={`support-chip${d.gauge === v ? ' active' : ''}`}
                onClick={() => patch({ gauge: v })}
              >
                {v}
              </button>
            ))}
            <input
              type="number"
              className="num-input"
              style={{ width: 80 }}
              value={d.gauge}
              onChange={(e) => patch({ gauge: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">配管（左→右）</span>
          <div className="n2-rows">
            {d.pipeSizes.map((size, i) => (
              <div className="n2-row" key={i}>
                <div className="n2-row-head">
                  <span className="field-label">{i + 1}本目</span>
                  {d.pipeSizes.length > 1 && (
                    <button
                      type="button"
                      className="n2-row-remove"
                      onClick={() => setD((cur) => removePipe(cur, i))}
                    >
                      削除
                    </button>
                  )}
                </div>
                <div className="panel-grid">
                  <label className="field">
                    <span className="field-label">サイズ</span>
                    <select
                      value={size}
                      onChange={(e) => {
                        const arr = [...d.pipeSizes]
                        arr[i] = e.target.value
                        patch({ pipeSizes: arr })
                      }}
                    >
                      {PIPE_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">スリーパー</span>
                    <select
                      value={d.sleepers[i]}
                      onChange={(e) => {
                        const arr = [...d.sleepers]
                        arr[i] = Number(e.target.value)
                        patch({ sleepers: arr })
                      }}
                    >
                      <option value={0}>なし</option>
                      {SLEEPER_THICKNESSES.map((t) => (
                        <option key={t} value={t}>
                          T{t}
                        </option>
                      ))}
                    </select>
                  </label>
                  {i > 0 && (
                    <label className="field">
                      <span className="field-label">芯々{i}-{i + 1}(mm)</span>
                      <input
                        type="number"
                        className="num-input"
                        value={d.spans[i - 1]}
                        onChange={(e) => {
                          const arr = [...d.spans]
                          arr[i - 1] = Number(e.target.value) || 0
                          patch({ spans: arr })
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="n2-add-row" onClick={() => setD((cur) => addPipe(cur))}>
            ＋ 配管を追加
          </button>
        </div>

        <div className="field">
          <span className="field-label">端の寸法(mm)</span>
          <div className="panel-grid">
            {!d.modeB && (
              <>
                <NumField label="端あき左" value={d.endL} onChange={(v) => patch({ endL: v })} />
                {d.hasHanger && (
                  <>
                    <NumField label="吊穴→U穴左" value={d.hgL} onChange={(v) => patch({ hgL: v })} />
                    <NumField label="吊穴→U穴右" value={d.hgR} onChange={(v) => patch({ hgR: v })} />
                  </>
                )}
                <NumField label="端あき右" value={d.endR} onChange={(v) => patch({ endR: v })} />
              </>
            )}
            {d.modeB && (
              <>
                <NumField label="吊り元芯々" value={d.hangerPitch} onChange={(v) => patch({ hangerPitch: v })} />
                <NumField label="基準吊元→配管" value={d.refToPipe} onChange={(v) => patch({ refToPipe: v })} />
                <label className="field round-field">
                  <span className="field-label">基準吊元</span>
                  <Seg
                    value={d.refRight}
                    options={[
                      [false, '左'],
                      [true, '右'],
                    ]}
                    onChange={(v) => patch({ refRight: v })}
                  />
                </label>
                <NumField label="端の出左" value={d.endOutL} onChange={(v) => patch({ endOutL: v })} />
                <NumField label="端の出右" value={d.endOutR} onChange={(v) => patch({ endOutR: v })} />
              </>
            )}
          </div>
        </div>

        {miss.length > 0 ? (
          <div className="n2-total-row">穴々が未登録です：{miss.join(', ')}</div>
        ) : (
          <>
            <div className="support-figure-card">
              <SupportFigure design={d} />
            </div>
            {r && (
              <div className="n2-total-row">
                切り寸
                <b>{fmtMm(r.totalLength)} mm</b>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// --- 小さなUI部品 ---

function Seg<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
}) {
  return (
    <div className="round-toggle">
      {options.map(([v, lbl]) => (
        <button
          key={String(v)}
          type="button"
          className={value === v ? 'active' : ''}
          onClick={() => onChange(v)}
        >
          {lbl}
        </button>
      ))}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        className="num-input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  )
}
