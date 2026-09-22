import { useLocalStorage } from '../hooks/useLocalStorage'
import {
  COMPANY_INFO_KEY,
  EMPTY_COMPANY_INFO,
  missingCompanyFields,
  type CompanyInfo,
} from '../lib/companyInfo'

// 自社情報(発注書・見積依頼書の差出人欄)。アプリ全体で1件だけ持ち、
// 端末のlocalStorageに保存する(案件ごとではない)。
// ホームの設定メニューからと、帳票作成ダイアログの中からの両方で同じ
// 値を編集できるよう、入力欄部分は CompanyInfoFields として切り出す。

/** 自社情報の保存値を読み書きするフック。編集画面が複数あるので共通化する。 */
export function useCompanyInfo() {
  return useLocalStorage<CompanyInfo>(COMPANY_INFO_KEY, EMPTY_COMPANY_INFO)
}

interface FieldsProps {
  value: CompanyInfo
  onChange: (patch: Partial<CompanyInfo>) => void
}

export function CompanyInfoFields({ value, onChange }: FieldsProps) {
  return (
    <div className="panel-grid">
      <label className="field">
        <span className="field-label">
          会社名<span className="field-note">必須</span>
        </span>
        <input
          type="text"
          className="num-input"
          placeholder="例: 〇〇工業株式会社"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">
          部署<span className="field-note">任意</span>
        </span>
        <input
          type="text"
          className="num-input"
          placeholder="例: 工事部"
          value={value.department}
          onChange={(e) => onChange({ department: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">
          担当者名<span className="field-note">必須</span>
        </span>
        <input
          type="text"
          className="num-input"
          placeholder="例: 山田 太郎"
          value={value.personName}
          onChange={(e) => onChange({ personName: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">
          電話番号<span className="field-note">必須</span>
        </span>
        <input
          type="tel"
          className="num-input"
          inputMode="tel"
          placeholder="例: 090-1234-5678"
          value={value.tel}
          onChange={(e) => onChange({ tel: e.target.value })}
        />
      </label>
    </div>
  )
}

interface Props {
  onClose: () => void
}

export function CompanyInfoModal({ onClose }: Props) {
  const [info, setInfo] = useCompanyInfo()
  const missing = missingCompanyFields(info)

  return (
    <div className="disclaimer-overlay" onClick={onClose}>
      <div className="bom-card" onClick={(e) => e.stopPropagation()}>
        <div className="disclaimer-header">自社情報</div>
        <div className="bom-body">
          <p className="panel-hint">
            発注書・見積もり依頼書の差出人欄に入る情報です。この端末に保存され、
            図面や現場ごとではなくアプリ全体で1件だけ持ちます。
          </p>
          <CompanyInfoFields value={info} onChange={(patch) => setInfo((v) => ({ ...v, ...patch }))} />
          {missing.length > 0 && (
            <p className="panel-hint">未入力: {missing.join('・')}（帳票を作るときに必要です）</p>
          )}
        </div>
        <div className="bom-actions">
          <button className="disclaimer-close" onClick={onClose}>
            完了
          </button>
        </div>
      </div>
    </div>
  )
}
