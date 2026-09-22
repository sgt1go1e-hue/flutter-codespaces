// 発注書・見積依頼書に載せる自社情報。アプリ全体で1件だけ持つ
// (案件ごとではない)。端末のlocalStorageに保存する。

export interface CompanyInfo {
  /** 会社名(必須) */
  name: string
  /** 部署(任意) */
  department: string
  /** 担当者名(必須) */
  personName: string
  /** 電話番号(必須) */
  tel: string
}

export const EMPTY_COMPANY_INFO: CompanyInfo = {
  name: '',
  department: '',
  personName: '',
  tel: '',
}

export const COMPANY_INFO_KEY = 'piping-iso:companyInfo'

/** 必須項目(会社名・担当者名・電話番号)が埋まっているか */
export function isCompanyInfoComplete(c: CompanyInfo): boolean {
  return !!c.name.trim() && !!c.personName.trim() && !!c.tel.trim()
}

/** 未入力の必須項目名の一覧(入力を促すメッセージ用) */
export function missingCompanyFields(c: CompanyInfo): string[] {
  const out: string[] = []
  if (!c.name.trim()) out.push('会社名')
  if (!c.personName.trim()) out.push('担当者名')
  if (!c.tel.trim()) out.push('電話番号')
  return out
}
