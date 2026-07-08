import { Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import { bomToCsv, type Bom } from '../lib/bom'
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
  onClose: () => void
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function BomModal({
  bom,
  segments,
  effectiveById,
  crossoverGaps,
  cutById,
  onClose,
}: Props) {
  const empty =
    bom.pipes.length === 0 &&
    bom.fittings.length === 0 &&
    bom.flanges.length === 0

  // PDF/印刷レイアウト: 詳細(複数ページ, パイプ1本ごとの明細つき) か
  // 1ページ集約(アイソメ図を縮小・パイプ明細は小計のみ、改ページなし) かを選べる。
  const [compact, setCompact] = useState(false)

  function downloadCsv() {
    // Excel(日本語)で文字化けしないよう BOM 付き UTF-8 で出力
    const csv = '﻿' + bomToCsv(bom)
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
        <div className="bom-actions">
          <button className="bom-pdf" onClick={printAsPdf} disabled={empty}>
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
        画面には出さず、印刷/PDF化(window.print)のときだけ表示する。 */}
    {createPortal(
      <div className={`bom-print-only${compact ? ' compact' : ''}`}>
        <h1>配管アイソメ図 材料集計表</h1>
        <p className="print-meta">作成日: {dateStr}</p>

        {segments.length > 0 && (
          <div className="print-iso-wrap">
            <h2>アイソメ図</h2>
            <PrintIsometric
              segments={segments}
              effectiveById={effectiveById}
              crossoverGaps={crossoverGaps}
              cutById={cutById}
            />
          </div>
        )}

        {bom.pipes.length > 0 && (
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
              <tbody>
                {bom.pipes.map((p, i) => (
                  <Fragment key={i}>
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
                  </Fragment>
                ))}
              </tbody>
            </table>
          </>
        )}

        {bom.fittings.length > 0 && (
          <>
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
          </>
        )}

        {bom.flanges.length > 0 && (
          <>
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
          </>
        )}
      </div>,
      document.body,
    )}
    </>
  )
}
