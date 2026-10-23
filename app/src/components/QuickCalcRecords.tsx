import { useState } from 'react'

// クイック計算の記録（履歴）と現場ファイル。
// ＝を押した計算を、選んでいる保存先に記録する。保存先を選ばないときは
// 「メモ」(最大30件)、現場ファイルは1つにつき最大200件まで残す。
// 無料版はメモの新しい5件だけ見られ、現場ファイルは使えない(職長プランの案内を出す)。
// 保存は無料版でも30件まで残すので、職長プランにすると前の記録もそのまま見られる。

export interface QcRecord {
  id: string
  at: number
  summary: string
  cut: number
  /** 現場ファイルのid。無ければ「メモ」 */
  fileId?: string
  /** 一言メモ（例: 2F 給水 ①） */
  note?: string
}

export interface QcFile {
  id: string
  name: string
  createdAt: number
}

export const MEMO_MAX = 30
export const FILE_MAX = 200
/** 無料版で見られるメモの件数 */
export const FREE_MEMO_SHOWN = 5

/** 記録を1件足す。保存先ごとの上限を超えた古いものから消す */
export function addRecord(list: QcRecord[], rec: QcRecord): QcRecord[] {
  const max = rec.fileId ? FILE_MAX : MEMO_MAX
  let kept = 0
  return [rec, ...list].filter((r) => {
    if (r.fileId !== rec.fileId) return true
    kept += 1
    return kept <= max
  })
}

