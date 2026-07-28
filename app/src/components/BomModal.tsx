import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { bomToCsv, computeAssemblyTable, type Bom } from '../lib/bom'
import { chunkSegmentsForPrint, segmentsPerIsoPage } from '../lib/isoPagination'
import { PrintIsometric } from './PrintIsometric'
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
  /** 区間ごとの実効相番。芯々未入力または相番表示OFF中の区間は含まれない。 */
  assemblyNumberById: Record<string, number>
  /** 相番の手動上書き（undefinedで自動採番に戻す） */
  onRenumber: (id: string, num: number | undefined) => void
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
  assemblyNumberById,
  onRenumber,
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
  const a3Landscape1Page = paperSize === 'a3' && orientation === 'landscape' && compact
  // 「PDFで見る」は、現場ではすぐに印刷できず「まず画面で確認→LINE等で
  // 加工場へ送る→印刷」という順番で使うため、押してすぐ印刷ダイアログを
  // 開くのではなく、まず画面プレビューを表示する。実際の印刷/PDF化は
  // プレビュー内のボタンから改めて行う。
  const [previewOpen, setPreviewOpen] = useState(false)

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
          const isoPages = compact
            ? segments.length > 0
              ? [segments]
              : []
            : chunkSegmentsForPrint(segments, segmentsPerIsoPage(paperSize))
          const isoBlock = isoPages.length > 0 && (
            <>
              {isoPages.map((pageSegments, i) => (
                <div className="print-iso-wrap" key={i}>
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
                  />
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
              {pipesBlock}
              {fittingsBlock}
              {flangesBlock}
              {assemblyBlock}
            </>
          )
        })()}
        </div>
      </div>,
      document.body,
    )}
    </>
  )
}
