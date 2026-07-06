import { bomToCsv, type Bom } from '../lib/bom'

interface Props {
  bom: Bom
  onClose: () => void
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function BomModal({ bom, onClose }: Props) {
  const empty =
    bom.pipes.length === 0 &&
    bom.fittings.length === 0 &&
    bom.flanges.length === 0

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

  return (
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
                    <th className="num">数量</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.fittings.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td>{f.size}</td>
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
                    <th className="num">枚数</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.flanges.map((f, i) => (
                    <tr key={i}>
                      <td>{f.label}</td>
                      <td>{f.size}</td>
                      <td className="num">{f.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="bom-actions">
          <button className="bom-csv" onClick={downloadCsv} disabled={empty}>
            CSVダウンロード
          </button>
          <button className="disclaimer-close" onClick={onClose}>
            完了
          </button>
        </div>
      </div>
    </div>
  )
}
