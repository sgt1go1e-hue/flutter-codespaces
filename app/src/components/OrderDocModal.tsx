import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Segment } from '../types'
import type { Effective } from '../lib/inheritance'
import type { CutResult } from '../lib/cutlength'
import type { Bom } from '../lib/bom'
import {
  ORDER_DOC_TEXT,
  EMPTY_ORDER_DOC_META,
  buildOrderDocRows,
  computeOrderPipeGroups,
  formatDocDate,
  makeDocNo,
  type OrderDocKind,
  type OrderDocMeta,
  type PipeProcurementDefaults,
} from '../lib/orderDoc'
import { isCompanyInfoComplete, missingCompanyFields } from '../lib/companyInfo'
import { CompanyInfoFields, useCompanyInfo } from './CompanyInfoModal'

interface Props {
  kind: OrderDocKind
  bom: Bom
  segments: Segment[]
  effectiveById: Record<string, Effective>
  cutById: Record<string, CutResult>
  /** 直管の調達属性の既定値(配管設定)。区間に個別設定が無いときに使う。 */
  procurementDefaults: PipeProcurementDefaults
  /** 現場名の初期値(この図面が入っているフォルダ名)。 */
  defaultSiteName: string
  onClose: () => void
}

// 明細表の空行の下限。材料屋が手書きで追記できるよう数行残す。
const MIN_ITEM_ROWS = 14

/**
 * 発注書 / 見積もり依頼書の作成ダイアログ + 印刷専用レイアウト。
 *
 * PDF化の仕組みは既存の材料集計(BomModal)と同じで、印刷専用のDOMを
 * body直下へportalし、@media print で表示を切り替えて window.print() する
 * (このアプリにPDF生成ライブラリは入っておらず、新しい依存も足さない)。
 * 金額・単価・メーカーは一切扱わない。
 */
