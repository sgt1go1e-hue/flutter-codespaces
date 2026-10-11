// 月額サブスクリプション(有料機能の解放)。ネイティブアプリ(iOS/Android)
// でのみ課金を扱う。Web版(GitHub Pages/PWA)は従来通り無料のままにする
// （Web版はApple/Googleの審査対象ではなく、ストア課金の仕組みも使えないため）。

import { Capacitor } from '@capacitor/core'
import { store, ProductType, Platform, ErrorCode, type Product } from 'capacitor-plugin-cdv-purchase'

export const SUBSCRIPTION_PRODUCT_ID = 'com.isomekobo.monthly'

const STORAGE_KEY = 'piping-iso:subscribed'

type Listener = () => void
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((fn) => fn())
}

/** UIから購読状態の変化を受け取るための簡易購読（ReactのuseSyncExternalStore等から使う）。 */
export function onSubscriptionChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function readCached(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCached(v: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
  } catch {
    // 保存失敗は無視（次回起動時にストアへ再確認される）
  }
}

let receiptsLoaded = false

/** ストアが把握している所有状態をアプリの購読状態に反映する。 */
function refreshOwnership(): boolean {
  let owned = false
  try {
    owned = store.owned(SUBSCRIPTION_PRODUCT_ID)
  } catch {
    owned = false
  }
  if (owned) setSubscribed(true)
  else if (receiptsLoaded) setSubscribed(false)
  return owned
}

let initialized = false
let initPromise: Promise<void> | null = null

/** 現在ネイティブアプリ(iOS/Android)として動いているか。Web版では常にfalse。 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * 購読済みかどうか。Web版では常にtrue(＝制限しない)。
 * ネイティブ版では、直近にストアへ確認できた状態をローカルにキャッシュして返す
 * （オフラインで起動した直後など、ストアへの問い合わせが済む前でも
 * 極端に不便にならないようにするため）。
 */
export function isSubscribed(): boolean {
  if (!isNativeApp()) return true
  return readCached()
}

function setSubscribed(v: boolean) {
  if (readCached() === v) return
  writeCached(v)
  notify()
}

// 無料お試し期間。ネイティブ版は初回起動から TRIAL_DAYS 日間、有料機能をすべて
// 解放し、その後は無料版(作図などは使えて、PDF出力等は購入が必要)に戻す。
// 開始日は端末内(localStorage)に保存する。アプリを削除して入れ直すと
// 開始日も消えるため、期間がリセットされる点は割り切っている。
export const TRIAL_DAYS = 14
const TRIAL_KEY = 'piping-iso:trial-started-at'
const DAY_MS = 24 * 60 * 60 * 1000

/** 初回起動日を記録する(すでに記録済みなら何もしない)。起動時に1回呼ぶ。 */
export function startTrialIfNeeded(): void {
  if (!isNativeApp()) return
  try {
    if (!localStorage.getItem(TRIAL_KEY)) {
      localStorage.setItem(TRIAL_KEY, String(Date.now()))
    }
  } catch {
    // 保存できない環境では無料期間なし(購入状態の判定だけで動く)
  }
}

/** 無料期間の残り日数(切り上げ)。期間外・Web版は0。端末の日付を戻されても最大TRIAL_DAYSまで。 */
export function trialDaysLeft(): number {
  if (!isNativeApp()) return 0
  let started = 0
  try {
    started = Number(localStorage.getItem(TRIAL_KEY))
  } catch {
    return 0
  }
  if (!(started > 0)) return 0
  const left = Math.ceil((started + TRIAL_DAYS * DAY_MS - Date.now()) / DAY_MS)
  return Math.min(TRIAL_DAYS, Math.max(0, left))
}

export function isInTrial(): boolean {
  return trialDaysLeft() > 0
}

/** 有料機能を使ってよいか。購読済み、または無料お試し期間中。 */
export function hasFullAccess(): boolean {
  return isSubscribed() || isInTrial()
}

/** 対象商品の表示用情報（価格・タイトル）。ストア初期化前はnull。 */
export function getSubscriptionProduct(): Product | undefined {
  return store.get(SUBSCRIPTION_PRODUCT_ID)
}

/**
 * 課金ストアの初期化。ネイティブアプリの時だけ実際に初期化する。
 * 何度呼んでも1回しか初期化しない（PaywallModalを開くたびに呼び出す想定）。
 */
export function initSubscriptionStore(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve()
  if (initPromise) return initPromise

  initPromise = (async () => {
    const platform = Capacitor.getPlatform() === 'android' ? Platform.GOOGLE_PLAY : Platform.APPLE_APPSTORE

    store.register([
      {
        id: SUBSCRIPTION_PRODUCT_ID,
        type: ProductType.PAID_SUBSCRIPTION,
        platform,
      },
    ])

    store
      .when()
      .approved((transaction) => transaction.verify())
      .verified((receipt) => receipt.finish())
      // 端末のレシート読み込みが済んだ時点で、はじめて「購入していない」と判断してよい。
      // （起動直後はレシート未読込のため owned が一時的に false になる。そこで
      //   購入済みの記録を消さないよう、読み込み完了までは「購入済み」への更新だけ許す）
      .receiptsReady(() => {
        receiptsLoaded = true
        refreshOwnership()
      })
      // 所有状態(owned)が変わるたび(購入完了時・復元時・失効時など)に発火する。
      .productUpdated((product) => {
        if (product.id === SUBSCRIPTION_PRODUCT_ID) refreshOwnership()
      })

    await store.initialize([platform])
    initialized = true
    refreshOwnership()
  })()

  return initPromise
}

export function isStoreInitialized(): boolean {
  return initialized
}

/** 購入後、端末のレシートに所有状態が反映されるまで少し待って確認する。 */
async function confirmOwnershipAfterPurchase(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    if (refreshOwnership()) return
    await new Promise((r) => setTimeout(r, 700))
  }
  // 反映が遅い場合でも、ストアが「購入済み」と返した取引が端末にあれば購読中として扱う。
  const product = store.get(SUBSCRIPTION_PRODUCT_ID)
  const tx = product ? store.findInLocalReceipts(product) : undefined
  if (tx && !tx.isPending && !tx.isConsumed) {
    const exp = tx.expirationDate
    if (!exp || exp.getTime() > Date.now()) setSubscribed(true)
  }
}

/** 購入フローを開始する。ユーザーが自分でキャンセルした場合は何もしない。 */
export async function purchaseSubscription(): Promise<void> {
  await initSubscriptionStore()
  const product = store.get(SUBSCRIPTION_PRODUCT_ID)
  const offer = product?.getOffer()
  if (!offer) throw new Error('商品情報を取得できませんでした')
  const err = await store.order(offer)
  if (err) {
    if (err.code === ErrorCode.PAYMENT_CANCELLED) return
    throw new Error(err.message || '購入処理でエラーが発生しました')
  }
  await confirmOwnershipAfterPurchase()
}

/** 購入の復元（機種変更後など）。 */
export async function restorePurchases(): Promise<void> {
  await initSubscriptionStore()
  const err = await store.restorePurchases()
  if (err) throw new Error(err.message || '復元処理でエラーが発生しました')
  await confirmOwnershipAfterPurchase()
}
