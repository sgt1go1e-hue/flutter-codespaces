// サポート架台図面の印刷／PDF用シート。A4縦、1台ずつ用紙の横幅いっぱいに描く。
//
// PDF化の仕組みはアイソメ図の材料集計・発注書と同じで、印刷専用のDOMを
// body直下へportalし、@media print で表示を切り替えて window.print() する
// (このアプリにPDF生成ライブラリは入っておらず、新しい依存も足さない)。
// 現場では即印刷できないことが多いため、押してすぐ印刷ダイアログを開かず、
// まず画面プレビューを出してから改めて印刷/PDF化する(他の出力と同じ流れ)。
//
// 【1台あたりの高さの決め方】
// 図(SupportFigure)は縦が固定で、横は架台の総長で決まる。つまり長い架台ほど
// 横長になる。「1ページに何台」と決めて枠を等分すると、枠の縦横比が図と合わず、
// 図は枠の中で縦に頭打ちになって左右に大きな余白が残る＝小さく印刷される
// (実測: 4等分だと用紙幅194mmに対して図は31〜95mmしか使えず、寸法の文字は
//  4pt程度まで縮んでいた)。
// そこで枠を等分するのをやめ、1台ごとに「用紙の横幅いっぱいに描いたときの高さ」
// を持たせ、入るだけ1ページに詰める。長い架台ほど平たくなるので1ページに多く入り、
// 短い架台は大きく1台だけ入る、という自然な詰まり方になる。

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import SupportFigure, { figureAspect } from './SupportFigure'
import type { HangerDesign } from './hangerDesign'

/** 用紙1枚に入れる高さ(mm)。styles.css の .support-print-page と必ず揃える。 */
const PAGE_H_MM = 236
/** 枠の幅(mm)。A4縦210mm − 左右8mmの余白。枠は必ず用紙の幅いっぱいを使う。 */
const BOX_W_MM = 194
/** 枠の内側の余白＋枠線(上下・左右それぞれの合計, mm)。styles.css と揃える。 */
const BOX_PAD_MM = 4.5
/** 図が実際に使える横幅(mm) */
const FIG_W_MM = BOX_W_MM - BOX_PAD_MM
/** 枠と枠の間隔(mm)。styles.css の gap と揃える。 */
const GAP_MM = 4

export type SupportPrintMode = 'pack' | 'one'

interface Props {
  designs: HangerDesign[]
  /** 'pack'=入るだけ詰める / 'one'=1台ずつ1ページ使う(いちばん大きく出る) */
  mode: SupportPrintMode
  onClose: () => void
}

interface Placed {
  design: HangerDesign
  /** 用紙上での高さ(mm) */
  heightMm: number
  /** 通し番号(1始まり) */
  no: number
}

/** 用紙の横幅いっぱいに図を描いたときの、枠の高さ(mm)。1ページには必ず収める。 */
function boxHeightMm(d: HangerDesign): number {
  const aspect = figureAspect(d) // 幅/高さ
  if (!Number.isFinite(aspect) || aspect <= 0) return PAGE_H_MM
  return Math.min(PAGE_H_MM, FIG_W_MM / aspect + BOX_PAD_MM)
}

/** 高さを見ながらページへ詰める。並び順は変えない(現場で番号順に見るため)。 */
export function paginateDesigns(designs: HangerDesign[], mode: SupportPrintMode): Placed[][] {
  const pages: Placed[][] = []
  let page: Placed[] = []
  let used = 0
  designs.forEach((design, i) => {
    const heightMm = mode === 'one' ? PAGE_H_MM : boxHeightMm(design)
    const need = heightMm + (page.length > 0 ? GAP_MM : 0)
    if (page.length > 0 && used + need > PAGE_H_MM) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push({ design, heightMm, no: i + 1 })
    used += page.length > 1 ? heightMm + GAP_MM : heightMm
  })
  if (page.length > 0) pages.push(page)
  return pages
}

export function SupportPrintSheet({ designs, mode, onClose }: Props) {
  const pages = paginateDesigns(designs, mode)

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
          {chunk.map((p) => (
            <div
              className="support-print-box"
              key={p.no}
              // 高さは台ごとに変わるのでここで指定する(図の縦横比から求めた値。
              // 上のコメント参照)。mm直指定ではなく枠の幅に対する比で持たせる
              // ことで、用紙より狭い画面プレビューでも同じ縦横比で見える。
              // max-height は、万一 aspect-ratio が効かない環境でも用紙から
              // あふれないようにするための保険。
              style={{
                aspectRatio: `${BOX_W_MM} / ${p.heightMm}`,
                maxHeight: `${p.heightMm}mm`,
              }}
            >
              {/* 複数台並ぶと figure だけでは見分けが付きにくいので通し番号を添える */}
              <span className="support-print-no">No.{p.no}</span>
              <SupportFigure
                design={p.design}
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