export function OrderDocModal({
  kind,
  bom,
  segments,
  effectiveById,
  cutById,
  procurementDefaults,
  defaultSiteName,
  onClose,
}: Props) {
  const text = ORDER_DOC_TEXT[kind]
  const [company, setCompany] = useCompanyInfo()
  const [meta, setMeta] = useState<OrderDocMeta>({
    ...EMPTY_ORDER_DOC_META,
    siteName: defaultSiteName,
  })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(!isCompanyInfoComplete(company))

  // 発行日・書類番号は開いた時点で確定させる(プレビュー中に日付が変わって
  // 印刷結果とずれることが無いように)。
  const issued = useMemo(() => new Date(), [])
  const docNo = useMemo(() => makeDocNo(kind, issued), [kind, issued])

  const pipeGroups = useMemo(
    () => computeOrderPipeGroups(segments, effectiveById, cutById, procurementDefaults),
    [segments, effectiveById, cutById, procurementDefaults],
  )
  const rows = useMemo(() => buildOrderDocRows(bom, pipeGroups), [bom, pipeGroups])
  const blankRows = Math.max(0, MIN_ITEM_ROWS - rows.length)

  const missing = missingCompanyFields(company)
  const canIssue = missing.length === 0 && !!meta.toName.trim() && rows.length > 0

  // 印刷時に材料集計(BomModal)の印刷レイアウトまで一緒に出てしまわないよう、
  // この帳票を開いている間だけ body に目印を付ける(CSS側で出し分ける)。
  useEffect(() => {
    document.body.classList.add('order-doc-open')
    return () => document.body.classList.remove('order-doc-open')
  }, [])

  // プレビュー中だけブラウザ標準のピンチズームを許可する(材料集計の
  // プレビューと同じ扱い。現場では細かい字を拡大して確認したいため)。
  useEffect(() => {
    if (!previewOpen) return
    const el = document.querySelector('meta[name="viewport"]')
    const original = el?.getAttribute('content') ?? null
    el?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover',
    )
    return () => {
      if (original != null) el?.setAttribute('content', original)
    }
  }, [previewOpen])

  const issuedText = issued.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <>
      <div className="disclaimer-overlay" onClick={onClose}>
        <div className="bom-card" onClick={(e) => e.stopPropagation()}>
          <div className="disclaimer-header">{text.title}を作成</div>
          <div className="bom-body">
            <p className="panel-hint">
              材料集計の内容から{text.title}を作ります。金額・単価は記載しません。
            </p>

            <h4 className="bom-section">宛先・現場</h4>
            <div className="panel-grid">
              <label className="field">
                <span className="field-label">
                  宛先（材料屋名）<span className="field-note">必須</span>
                </span>
                <input
                  type="text"
                  className="num-input"
                  placeholder="例: 〇〇配管資材"
                  value={meta.toName}
                  onChange={(e) => setMeta((m) => ({ ...m, toName: e.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">現場名</span>
                <input
                  type="text"
                  className="num-input"
                  placeholder="例: 〇〇ビル 3F 空調配管"
                  value={meta.siteName}
                  onChange={(e) => setMeta((m) => ({ ...m, siteName: e.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  {text.wantDateLabel}
                  <span className="field-note">任意</span>
                </span>
                <input
                  type="date"
                  className="num-input"
                  value={meta.wantDate}
                  onChange={(e) => setMeta((m) => ({ ...m, wantDate: e.target.value }))}
                />
              </label>
              {kind === 'order' && (
                <label className="field">
                  <span className="field-label">
                    納品場所<span className="field-note">任意</span>
                  </span>
                  <input
                    type="text"
                    className="num-input"
                    placeholder="例: 現場直送 / 〇〇倉庫"
                    value={meta.deliverTo}
                    onChange={(e) => setMeta((m) => ({ ...m, deliverTo: e.target.value }))}
                  />
                </label>
              )}
              <label className="field">
                <span className="field-label">
                  {kind === 'order' ? '連絡事項' : 'ご連絡先'}
                  <span className="field-note">任意</span>
                </span>
                <input
                  type="text"
                  className="num-input"
                  placeholder="例: 分納可。到着前に連絡ください"
                  value={meta.note}
                  onChange={(e) => setMeta((m) => ({ ...m, note: e.target.value }))}
                />
              </label>
            </div>

            <h4 className="bom-section">自社情報（差出人）</h4>
            {companyOpen ? (
              <CompanyInfoFields
                value={company}
                onChange={(patch) => setCompany((v) => ({ ...v, ...patch }))}
              />
            ) : (
              <p className="panel-hint">
                {company.name}
                {company.department ? ` / ${company.department}` : ''} / {company.personName} /{' '}
                {company.tel}
                <button
                  type="button"
                  className="menu-order-open"
                  onClick={() => setCompanyOpen(true)}
                >
                  自社情報を変更する
                </button>
              </p>
            )}
            {missing.length > 0 && (
              <p className="panel-hint">未入力の必須項目: {missing.join('・')}</p>
            )}

            <h4 className="bom-section">明細（{rows.length}品目）</h4>
            {rows.length === 0 ? (
              <p className="panel-hint">
                計上できる材料がありません。芯々寸法とサイズを入力すると集計されます。
              </p>
            ) : (
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>品名・仕様</th>
                    <th>サイズ</th>
                    <th className="num">数量</th>
                    <th>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.size}</td>
                      <td className="num">{r.qty}</td>
                      <td>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pipeGroups.length > 0 && (
              <p className="panel-hint">
                直管の本数は、切り出し寸法を定尺へ実際に詰めた結果（長い順に詰める方式）で数えています。
                合計の長さを定尺で割った値より多くなることがあります。
              </p>
            )}
          </div>
          <div className="bom-actions">
            <button className="bom-pdf" onClick={() => setPreviewOpen(true)} disabled={!canIssue}>
              PDFで見る
            </button>
            <button className="disclaimer-close" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      </div>

      {/* 印刷専用レイアウト。position:fixed のモーダルの中に置くと印刷時に
          1ページ分の高さで切り取られるため、body直下へportalする
          (材料集計の印刷レイアウトと同じ理由・同じ作り)。 */}
      {createPortal(
        <div className={`order-doc-print${previewOpen ? ' preview' : ''}`}>
          <div className="preview-toolbar">
            <button className="preview-print-btn" onClick={() => window.print()}>
              印刷 / PDFで保存
            </button>
            <button className="preview-close-btn" onClick={() => setPreviewOpen(false)}>
              閉じる
            </button>
          </div>
          <div className="preview-page">
            <div className="doc-no">
              {text.docNoLabel} {docNo}
            </div>
            <div className="issue-date">
              {text.dateLabel}：{issuedText}
            </div>
            <h1 className="doc-title">{text.title}</h1>
            <hr className="title-rule" />

            <table className="meta-top">
              <tbody>
                <tr>
                  <td className="meta-left">
                    <div className="dest-box">{meta.toName || '　'}　様</div>
                    <div className="dest-sub">{text.lead}</div>
                  </td>
                  <td className="meta-right">
                    <table className="issuer-table">
                      <tbody>
                        <tr>
                          <td className="label">会社名</td>
                          <td>{company.name}</td>
                        </tr>
                        <tr>
                          <td className="label">部署</td>
                          <td>{company.department}</td>
                        </tr>
                        <tr>
                          <td className="label">担当者名</td>
                          <td>{company.personName}</td>
                        </tr>
                        <tr>
                          <td className="label">電話番号</td>
                          <td>{company.tel}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="site-table">
              <tbody>
                <tr>
                  <td className="site-label">現場名</td>
                  <td>{meta.siteName}</td>
                </tr>
              </tbody>
            </table>

            <table className="items">
              <thead>
                <tr>
                  <th className="col-itemspec">品名・仕様</th>
                  <th className="col-size">サイズ</th>
                  <th className="col-qty">数量</th>
                  <th className="col-note">備考</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="col-itemspec">{r.name}</td>
                    <td className="col-size">{r.size}</td>
                    <td className="col-qty">{r.qty}</td>
                    <td className="col-note">{r.note}</td>
                  </tr>
                ))}
                {Array.from({ length: blankRows }, (_, i) => (
                  <tr key={`blank-${i}`}>
                    <td className="col-itemspec">&nbsp;</td>
                    <td className="col-size" />
                    <td className="col-qty" />
                    <td className="col-note" />
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="note-line">{text.note}</div>

            <div className="foot-area">
              <div className="foot-box">
                <div className="foot-label">{text.wantDateLabel}</div>
                <div className="foot-value">{formatDocDate(meta.wantDate)}</div>
              </div>
              {kind === 'order' && (
                <div className="foot-box">
                  <div className="foot-label">納品場所</div>
                  <div className="foot-value">{meta.deliverTo}</div>
                </div>
              )}
              <div className="foot-box">
                <div className="foot-label">{kind === 'order' ? '連絡事項' : 'ご連絡先'}</div>
                <div className="foot-value">
                  {kind === 'order'
                    ? meta.note
                    : meta.note || `${company.personName}　${company.tel}`}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