function timeLabel(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

export function QuickCalcRecords({
  locked,
  onUnlock,
  records,
  setRecords,
  files,
  setFiles,
  currentFileId,
  setCurrentFileId,
}: {
  locked: boolean
  onUnlock: () => void
  records: QcRecord[]
  setRecords: (updater: (prev: QcRecord[]) => QcRecord[]) => void
  files: QcFile[]
  setFiles: (updater: (prev: QcFile[]) => QcFile[]) => void
  currentFileId: string | undefined
  setCurrentFileId: (id: string | undefined) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // 名前入力欄: 'new' = 新しい現場ファイル / 'rename' = 今のファイル名を変える
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  // 無料版はメモだけ(現場ファイルは選べない)
  const current = locked ? undefined : files.find((f) => f.id === currentFileId)
  const all = records.filter((r) => r.fileId === current?.id)
  const shown = locked ? all.slice(0, FREE_MEMO_SHOWN) : all
  const countOf = (id?: string) => records.filter((r) => r.fileId === id).length

  function startNaming(kind: 'new' | 'rename') {
    setNaming(kind)
    setNameDraft(kind === 'rename' ? (current?.name ?? '') : '')
  }

  function commitName() {
    const name = nameDraft.trim()
    if (!name) {
      setNaming(null)
      return
    }
    if (naming === 'new') {
      const id = `f${Date.now()}`
      setFiles((prev) => [...prev, { id, name, createdAt: Date.now() }])
      setCurrentFileId(id)
    } else if (naming === 'rename' && current) {
      setFiles((prev) => prev.map((f) => (f.id === current.id ? { ...f, name } : f)))
    }
    setNaming(null)
    setPickerOpen(false)
  }

  function deleteCurrentFile() {
    if (!current) return
    const n = countOf(current.id)
    if (!window.confirm(`「${current.name}」を削除しますか？\n中の記録${n}件も消えます。`)) return
    setRecords((prev) => prev.filter((r) => r.fileId !== current.id))
    setFiles((prev) => prev.filter((f) => f.id !== current.id))
    setCurrentFileId(undefined)
  }

  function clearShown() {
    const label = current ? `「${current.name}」の記録` : 'メモの記録'
    if (!window.confirm(`${label}をすべて消しますか？`)) return
    setRecords((prev) => prev.filter((r) => r.fileId !== current?.id))
  }

  return (
    <div className="qc-history">
      <div className="qc-records-head">
        <span className="field-label">保存先</span>
        <button
          type="button"
          className="qc-records-file"
          onClick={() => (locked ? onUnlock() : setPickerOpen((o) => !o))}
        >
          📁 {current ? current.name : 'メモ（ファイルなし）'}
          <span className="qc-spec-caret">{locked ? '🔒 現場ファイル' : pickerOpen ? '▲' : '▼'}</span>
        </button>
      </div>

      {pickerOpen && (
        <div className="qc-records-picker">
          <button
            type="button"
            className={`qc-records-option${!current ? ' active' : ''}`}
            onClick={() => {
              setCurrentFileId(undefined)
              setPickerOpen(false)
            }}
          >
            <span>メモ（ファイルなし）</span>
            <span className="qc-records-count">{countOf(undefined)}件</span>
          </button>
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`qc-records-option${f.id === current?.id ? ' active' : ''}`}
              onClick={() => {
                setCurrentFileId(f.id)
                setPickerOpen(false)
              }}
            >
              <span>📁 {f.name}</span>
              <span className="qc-records-count">{countOf(f.id)}件</span>
            </button>
          ))}
          {naming === 'new' ? null : (
            <button type="button" className="qc-records-add" onClick={() => startNaming('new')}>
              ＋ 新しい現場ファイル
            </button>
          )}
        </div>
      )}

      {naming && (
        <div className="qc-records-name">
          <input
            autoFocus
            type="text"
            placeholder={naming === 'new' ? '現場名（例: ○○ビル 3F）' : 'ファイル名'}
            value={nameDraft}
            maxLength={40}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
            }}
          />
          <button type="button" className="qc-records-ok" onClick={commitName}>
            {naming === 'new' ? '作成' : '変更'}
          </button>
          <button type="button" className="qc-history-clear" onClick={() => setNaming(null)}>
            やめる
          </button>
        </div>
      )}

      {current && !naming && (
        <div className="qc-records-actions">
          <button type="button" className="qc-history-clear" onClick={() => startNaming('rename')}>
            名前を変える
          </button>
          <button type="button" className="qc-history-clear danger" onClick={deleteCurrentFile}>
            ファイルを削除
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="qc-records-empty">＝を押すと、ここに計算が記録されます</p>
      ) : (
        <>
          {shown.map((r) => (
            <div key={r.id} className="qc-record">
              <button
                type="button"
                className="qc-history-row"
                onClick={() => setOpenId((id) => (id === r.id ? null : r.id))}
              >
                <span className="qc-history-time">{timeLabel(r.at)}</span>
                <span className="qc-history-sum">
                  {r.note && <span className="qc-record-note">{r.note}</span>}
                  {r.summary}
                </span>
                <b>L {r.cut}</b>
              </button>
              {openId === r.id && (
                <div className="qc-record-edit">
                  <input
                    type="text"
                    placeholder="一言メモ（例: 2F 給水 ①）"
                    value={r.note ?? ''}
                    maxLength={40}
                    onChange={(e) => {
                      const note = e.target.value
                      setRecords((prev) => prev.map((x) => (x.id === r.id ? { ...x, note: note || undefined } : x)))
                    }}
                  />
                  <button
                    type="button"
                    className="qc-history-clear danger"
                    onClick={() => setRecords((prev) => prev.filter((x) => x.id !== r.id))}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="qc-records-foot">
            <span>
              {locked
                ? `${shown.length}件（無料版は${FREE_MEMO_SHOWN}件まで）`
                : `${shown.length}件（最大${current ? FILE_MAX : MEMO_MAX}件）`}
            </span>
            <button type="button" className="qc-history-clear" onClick={clearShown}>
              すべて消す
            </button>
          </div>
        </>
      )}
      {locked && (
        <div className="qc-records-upsell">
          <span>職長プランなら メモ{MEMO_MAX}件・現場ファイル（1つ{FILE_MAX}件）</span>
          <button type="button" className="qc-records-ok" onClick={onUnlock}>
            職長プランについて
          </button>
        </div>
      )}
    </div>
  )
}
