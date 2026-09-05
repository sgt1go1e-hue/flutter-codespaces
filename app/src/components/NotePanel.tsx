import { useState } from 'react'
import type { Segment } from '../types'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import type { SegmentNote } from '../lib/shareFile'
import { getPipeType, getFitting } from '../data/masters'

interface Props {
  segment: Segment
  effective?: Effective
  cut?: CutResult
  notes: SegmentNote[]
  onAddNote: (text: string) => void
  onClose: () => void
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// 「注記のみ」権限で線を選んだときに、通常の寸法・属性パネル(SegmentPanel)の
// 代わりに表示するパネル。図面本体(継手・寸法等)は一切編集できず、その線への
// メモ(テキスト)の追加・閲覧だけができる。現場から「ここ違う」等のフィード
// バックを返す用途を想定した、あえてシンプルな作り。
export function NotePanel({ segment, effective, cut, notes, onAddNote, onClose }: Props) {
  const [text, setText] = useState('')
  const pipeShort = effective?.pipeType
    ? (getPipeType(effective.pipeType)?.short ?? effective.pipeType)
    : '—'
  const sizeText = segment.size ?? '—'
  const fittingName = effective ? (getFitting(effective.fitting)?.name ?? effective.fitting) : '—'
  const dimText =
    cut?.status === 'ok'
      ? `切り寸法 ${cut.cut}mm`
      : segment.centerLength != null
        ? `芯々 ${segment.centerLength}mm`
        : '寸法未入力'

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    onAddNote(trimmed)
    setText('')
  }

  return (
    <section className="attr-panel open note-panel">
      <div className="panel-header static">
        <span className="panel-summary">
          <b>{pipeShort}</b>
          <b>{sizeText}</b>
          <span className="sum-fit">{fittingName}</span>
        </span>
        <button type="button" className="panel-close" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="panel-body">
        <p className="panel-hint note-panel-hint">
          この図面は「注記のみ」で共有されています。構成・寸法は変更できませんが、この線にメモを追加できます。
        </p>
        <div className="note-panel-dim">{dimText}</div>

        <ul className="note-list">
          {notes.length === 0 && <li className="note-empty">まだメモはありません</li>}
          {notes.map((n) => (
            <li key={n.id} className="note-item">
              <div className="note-item-text">{n.text}</div>
              <div className="note-item-date">{formatDateTime(n.createdAt)}</div>
            </li>
          ))}
        </ul>

        <div className="note-add">
          <textarea
            className="note-input"
            placeholder="例: ここのサイズが現場と違います"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <button type="button" className="note-add-btn" onClick={submit} disabled={!text.trim()}>
            メモを追加
          </button>
        </div>
      </div>
    </section>
  )
}
