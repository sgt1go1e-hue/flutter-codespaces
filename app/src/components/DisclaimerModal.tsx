// 免責事項の本文（更新時は App 側の CONSENT_VERSION も上げる）
export const DISCLAIMER_PARAGRAPHS = [
  '本アプリで表示・算出される加工寸法（引きしろ寸法等）は、各継手メーカーが公開する寸法表を参考値として使用しています。実際の製品・ロット・メーカーによって寸法に差異がある場合があります。',
  '本アプリは現場での寸法取りをもとに、簡易的に加工寸法の目安を算出し、アイソメ図として記録・整理することを目的としています。精密な設計・発注用の公式図面としての使用は想定していません。',
  '本アプリの算出結果を用いたことによる、加工ミス・材料ロス等の損害について、開発者は責任を負いかねます。実際の施工にあたっては、必ず現場での実寸確認を行ってください。',
  '上記内容をご理解の上、ご利用ください。',
]

interface Props {
  /** 'consent' = 初回同意（閉じられない）, 'review' = 再確認（閉じるだけ） */
  mode: 'consent' | 'review'
  /** 同意済み日時（review 表示用） */
  agreedAt?: string
  onAgree: () => void
  onClose?: () => void
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 免責事項モーダル。
 * consent モード: 全画面を覆い、「同意する」まで他操作をブロックする。
 * review モード: 設定からいつでも見返す用（閉じるだけ）。
 */
export function DisclaimerModal({ mode, agreedAt, onAgree, onClose }: Props) {
  const isConsent = mode === 'consent'
  return (
    <div className="disclaimer-overlay">
      <div className="disclaimer-card" role="dialog" aria-modal="true">
        <div className="disclaimer-header">免責事項</div>
        <div className="disclaimer-body">
          {DISCLAIMER_PARAGRAPHS.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          {!isConsent && agreedAt && (
            <p className="disclaimer-agreed">同意日時: {formatDate(agreedAt)}</p>
          )}
        </div>
        <div className="disclaimer-actions">
          {isConsent ? (
            <button className="disclaimer-agree" onClick={onAgree}>
              同意する
            </button>
          ) : (
            <button className="disclaimer-close" onClick={onClose}>
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
