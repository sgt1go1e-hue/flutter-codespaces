// サポート架台図面の印刷／PDF用シート。A4縦に1台/2台/4台を並べる。
//
// PDF化の仕組みはアイソメ図の材料集計・発注書と同じで、印刷専用のDOMを
// body直下へportalし、@media print で表示を切り替えて window.print() する
// (このアプリにPDF生成ライブラリは入っておらず、新しい依存も足さない)。
// 現場では即印刷できないことが多いため、押してすぐ印刷ダイアログを開かず、
// まず画面プレビューを出してから改めて印刷/PDF化する(他の出力と同じ流れ)。

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import SupportFigure from './SupportFigure'
import type { HangerDesign } from './hangerDesign'

/** 1ページに並べる台数。図の縦横比の都合で、少ないほど1台が大きく出る。 */
export type SupportPerPage = 1 | 2 | 4

interface Props {
  designs: HangerDesign[]
  perPage: SupportPerPage
  onClose: () => void
}

export function SupportPrintSheet({ designs, perPage, onClose }: Props) {
  const pages: HangerDesign[][] = []
  for (let i = 0; i < designs.length; i += perPage) pages.push(designs.slice(i, i + perPage))

  // プレビュー中だけブラウザ標準のピンチズームを許可する(現場では細かい字を
  // 拡大して確認したいため。アプリ本体は作図のピンチ操作と競合しないよう
  // 普段は禁止している)。
  useEffect(() => {
    const el = document.querySelector('meta[name="viewport"]')
    const original = el?.getAttribute('content') ?? null
    el?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover',
    )
    return () => {
      if (original != null) el?.setAttribute('content', original)
    }
  }, [])

  return createPortal(
    <div className={`support-print-sheet preview per-${perPage}`}>
      <div className="preview-toolbar">
        <button className="preview-print-btn" onClick={() => window.print()}>
          印刷 / PDFで保存
        </button>
        <button className="preview-close-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
      {pages.map((chunk, pi) => (
        <div className="support-print-page" key={pi}>
          {chunk.map((d, di) => (
            <div className="support-print-box" key={di}>
              {/* 4台並ぶと figure だけでは見分けが付きにくいので通し番号を添える */}
              <span className="support-print-no">No.{pi * perPage + di + 1}</span>
              <SupportFigure
                design={d}
                className="support-print-figure"
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
}
