// 【サポート架台図面】ページ本体。
// 図の水色の数字・配管をタップして編集する（図から寸法入力。Flutter版と同じ操作感）。
// 計算＝supportSpec/hangerDesign（純ロジック）、図面＝SupportFigure（SVG＋タップ編集チップ）。
// スタイルはクイック計算・窒素計算と同じ土台(.qc-screen/.qc-body/.field/
// .round-toggle)、モーダルは免責事項等と同じ土台(.disclaimer-*)を流用している。

import { useState } from 'react'
import SupportFigure, { type EditTarget } from './SupportFigure'
import {
  HangerDesign,
  createHangerDesign,
  compute,
  addPipe,
  removePipe,
  missing,
} from './hangerDesign'
import { PIPE_SIZES, SLEEPER_THICKNESSES, fmtMm, type HangerCalcResult } from './supportSpec'

/**
 * 吊り元基準(モードB)で、配管の穴が吊り元(ハンガー間隔)の外側に
 * はみ出していないか確認する。配管を追加しても吊り元芯々は自動では
 * 広がらないため、配管の並びが元の吊り元芯々に収まらなくなることがある
 * (この場合、穴同士が重なって見えたり、端の寸法チップが正しく出なく
 * なったりする)。計算結果自体は壊れていないので描画はそのまま出しつつ、
 * 原因と直し方が分かるよう注意書きを添える。
 */
function hangerOverflow(d: HangerDesign, r: HangerCalcResult): boolean {
  if (!d.modeB || !d.hasHanger) return false
  const hangers = r.holes.filter((h) => h.isHanger)
  if (hangers.length < 2) return false
  const lo = Math.min(hangers[0].x, hangers[hangers.length - 1].x)
  const hi = Math.max(hangers[0].x, hangers[hangers.length - 1].x)
  return r.holes.some((h) => !h.isHanger && (h.x < lo - 0.01 || h.x > hi + 0.01))
}

type Editing =
  | { type: 'num'; title: string; value: number; apply: (v: number) => HangerDesign }
  | { type: 'gauge' }
  | { type: 'pipe'; index: number }
  | null

interface Props {
  onClose: () => void
}

export function SupportDrawingPage({ onClose }: Props) {
  const [d, setD] = useState<HangerDesign>(() => createHangerDesign())
  const [editing, setEditing] = useState<Editing>(null)
  const patch = (p: Partial<HangerDesign>) => setD((cur) => ({ ...cur, ...p }))

  const openNum = (title: string, value: number, apply: (v: number) => HangerDesign) =>
    setEditing({ type: 'num', title, value, apply })

  const handleEdit = (t: EditTarget) => {
    switch (t.kind) {
      case 'gauge':
        setEditing({ type: 'gauge' })
        break
      case 'pipe':
        setEditing({ type: 'pipe', index: t.index })
        break
      case 'span':
        openNum(`配管${t.index + 1}→${t.index + 2} 芯々`, d.spans[t.index], (v) => {
          const a = [...d.spans]
          a[t.index] = v
          return { ...d, spans: a }
        })
        break
      case 'end':
        if (d.modeB) {
          openNum(t.side === 'L' ? '端の出 左' : '端の出 右', t.side === 'L' ? d.endOutL : d.endOutR, (v) =>
            t.side === 'L' ? { ...d, endOutL: v } : { ...d, endOutR: v },
          )
        } else {
          openNum(t.side === 'L' ? '端あき 左' : '端あき 右', t.side === 'L' ? d.endL : d.endR, (v) =>
            t.side === 'L' ? { ...d, endL: v } : { ...d, endR: v },
          )
        }
        break
      case 'hg':
        openNum(t.side === 'L' ? '吊穴→U穴 左' : '吊穴→U穴 右', t.side === 'L' ? d.hgL : d.hgR, (v) =>
          t.side === 'L' ? { ...d, hgL: v } : { ...d, hgR: v },
        )
        break
      case 'hangerPitch':
        openNum('吊り元芯々', d.hangerPitch, (v) => ({ ...d, hangerPitch: v }))
        break
      case 'refToPipe':
        openNum(
          t.side === 'L' ? '左の吊り元→配管 芯々' : '右の吊り元→配管 芯々',
          d.refToPipe,
          (v) => ({ ...d, refRight: t.side === 'R', refToPipe: v }),
        )
        break
    }
  }

  const miss = missing(d)
  const r = miss.length === 0 ? compute(d) : null
  const overflow = r ? hangerOverflow(d, r) : false

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

        {miss.length > 0 ? (
          <div className="n2-total-row">穴々が未登録です：{miss.join(', ')}</div>
        ) : (
          <>
            {overflow && (
              <div className="socket-gap-warn">
                <p>
                  配管の並びが吊り元芯々からはみ出しています（配管を追加しても吊り元芯々は自動で広がりません）。
                  「吊り元芯々」を広げるか、「基準吊元→配管」を調整してください。
                </p>
              </div>
            )}
            <div className="support-figure-card">
              <SupportFigure design={d} onEdit={handleEdit} />
            </div>
            <div className="field-note">水色の数字・配管をタップして入力</div>
          </>
        )}

        <button type="button" className="n2-add-row" onClick={() => setD((cur) => addPipe(cur))}>
          ＋ 配管を追加
        </button>

        {r && (
          <div className="n2-total-row">
            切り寸
            <b>{fmtMm(r.totalLength)} mm</b>
          </div>
        )}
      </div>

      {editing?.type === 'num' && (
        <NumModal
          title={editing.title}
          value={editing.value}
          onCancel={() => setEditing(null)}
          onOk={(v) => {
            setD(editing.apply(v))
            setEditing(null)
          }}
        />
      )}
      {editing?.type === 'gauge' && (
        <GaugeModal
          value={d.gauge}
          isChannel={d.memberChannel}
          onCancel={() => setEditing(null)}
          onPick={(v) => {
            patch({ gauge: v })
            setEditing(null)
          }}
        />
      )}
      {editing?.type === 'pipe' && (
        <PipeModal d={d} index={editing.index} onClose={() => setEditing(null)} onChange={(next) => setD(next)} />
      )}
    </div>
  )
}

