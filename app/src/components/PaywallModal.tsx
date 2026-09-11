import { useEffect, useState } from 'react'
import {
  getSubscriptionProduct,
  initSubscriptionStore,
  isNativeApp,
  isSubscribed,
  onSubscriptionChange,
  purchaseSubscription,
  restorePurchases,
} from '../lib/subscription'

interface Props {
  onClose: () => void
}

// 有料機能の案内・購入画面。ホーム画面や各有料機能の入口から、未購読のときに
// ここへ誘導する。ネイティブアプリでのみ実際に課金でき、Web版では
// 「アプリ版でご利用いただけます」という案内だけを出す(Web版は無料のまま)。
export function PaywallModal({ onClose }: Props) {
  const [subscribed, setSubscribedState] = useState(isSubscribed())
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const off = onSubscriptionChange(() => setSubscribedState(isSubscribed()))
    if (isNativeApp()) {
      // ストア初期化に失敗しても(通信不良・端末側の一時的な問題等)、この画面
      // 自体は表示され続けるようにする(失敗時はエラー文言と共に再試行可能な
      // 状態を保つ)。initSubscriptionStore側の想定外の同期エラーも拾う。
      Promise.resolve()
        .then(() => initSubscriptionStore())
        .then(() => setReady(true))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    }
    return off
  }, [])

  let product
  try {
    product = ready && isNativeApp() ? getSubscriptionProduct() : undefined
  } catch {
    product = undefined
  }
  const priceLabel = product?.pricing?.price ?? '月額500円（税込・参考価格）'

  async function handlePurchase() {
    setError(null)
    setBusy('purchase')
    try {
      await purchaseSubscription()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleRestore() {
    setError(null)
    setBusy('restore')
    try {
      await restorePurchases()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="disclaimer-overlay" onClick={onClose}>
      <div className="bom-card" onClick={(e) => e.stopPropagation()}>
        <div className="disclaimer-header">有料機能</div>
        <div className="bom-body">
          {subscribed ? (
            <p className="panel-hint">
              ご購読ありがとうございます。有料機能はすべてご利用いただけます。
            </p>
          ) : !isNativeApp() ? (
            <p className="panel-hint">
              この機能はアプリ版（App Store / Google Play）でご利用いただけます。
            </p>
          ) : (
            <>
              <p className="panel-hint">
                月額プランに加入すると、次の機能が使えるようになります。
              </p>
              <ul className="panel-hint" style={{ margin: '4px 0 12px', paddingLeft: '1.2em' }}>
                <li>パーツ（フランジ等）の配置</li>
                <li>PDF出力・発注書作成</li>
                <li>サポート架台図面</li>
                <li>材料拾い出し（BOM）・CSV出力</li>
                <li>窒素計算</li>
              </ul>
              <p className="panel-hint">
                <strong>{priceLabel}</strong>
                （自動更新。いつでもストアの設定から解約できます）
              </p>
              {error && <p className="panel-hint dim-cut">{error}</p>}
            </>
          )}
        </div>
        <div className="bom-actions">
          {!subscribed && isNativeApp() && (
            <>
              <button
                className="support-btn"
                onClick={handleRestore}
                disabled={busy !== null || !ready}
              >
                {busy === 'restore' ? '復元中…' : '購入を復元'}
              </button>
              <button
                className="disclaimer-close"
                onClick={handlePurchase}
                disabled={busy !== null || !ready}
              >
                {busy === 'purchase' ? '処理中…' : '購入する'}
              </button>
            </>
          )}
          <button className="support-btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
