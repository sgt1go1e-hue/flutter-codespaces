import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { bomToCsv, computeAssemblyTable, type Bom } from '../lib/bom'
import { chunkSegmentsForPrint, segmentsPerIsoPage } from '../lib/isoPagination'
import { PrintIsometric } from './PrintIsometric'
import { OrderDocModal } from './OrderDocModal'
import type { OrderDocKind, PipeProcurementDefaults } from '../lib/orderDoc'
import type { Segment } from '../types'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'

interface Props {
  bom: Bom
  segments: Segment[]
  effectiveById: Record<string, Effective>
  crossoverGaps: Record<string, number[]>
  cutById: Record<string, CutResult>
  /** 配管設定(ベース)の勾配(1/N のN)。区間自身に個別上書きが無いときに使う。 */
  baseSlopeDenom?: number
  /** 通り寸法(曲がるまでの全体の芯々)を図に出すか。画面の切替と共通。 */
  showThroughDim?: boolean
  /** 区間ごとの実効相番。芯々未入力または相番表示OFF中の区間は含まれない。 */
  assemblyNumberById: Record<string, number>
  /** 相番の手動上書き（undefinedで自動採番に戻す） */
  onRenumber: (id: string, num: number | undefined) => void
  /** 直管の調達属性(色・ねじ加工・定尺長)の既定値。発注書の品目分けに使う。 */
  procurementDefaults?: PipeProcurementDefaults
  /** 発注書・見積依頼書の「現場名」の初期値(この図面が入っているフォルダ名)。 */
  siteName?: string
  onClose: () => void
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function BomModal({
  bom,
  segments,
  effectiveById,
  crossoverGaps,
  cutById,
  baseSlopeDenom,
  showThroughDim = false,
  assemblyNumberById,
  onRenumber,
  procurementDefaults,
  siteName = '',
  onClose,
}: Props) {
  const empty =
    bom.pipes.length === 0 &&
    bom.fittings.length === 0 &&
    bom.flanges.length === 0

  const assemblyTable = computeAssemblyTable(segments, effectiveById, cutById, assemblyNumberById)

  // PDF/印刷レイアウト: 詳細(複数ページ, パイプ1本ごとの明細つき) か
  // 1ページ集約(アイソメ図を縮小・パイプ明細は小計のみ、改ページなし) かを選べる。
  const [compact, setCompact] = useState(false)
  // 用紙サイズ・向き。既定はA4縦（従来の出力と同じ）。A3横 + 1ページ集約が
  // 選ばれたときだけ、左2/3にアイソメ図・右1/3に明細を並べる専用レイアウトを
  // 使う（それ以外の組み合わせは従来通りの出力のまま変更しない）。
  const [paperSize, setPaperSize] = useState<'a4' | 'a3'>('a4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  // 「詳細」モードでは区間数の目安(A4=10本/A3=20本)でアイソメ図をページ分割
  // するが、1枚に収めたい(加工場に渡す図が割れていると分かりにくい)場合が
  // 多いため、分割せず1枚に収めるかを選べるようにする。分割しない場合は
  // 図が縮むだけで、明細(パイプ1本ごとの切り寸法)は詳細のまま残る
  // （「1ページに集約」は明細も小計だけに省略されてしまうため、それとは別物）。
  const [splitIso, setSplitIso] = useState(true)
  const a3Landscape1Page = paperSize === 'a3' && orientation === 'landscape' && compact
  // 「分割する」を選んだままだとアイソメ図が何ページに分かれるか（設定画面で
  // 事前に知らせるため。実際の分割は印刷レイアウト側で同じ関数を使って行う）。
  const isoPageCount =
    segments.length > 0 ? chunkSegmentsForPrint(segments, segmentsPerIsoPage(paperSize)).length : 0
  // 「PDFで見る」は、現場ではすぐに印刷できず「まず画面で確認→LINE等で
  // 加工場へ送る→印刷」という順番で使うため、押してすぐ印刷ダイアログを
  // 開くのではなく、まず画面プレビューを表示する。実際の印刷/PDF化は
  // プレビュー内のボタンから改めて行う。
  const [previewOpen, setPreviewOpen] = useState(false)
  // 材料屋へ渡す帳票(発注書/見積もり依頼書)の作成ダイアログ。開いている間は
  // この集計結果をそのまま流し込む(集計ロジック側は一切変えない)。
  const [orderDocKind, setOrderDocKind] = useState<OrderDocKind | null>(null)

  // アプリ全体はキャンバス独自のピンチズームと競合しないよう viewport で
  // ピンチズームを禁止している(user-scalable=no)が、PDFプレビュー中は
  // 逆に文字を拡大して確認したいという要望のため、プレビューを開いている
  // 間だけブラウザ標準のピンチズームを許可し、閉じたら元に戻す。
  useEffect(() => {
    if (!previewOpen) return
    const meta = document.querySelector('meta[name="viewport"]')
    const original = meta?.getAttribute('content') ?? null
    meta?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover',
    )
    return () => {
      if (original != null) meta?.setAttribute('content', original)
    }
  }, [previewOpen])

  function downloadCsv() {
    // Excel(日本語)で文字化けしないよう BOM 付き UTF-8 で出力
    const csv = '﻿' + bomToCsv(bom, assemblyTable)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `bom_${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // PDF化: 印刷専用レイアウト(.bom-print-only)だけを表示する印刷スタイルに切り替えて
  // ブラウザの印刷ダイアログを開く。iPad/iPhoneではその場で「PDFに保存」を選べる。
  function printAsPdf() {
    window.print()
  }

  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <>
    <div className="disclaimer-overlay" onClick={onClose}>
      <div className="bom-card" onClick={(e) => e.stopPropagation()}>
        <div className="disclaimer-header">材料集計（BOM）</div>
        <div className="bom-body">
          {empty && (
            <p className="panel-hint">
              計上できる材料がありません。芯々寸法とサイズを入力すると集計されます。
            </p>
          )}

          {bom.pipes.length > 0 && (
            <>
              <h4 className="bom-section">パイプ 切り寸法（サイズ別）</h4>
              {bom.pipes.map((p, i) => (
                <div className="pipe-group" key={i}>
                  <div className="pipe-group-head">
                    <span className="pipe-size">
                      {p.pipeShort} {p.size ?? '—'}
                    </span>
                    <span className="pipe-sub">
                      {p.count}本 ・ 計 {round1(p.totalMm / 1000)}m
                    </span>
                  </div>
                  <div className="pipe-cuts">
                    {p.cuts.map((c, j) => (
                      <span className="cut-chip" key={j}>
                        {round1(c)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {bom.fittings.length > 0 && (
            <>
              <h4 className="bom-section">継手</h4>
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>品名</th>
                    <th>呼び径</th>
                    <th>接続方法</th>
                    <th className="num">数量</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.fittings.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td>{f.size}</td>
                      <td>{f.connection}</td>
                      <td className="num">{f.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {bom.flanges.length > 0 && (
            <>
              <h4 className="bom-section">フランジ</h4>
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>品名</th>
                    <th>呼び径</th>
                    <th>接続方法</th>
                    <th className="num">枚数</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.flanges.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td>{f.size}</td>
                      <td>{f.connection}</td>
                      <td className="num">{f.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {assemblyTable.length > 0 && (
            <>
              <h4 className="bom-section">相番対応表</h4>
              <p className="panel-hint">
                図面上は番号のみ表示中です。番号欄を編集すると、その区間の相番を
                手動で固定できます（空にすると自動採番に戻ります）。
              </p>
              <table className="bom-table assembly-table">
                <thead>
                  <tr>
                    <th className="num">番号</th>
                    <th>管種</th>
                    <th>呼び径</th>
                    <th>{'芯々/芯先'}</th>
                    <th className="num">寸法(mm)</th>
                    <th className="num">切り寸法(mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblyTable.map((a) => (
                    <tr key={a.id}>
                      <td className="num">
                        <input
                          className="assembly-number-cell"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          value={a.number}
                          onChange={(e) => {
                            const v = e.target.value
                            onRenumber(
                              a.id,
                              v === '' ? undefined : Math.max(1, Math.round(Number(v))),
                            )
                          }}
                        />
                      </td>
                      <td>{a.pipeShort}</td>
                      <td>{a.size ?? '—'}</td>
                      <td>{a.mode}</td>
                      <td className="num">{a.center != null ? round1(a.center) : '—'}</td>
                      <td className="num">{a.cut != null ? round1(a.cut) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="pdf-mode-row">
          <button
            className={`pdf-mode-btn${!compact ? ' active' : ''}`}
            onClick={() => setCompact(false)}
          >
            詳細（複数ページ）
          </button>
          <button
            className={`pdf-mode-btn${compact ? ' active' : ''}`}
            onClick={() => setCompact(true)}
          >
            1ページに集約
          </button>
        </div>
        <div className="pdf-paper-row">
          <div className="pdf-paper-group">
            <span className="pdf-paper-label">用紙サイズ</span>
            <button
              className={`pdf-mode-btn${paperSize === 'a4' ? ' active' : ''}`}
              onClick={() => setPaperSize('a4')}
            >
              A4
            </button>
            <button
              className={`pdf-mode-btn${paperSize === 'a3' ? ' active' : ''}`}
              onClick={() => setPaperSize('a3')}
            >
              A3
            </button>
          </div>
          <div className="pdf-paper-group">
            <span className="pdf-paper-label">向き</span>
            <button
              className={`pdf-mode-btn${orientation === 'portrait' ? ' active' : ''}`}
              onClick={() => setOrientation('portrait')}
            >
              縦
            </button>
            <button
              className={`pdf-mode-btn${orientation === 'landscape' ? ' active' : ''}`}
              onClick={() => setOrientation('landscape')}
            >
              横
            </button>
          </div>
        </div>
        {/* 「1ページに集約」は元々アイソメ図を分割しないため、この選択肢は
            「詳細（複数ページ）」のときだけ意味を持つ。 */}
        {!compact && (
          <div className="pdf-paper-row">
            <div className="pdf-paper-group">
              <span className="pdf-paper-label">アイソメ図</span>
              <button
                className={`pdf-mode-btn${!splitIso ? ' active' : ''}`}
                onClick={() => setSplitIso(false)}
              >
                1枚に収める
              </button>
              <button
                className={`pdf-mode-btn${splitIso ? ' active' : ''}`}
                onClick={() => setSplitIso(true)}
              >
                分割する
              </button>
            </div>
          </div>
        )}
        {!compact && splitIso && isoPageCount > 1 && (
          <p className="panel-hint pdf-a3-hint">
            この図面は{segments.length}区間あるため、アイソメ図が{isoPageCount}
            ページに分かれます。1枚にしたい場合は「1枚に収める」を選んでください（図は小さくなりますが、明細はそのままです）。
          </p>
        )}
        {a3Landscape1Page && (
          <p className="panel-hint pdf-a3-hint">
            A3横向き・1ページに集約: 左2/3にアイソメ図、右1/3に明細を並べた1枚のPDFになります。
          </p>
        )}
        <div className="bom-actions">
          <button className="bom-pdf" onClick={() => setPreviewOpen(true)} disabled={empty}>
            PDFで見る
          </button>
          <button className="bom-csv" onClick={downloadCsv} disabled={empty}>
            CSVダウンロード
          </button>
          <button className="bom-csv" onClick={() => setOrderDocKind('order')} disabled={empty}>
            発注書PDF作成
          </button>
          <button className="bom-csv" onClick={() => setOrderDocKind('quote')} disabled={empty}>
            見積もり依頼書PDF作成
          </button>
          <button className="disclaimer-close" onClick={onClose}>
            完了
          </button>
        </div>
      </div>
    </div>

    {/* 印刷専用レイアウト。position:fixed のモーダル(disclaimer-overlay)の中に
        置くと、印刷時にその祖先のfixed配置(=1ページ分の高さに固定)へ引きずられて
        2ページ目以降が印刷されなくなるため、body直下へ portal で逃がす。
        画面には出さず、画面プレビュー(preview)または印刷/PDF化のときだけ表示する。 */}
    {createPortal(
      <div
        className={`bom-print-only${compact ? ' compact' : ''}${previewOpen ? ' preview' : ''}${a3Landscape1Page ? ' a3-landscape' : ''} paper-${paperSize}-${orientation}`}
      >
        <div className="preview-toolbar">
          <button className="preview-print-btn" onClick={printAsPdf}>
            印刷 / PDFで保存
          </button>
          <button className="preview-close-btn" onClick={() => setPreviewOpen(false)}>
            閉じる
          </button>
        </div>
        <div className="preview-page">
        <h1>配管アイソメ図 材料集計表</h1>
        <p className="print-meta">作成日: {dateStr}</p>

        {(() => {
          // アイソメ図・各明細表のJSXは、通常レイアウト(縦積み・複数ページ)と
          // A3横1ページレイアウト(左2/3アイソメ図・右1/3明細)の両方で共通の
          // ものを使う（データ・計算ロジックは一切変えず、配置だけを分ける）。
          //
          // 「詳細（複数ページ）」モード(!compact)だけ、アイソメ図を区間数の
          // 目安(A4=10本・A3=20本)でページ単位に分割する。線(セグメント)の
          // 途中では絶対に切れないよう、必ずセグメント単位でまとめる
          // （chunkSegmentsForPrint）。「1ページに集約」(compact)や
          // A3横1ページレイアウトは、これまで通り1枚のSVGに全体を収める。
          const isoPages =
            compact || !splitIso
              ? segments.length > 0
                ? [segments]
                : []
              : chunkSegmentsForPrint(segments, segmentsPerIsoPage(paperSize))
          const isoBlock = isoPages.length > 0 && (
            <>
              {isoPages.map((pageSegments, i) => (
                // print-iso-inner は印刷時の上下中央寄せ(table-cell +
                // vertical-align:middle)のための入れ物。画面プレビューでは
                // ただのdivとして何も影響しない。
                <div className="print-iso-wrap" key={i}>
                  <div className="print-iso-inner">
                    <h2>
                      アイソメ図
                      {isoPages.length > 1 ? `（${i + 1}/${isoPages.length}）` : ''}
                    </h2>
                    <PrintIsometric
                      segments={pageSegments}
                      effectiveById={effectiveById}
                      crossoverGaps={crossoverGaps}
                      cutById={cutById}
                      baseSlopeDenom={baseSlopeDenom}
                      showThroughDim={showThroughDim}
                    />
                  </div>
                </div>
              ))}
            </>
          )

          const pipesBlock = bom.pipes.length > 0 && (
            <>
              <h2>パイプ（切り寸法明細）</h2>
              <table>
                <thead>
                  <tr>
                    <th>管種</th>
                    <th>呼び径</th>
                    <th>切り寸法(mm)</th>
                    <th>本数</th>
                  </tr>
                </thead>
                {bom.pipes.map((p, i) => (
                  // サイズごとにtbodyを分けることで、ページの都合で分割が
                  // 必要なとき(避けきれないとき)以外は、1サイズ分の
                  // 切り寸法一覧+小計行がまとまって同じページに収まる
                  // ようにする(print-pipe-group, break-inside: avoid)。
                  <tbody className="print-pipe-group" key={i}>
                    {!compact &&
                      p.cuts.map((c, j) => (
                        <tr key={j}>
                          <td>{p.pipeShort}</td>
                          <td>{p.size ?? '—'}</td>
                          <td>{round1(c)}</td>
                          <td>1</td>
                        </tr>
                      ))}
                    <tr className="print-subtotal">
                      <td>{p.pipeShort}</td>
                      <td>{p.size ?? '—'}</td>
                      <td>{compact ? '計' : '小計'} {round1(p.totalMm)}</td>
                      <td>{p.count}</td>
                    </tr>
                  </tbody>
                ))}
              </table>
            </>
          )

          const fittingsBlock = bom.fittings.length > 0 && (
            <div className="bom-section-block">
              <h2>継手</h2>
              <table>
                <thead>
                  <tr>
                    <th>品名</th>
                    <th>呼び径</th>
                    <th>接続方法</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.fittings.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td>{f.size}</td>
                      <td>{f.connection}</td>
                      <td>{f.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )

          const flangesBlock = bom.flanges.length > 0 && (
            <div className="bom-section-block">
              <h2>フランジ</h2>
              <table>
                <thead>
                  <tr>
                    <th>品名</th>
                    <th>呼び径</th>
                    <th>接続方法</th>
                    <th>枚数</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.flanges.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td>{f.size}</td>
                      <td>{f.connection}</td>
                      <td>{f.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )

          const assemblyBlock = assemblyTable.length > 0 && (
            <>
              <h2>相番対応表</h2>
              <table>
                <thead>
                  <tr>
                    <th>番号</th>
                    <th>管種</th>
                    <th>呼び径</th>
                    <th>{'芯々/芯先'}</th>
                    <th>寸法(mm)</th>
                    <th>切り寸法(mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblyTable.map((a) => (
                    <tr key={a.id}>
                      <td>{a.number}</td>
                      <td>{a.pipeShort}</td>
                      <td>{a.size ?? '—'}</td>
                      <td>{a.mode}</td>
                      <td>{a.center != null ? round1(a.center) : '—'}</td>
                      <td>{a.cut != null ? round1(a.cut) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )

          if (a3Landscape1Page) {
            return (
              <div className="a3-sheet-body">
                <div className="a3-iso-col">{isoBlock}</div>
                <div className="a3-detail-col">
                  {pipesBlock}
                  {fittingsBlock}
                  {flangesBlock}
                  {assemblyBlock}
                </div>
              </div>
            )
          }
          return (
            <>
              {isoBlock}
              {/* 明細(BOM)側もアイソメ図と同じく、印刷時に紙の上下中央へ
                  寄せる。中央寄せの仕組みは print-iso-inner と同じ
                  (bom-detail-inner を table-cell にする)。
                  中身が空のときに囲みだけ出すと、高さ指定だけが残って
                  白紙ページになってしまうため、1つでも表があるときだけ出す。 */}
              {(pipesBlock || fittingsBlock || flangesBlock || assemblyBlock) && (
                <div className="bom-detail-block">
                  <div className="bom-detail-inner">
                    {pipesBlock}
                    {fittingsBlock}
                    {flangesBlock}
                    {assemblyBlock}
                  </div>
                </div>
              )}
            </>
          )
        })()}
        </div>
      </div>,
      document.body,
    )}

    {orderDocKind && (
      <OrderDocModal
        kind={orderDocKind}
        bom={bom}
        segments={segments}
        effectiveById={effectiveById}
        cutById={cutById}
        procurementDefaults={procurementDefaults ?? {}}
        defaultSiteName={siteName}
        onClose={() => setOrderDocKind(null)}
      />
    )}
    </>
  )
}