// --- モーダル ---

function Overlay({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="disclaimer-overlay" onClick={onClose}>
      <div className="disclaimer-card" onClick={(e) => e.stopPropagation()}>
        <div className="disclaimer-header">{title}</div>
        <div className="disclaimer-body">{children}</div>
      </div>
    </div>
  )
}

function NumModal({
  title,
  value,
  onOk,
  onCancel,
}: {
  title: string
  value: number
  onOk: (v: number) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(String(fmtMm(value)))
  return (
    <Overlay title={title} onClose={onCancel}>
      <label className="field">
        <span className="field-label">
          <span>mm</span>
        </span>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          className="num-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="menu-order-actions">
        <button type="button" className="support-btn" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="support-btn-primary" onClick={() => onOk(Number(text) || 0)}>
          OK
        </button>
      </div>
    </Overlay>
  )
}

function GaugeModal({
  value,
  isChannel,
  onPick,
  onCancel,
}: {
  value: number
  isChannel: boolean
  onPick: (v: number) => void
  onCancel: () => void
}) {
  const common = [15, 18, 20, 22, 23, 25, 28, 30]
  const [text, setText] = useState(String(fmtMm(value)))
  return (
    <Overlay title={`${isChannel ? '背側' : '刃側'}から穴まで（ゲージ）`} onClose={onCancel}>
      <p className="field-note">50幅の目安は15〜30。会社・幅で変わります</p>
      <div className="support-chip-row">
        {common.map((v) => (
          <button
            key={v}
            type="button"
            className={`support-chip${Math.abs(value - v) < 0.001 ? ' active' : ''}`}
            onClick={() => onPick(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">その他(mm)</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            className="num-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="support-btn-primary" onClick={() => onPick(Number(text) || 0)}>
            OK
          </button>
        </div>
      </label>
    </Overlay>
  )
}

function PipeModal({
  d,
  index,
  onChange,
  onClose,
}: {
  d: HangerDesign
  index: number
  onChange: (next: HangerDesign) => void
  onClose: () => void
}) {
  return (
    <Overlay title={`配管 ${index + 1}`} onClose={onClose}>
      {d.pipeSizes.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            className="support-btn-danger"
            onClick={() => {
              onChange(removePipe(d, index))
              onClose()
            }}
          >
            この配管を削除
          </button>
        </div>
      )}
      <div className="field-label">配管サイズ</div>
      <div className="support-chip-row" style={{ marginBottom: 14 }}>
        {PIPE_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`support-chip${d.pipeSizes[index] === s ? ' active' : ''}`}
            onClick={() => {
              const a = [...d.pipeSizes]
              a[index] = s
              onChange({ ...d, pipeSizes: a })
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="field-label">スリーパー保温厚</div>
      <div className="support-chip-row">
        <button
          type="button"
          className={`support-chip${d.sleepers[index] === 0 ? ' active' : ''}`}
          onClick={() => {
            const a = [...d.sleepers]
            a[index] = 0
            onChange({ ...d, sleepers: a })
          }}
        >
          なし
        </button>
        {SLEEPER_THICKNESSES.map((t) => (
          <button
            key={t}
            type="button"
            className={`support-chip${d.sleepers[index] === t ? ' active' : ''}`}
            onClick={() => {
              const a = [...d.sleepers]
              a[index] = t
              onChange({ ...d, sleepers: a })
            }}
          >
            T{t}
          </button>
        ))}
      </div>
      <div className="menu-order-actions">
        <button type="button" className="support-btn-primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Overlay>
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
