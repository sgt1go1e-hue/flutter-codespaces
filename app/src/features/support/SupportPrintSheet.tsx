// サポート架台図面の印刷／PDF用シート。A4縦に1〜3台を縦に並べる。
//
// PDF化の仕組みはアイソメ図の材料集計・発注書と同じで、印刷専用のDOMを
// body直下へportalし、@media print で表示を切り替えて window.print() する
// (このアプリにPDF生成ライブラリは入っておらず、新しい依存も足さない)。
// 現場では即印刷できないことが多いため、押してすぐ印刷ダイアログを開かず、
// まず画面プレビューを出してから改めて印刷/PDF化する(他の出力と同じ流れ)。
//
// 【1台あたりの大きさの決め方】
// 図(SupportFigure)は縦が固定で、横は架台の総長で決まる。つまり長い架台ほど
// 横長になる。枠は必ず用紙の横幅いっぱいを使い(2列に割ると長い架台ほど
// 小さくなるため)、高さだけを「1ページに何台」で等分する。
//
// 以前は「用紙の幅いっぱいに描いたときの高さ」をそのまま枠の高さにして
// 入るだけ詰める方式にしたが、図はもともと縦長(短い架台だと幅の1.6倍の高さに
// なる)なので、結局どれも1ページ1台にしかならなかった。1枚に何台も載せたい
// 場合は、図を小さくする以外に方法がない。そこで台数を選んでもらい、
// その台数で用紙の高さを等分する形に戻した。
//
// 台数を増やすと文字は小さくなる(実測: 1台=8〜18pt / 2台=約9pt / 3台=約6pt)。
// 4台は4pt程度まで落ちて現場では読めなかったので選択肢から外している。

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import SupportFigure from './SupportFigure'
import type { HangerDesign } from './hangerDesign'

/** 用紙1枚に入れる高さ(mm)。styles.css の .support-print-page と必ず揃える。 */
const PAGE_H_MM = 236
/** 枠の幅(mm)。A4縦210mm − 左右8mmの余白。枠は必ず用紙の幅いっぱいを使う。 */
const BOX_W_MM = 194
/** 枠と枠の間隔(mm)。styles.css の gap と揃える。 */
const GAP_MM = 4

/** 1ページに並べる台数。多いほど1台は小さくなる。 */
export type SupportPerPage = 1 | 2 | 3
export const SUPPORT_PER_PAGE_OPTIONS: SupportPerPage[] = [1, 2, 3]

interface Props {
  designs: HangerDesign[]
  perPage: SupportPerPage
  onClose: () => void
}

/** 1台ぶんの枠の高さ(mm)。用紙の高さを台数で等分する。 */
export function boxHeightMm(perPage: SupportPerPage): number {
  return (PAGE_H_MM - GAP_MM * (perPage - 1)) / perPage
}

/** 台数ぶんずつページへ分ける。並び順は変えない(現場で番号順に見るため)。 */
export function paginateDesigns(
  designs: HangerDesign[],
  perPage: SupportPerPage,
): HangerDesign[][] {
  const pages: HangerDesign[][] = []
  for (let i = 0; i < designs.length; i += perPage) pages.push(designs.slice(i, i + perPage))
  return pages
}

export function SupportPrintSheet({ designs, perPage, onClose }: Props) {
  const pages = paginateDesigns(designs, perPage)
  const boxH = boxHeightMm(perPage)

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
    <div className="support-print-sheet preview">
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
            <div
              className="support-print-box"
              key={di}
              // 高さは mm 直指定ではなく枠の幅に対する比で持たせる。こうすると
              // 用紙より狭い画面プレビューでも同じ縦横比で見える。max-height は
              // 万一 aspect-ratio が効かない環境でも用紙からあふれないための保険。
              style={{ aspectRatio: `${BOX_W_MM} / ${boxH}`, maxHeight: `${boxH}mm` }}
            >
              {/* 複数台並ぶと figure だけでは見分けが付きにくいので通し番号を添える */}
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
