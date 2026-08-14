// 【サポート架台図面】ページ本体。
// 図の水色の数字・配管をタップして編集する（図から寸法入力。Flutter版と同じ操作感）。
// 計算＝supportSpec/hangerDesign（純ロジック）、図面＝SupportFigure（SVG＋タップ編集チップ）。
// スタイルはクイック計算・窒素計算と同じ土台(.qc-screen/.qc-body/.field/
// .round-toggle)、モーダルは免責事項等と同じ土台(.disclaimer-*)を流用している。

import { useState } from 'react'
import SupportFigure, { type EditTarget } from './SupportFigure'
import { SupportPrintSheet, paginateDesigns, type SupportPrintMode } from './SupportPrintSheet'
import {
  HangerDesign,
  HoleSpec,
  createHangerDesign,
  compute,
  missing,
  legendSpecs,
  holeColor,
  holeNotation,
  holeColorPalette,
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
  | { type: 'pipe'; index: number }
  | { type: 'addPipe' }
  | { type: 'holeSettings' }
  | null

interface Props {
  onClose: () => void
}

/**
 * 配管を1本足す。hangerDesign の addPipe は必ずサイズ100Aと芯々200を付けるが、
 * ここでは「最初は空・サイズは必ずユーザーが選ぶ」ようにしたいので、この画面
 * 専用のヘルパーを置く（hangerDesign.ts はFlutter版と共有のためそのまま）。
 * 1本目のときは芯々(spans)を増やさない（spansの本数は配管数-1）。
 */
function appendPipe(d: HangerDesign, size: string): HangerDesign {
  return {
    ...d,
    pipeSizes: [...d.pipeSizes, size],
    sleepers: [...d.sleepers, 0],
    spans: d.pipeSizes.length === 0 ? [] : [...d.spans, 200],
  }
}

/**
 * 配管を1本削除。hangerDesign の removePipe は最後の1本を残す作りだが、
 * この画面は「配管0本＝これから入力する状態」を正しく扱えるので全部消せる。
 */
function dropPipe(d: HangerDesign, i: number): HangerDesign {
  const spans = [...d.spans]
  if (spans.length > 0) spans.splice(i === 0 ? 0 : i - 1, 1)
  return {
    ...d,
    pipeSizes: d.pipeSizes.filter((_, k) => k !== i),
    sleepers: d.sleepers.filter((_, k) => k !== i),
    spans,
  }
}

/** 配管だけを空にした「次の架台」。材料・基準・ゲージ・端あき等は引き継ぐ。 */
function nextDesign(d: HangerDesign): HangerDesign {
  return { ...d, pipeSizes: [], sleepers: [], spans: [] }
}

export function SupportDrawingPage({ onClose }: Props) {
  // 配管は最初から入れない。既定値が入っていると「今どこまで入力したのか」が
  // 分からなくなるため、必ずユーザーがサイズを選んで足していく形にする。
  const [d, setD] = useState<HangerDesign>(() =>
    createHangerDesign({ pipeSizes: [], sleepers: [], spans: [] }),
  )
  const [editing, setEditing] = useState<Editing>(null)
  // 印刷/PDF用に貯めた架台。1現場で何台も作ることが多いため、1台ずつ
  // 印刷するのではなくシートにまとめてから出力する。
  const [sheet, setSheet] = useState<HangerDesign[]>([])
  const [printMode, setPrintMode] = useState<SupportPrintMode>('pack')
  const [printOpen, setPrintOpen] = useState(false)
  const patch = (p: Partial<HangerDesign>) => setD((cur) => ({ ...cur, ...p }))

  const openNum = (title: string, value: number, apply: (v: number) => HangerDesign) =>
    setEditing({ type: 'num', title, value, apply })

  const handleEdit = (t: EditTarget) => {
    switch (t.kind) {
      case 'gauge':
        openNum(`${d.memberChannel ? '背側' : '刃側'}から穴まで（ゲージ）`, d.gauge, (v) => ({ ...d, gauge: v }))
        break
      case 'pipe':
        setEditing({ type: 'pipe', index: t.index })
        break
      case 'holeSettings':
        setEditing({ type: 'holeSettings' })
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

  // 配管0本のときは計算しない(計算側は配管が1本以上ある前提のため)。
  const hasPipes = d.pipeSizes.length > 0
  const miss = hasPipes ? missing(d) : []
  const ready = hasPipes && miss.length === 0
  const r = ready ? compute(d) : null
  const overflow = r ? hangerOverflow(d, r) : false
  // 印刷対象＝保存済みの架台＋（入力中のものがあれば）それも含める。
  // 保存し忘れた1台が黙って抜け落ちる方が現場では困るため。
  const printDesigns = ready ? [...sheet, d] : sheet
  // 何ページになるかを事前に知らせる(実際の分割も印刷シート側で同じ関数を使う)。
  const printPageCount = printDesigns.length > 0 ? paginateDesigns(printDesigns, printMode).length : 0

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
          <span className="field-label">穴</span>
          <div className="support-hole-summary">
            <div className="support-hole-summary-list">
              {legendSpecs(d).map((e) => (
                <span key={e.key} className="support-hole-summary-item" style={{ color: holeColor(e.spec) }}>
                  {e.key} {holeNotation(e.spec)}
                </span>
              ))}
            </div>
            <button type="button" className="support-btn" onClick={() => setEditing({ type: 'holeSettings' })}>
              変更する
            </button>
          </div>
        </div>

        {!hasPipes ? (
          // 配管がまだ1本も無い状態。何をすればいいかが一目で分かるように、
          // 図の代わりに空状態のカードを出す。
          <div className="support-empty">
            <div className="support-empty-title">
              {sheet.length > 0 ? `${sheet.length + 1}台目の架台` : 'まだ配管がありません'}
            </div>
            <p className="support-empty-body">
              「配管を追加」から、この架台に乗せる配管のサイズを選んでください。
              {sheet.length > 0 && '（材料・基準・ゲージ・端あきは前の架台から引き継いでいます）'}
            </p>
          </div>
        ) : miss.length > 0 ? (
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
            <div className="field-note">水色の数字・配管をタップして入力／長い構成は図を横にスクロールできます</div>
          </>
        )}

        <button type="button" className="n2-add-row" onClick={() => setEditing({ type: 'addPipe' })}>
          ＋ 配管を追加
        </button>

        {r && (
          <div className="n2-total-row">
            切り寸
            <b>{fmtMm(r.totalLength)} mm</b>
          </div>
        )}

        {/* 1現場で何台も作るので、「今の1台を保存して次へ」を主役の操作にする。
            保存すると配管だけが空になり、空状態のカードが出るので「今は次の
            架台を入力中」だと分かる（材料・基準・ゲージ・端あきは引き継ぐ）。 */}
        <button
          type="button"
          className="support-next-btn"
          disabled={!ready}
          onClick={() => {
            setSheet((cur) => [...cur, JSON.parse(JSON.stringify(d)) as HangerDesign])
            setD((cur) => nextDesign(cur))
          }}
        >
          この架台を保存して次を作る
        </button>

        {sheet.length > 0 && (
          <div className="field">
            <span className="field-label">保存した架台（{sheet.length}台）</span>
            <div className="support-saved-list">
              {sheet.map((sd, i) => (
                <div className="support-saved-item" key={i}>
                  <span className="support-saved-no">No.{i + 1}</span>
                  <span className="support-saved-desc">
                    {sd.pipeSizes.join('・')}
                    <span className="support-saved-cut">切り寸 {fmtMm(compute(sd).totalLength)}</span>
                  </span>
                  <button
                    type="button"
                    className="support-btn-danger"
                    onClick={() => setSheet((cur) => cur.filter((_, k) => k !== i))}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">
            PDF・印刷
            <span className="field-note">
              {printDesigns.length > 0 ? `${printDesigns.length}台` : '対象なし'}
            </span>
          </span>
          <div className="support-sheet-row">
            <button
              type="button"
              className="support-btn-primary"
              disabled={printDesigns.length === 0}
              onClick={() => setPrintOpen(true)}
            >
              PDFで見る
            </button>
            {ready && sheet.length > 0 && (
              <span className="field-note">入力中の1台も含めて出力します</span>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">並べ方</span>
          <Seg
            value={printMode}
            options={[
              ['pack', '詰めて印刷'],
              ['one', '1台ずつ'],
            ]}
            onChange={(v) => setPrintMode(v as SupportPrintMode)}
          />
        </div>
        <div className="field-note">
          {printDesigns.length === 0
            ? '穴々を入力すると出力できます'
            : printMode === 'pack'
              ? `A4縦${printPageCount}ページ（1台ずつ用紙の幅いっぱいに描き、入るだけ1枚に詰めます）`
              : `A4縦${printPageCount}ページ（1台で1枚を使うので、いちばん大きく出ます）`}
        </div>
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
      {editing?.type === 'pipe' && (
        <PipeModal d={d} index={editing.index} onClose={() => setEditing(null)} onChange={(next) => setD(next)} />
      )}
      {editing?.type === 'addPipe' && (
        <AddPipeModal
          index={d.pipeSizes.length}
          onClose={() => setEditing(null)}
          onPick={(size) => {
            setD((cur) => appendPipe(cur, size))
            setEditing(null)
          }}
        />
      )}
      {editing?.type === 'holeSettings' && (
        <HoleSettingsModal d={d} onClose={() => setEditing(null)} onChange={(next) => setD(next)} />
      )}
      {printOpen && printDesigns.length > 0 && (
        <SupportPrintSheet
          designs={printDesigns}
          mode={printMode}
          onClose={() => setPrintOpen(false)}
        />
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
          onFocus={(e) => e.target.select()}
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

const HOLE_FIELD_TITLES: Record<'hole3' | 'hole4' | 'holeHanger', string> = {
  hole3: '3分 Uボルト穴',
  hole4: '4分 Uボルト穴',
  holeHanger: '吊り穴',
}

/**
 * 数値を直接<input value>に束縛すると、空にした瞬間に0扱いになり
 * 次に打った数字が「0」の後ろに付く見た目になる(例: "12"を消して"3"→"03")。
 * NumModalと同じく、表示用の文字列はローカルstateに持たせ、有効な数値の
 * ときだけ上位へ反映する(空や入力途中はまだ反映しない)。
 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        className="num-input"
        value={text}
        onChange={(e) => {
          const s = e.target.value
          setText(s)
          const n = Number(s)
          if (s !== '' && !Number.isNaN(n)) onChange(n)
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => setText(String(value))}
      />
    </label>
  )
}

function Stepper({
  value,
  onChange,
  step = 1,
  min = 1,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
}) {
  return (
    <div className="support-stepper">
      <button type="button" className="support-stepper-btn" onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <span className="support-stepper-value">{fmtMm(value)}</span>
      <button type="button" className="support-stepper-btn" onClick={() => onChange(value + step)}>
        ＋
      </button>
    </div>
  )
}

function HoleTypeEditor({
  title,
  spec,
  onChange,
}: {
  title: string
  spec: HoleSpec
  onChange: (next: HoleSpec) => void
}) {
  const patch = (p: Partial<HoleSpec>) => onChange({ ...spec, ...p })
  return (
    <div className="support-hole-editor">
      <div className="support-hole-editor-title">{title}</div>
      <div className="field">
        <span className="field-label">穴の形状</span>
        <Seg
          value={spec.slot}
          options={[
            [false, '丸穴'],
            [true, '長穴'],
          ]}
          onChange={(v) => patch({ slot: v })}
        />
      </div>
      {!spec.slot ? (
        <div className="field">
          <span className="field-label">径 φ(mm)</span>
          <Stepper value={spec.dia} onChange={(v) => patch({ dia: v })} />
        </div>
      ) : (
        <div className="panel-grid">
          <NumberField label="長穴 幅(mm)" value={spec.slotW} onChange={(v) => patch({ slotW: v })} />
          <NumberField label="長穴 長さ(mm)" value={spec.slotL} onChange={(v) => patch({ slotL: v })} />
        </div>
      )}
      <div className="field">
        <span className="field-label">色</span>
        <div className="support-color-row">
          {holeColorPalette.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`support-color-swatch${spec.colorIndex === i ? ' active' : ''}`}
              style={{ background: c }}
              aria-label={`色 ${i + 1}`}
              onClick={() => patch({ colorIndex: i })}
            />
          ))}
        </div>
      </div>
      <div className="support-hole-editor-preview">表記: {holeNotation(spec)}</div>
    </div>
  )
}

function HoleSettingsModal({
  d,
  onChange,
  onClose,
}: {
  d: HangerDesign
  onChange: (next: HangerDesign) => void
  onClose: () => void
}) {
  return (
    <Overlay title="穴の設定" onClose={onClose}>
      <HoleTypeEditor title={HOLE_FIELD_TITLES.hole3} spec={d.hole3} onChange={(next) => onChange({ ...d, hole3: next })} />
      <HoleTypeEditor title={HOLE_FIELD_TITLES.hole4} spec={d.hole4} onChange={(next) => onChange({ ...d, hole4: next })} />
      {d.hasHanger && (
        <HoleTypeEditor
          title={HOLE_FIELD_TITLES.holeHanger}
          spec={d.holeHanger}
          onChange={(next) => onChange({ ...d, holeHanger: next })}
        />
      )}
      <div className="menu-order-actions">
        <button type="button" className="support-btn-primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Overlay>
  )
}

/**
 * 「＋ 配管を追加」で最初に出す、配管サイズを選ぶだけのモーダル。
 * サイズを選んで初めて図に配管が足される（既定値で勝手に入っていると
 * 「自分が入れた値」と「最初から入っていた値」の区別が付かないため）。
 * 保温厚などの細かい設定は、追加後に図の配管をタップして変更する。
 */
function AddPipeModal({
  index,
  onPick,
  onClose,
}: {
  index: number
  onPick: (size: string) => void
  onClose: () => void
}) {
  return (
    <Overlay title={`配管 ${index + 1} のサイズ`} onClose={onClose}>
      <p className="field-note" style={{ marginTop: 0 }}>
        サイズを選ぶと図に追加されます。保温厚は追加後に図の配管をタップして変更できます。
      </p>
      <div className="support-chip-row">
        {PIPE_SIZES.map((s) => (
          <button key={s} type="button" className="support-chip" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="disclaimer-actions">
        <button type="button" className="support-btn" onClick={onClose}>
          キャンセル
        </button>
      </div>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          type="button"
          className="support-btn-danger"
          onClick={() => {
            onChange(dropPipe(d, index))
            onClose()
          }}
        >
          この配管を削除
        </button>
      </div>
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
