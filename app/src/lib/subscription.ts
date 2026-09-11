// 月額サブスクリプション(有料機能の解放)。ネイティブアプリ(iOS/Android)
// でのみ課金を扱う。Web版(GitHub Pages/PWA)は従来通り無料のままにする
// （Web版はApple/Googleの審査対象ではなく、ストア課金の仕組みも使えないため）。

import { Capacitor } from '@capacitor/core'
import { store, ProductType, Platform, type Product } from 'capacitor-plugin-cdv-purchase'

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
      // 所有状態(owned)が変わるたび(購入完了時・復元時・失効時など)に発火する。
      .productUpdated((product) => {
        if (product.id === SUBSCRIPTION_PRODUCT_ID) setSubscribed(!!product.owned)
      })

    await store.initialize([platform])
    initialized = true

    const product = store.get(SUBSCRIPTION_PRODUCT_ID)
    if (product) setSubscribed(!!product.owned)
  })()

  return initPromise
}

export function isStoreInitialized(): boolean {
  return initialized
}

/** 購入フローを開始する。ユーザーが自分でキャンセルした場合は何もしない。 */
export async function purchaseSubscription(): Promise<void> {
  await initSubscriptionStore()
  const product = store.get(SUBSCRIPTION_PRODUCT_ID)
  const offer = product?.getOffer()
  if (!offer) throw new Error('商品情報を取得できませんでした')
  const err = await store.order(offer)
  if (err) throw new Error(err.message || '購入処理でエラーが発生しました')
}

/** 購入の復元（機種変更後など）。 */
export async function restorePurchases(): Promise<void> {
  await initSubscriptionStore()
  const err = await store.restorePurchases()
  if (err) throw new Error(err.message || '復元処理でエラーが発生しました')
}
