// 依存を増やさずに動く簡易テスト。`npm run test:units` で実行する。
// (このリポジトリにはテストランナーが入っていないため、node だけで
//  動くようにしてある。TypeScriptは型注釈を落として読み込む。)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let passed = 0
let failed = 0

function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ok   ${label}  => ${JSON.stringify(actual)}`)
  } else {
    failed++
    console.log(`  FAIL ${label}  期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`)
  }
}

/**
 * .ts から型注釈を落として関数を取り出す簡易ローダー。
 * 対象は純関数だけ(外部importなし)なので、これで十分動く。
 */
async function loadTs(relPath) {
  const src = readFileSync(resolve(here, '..', relPath), 'utf8')
  const js = src
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/^\s*export type[^\n]*\n/gm, '')
    .replace(/\bexport\s+/g, '')
    .replace(/\bas const\b/g, '')
    // 型注釈・戻り値型を落とす
    .replace(/:\s*number\[\]/g, '')
    .replace(/:\s*number(?=\s*[,)=])/g, '')
    .replace(/:\s*string(?=\s*[,)=])/g, '')
    .replace(/\)\s*:\s*number\s*\{/g, ') {')
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js + '\nexport { calcStockCount, DEFAULT_KERF_MM };').toString('base64')}`)
  return mod
}

console.log('stockCount: 定尺の必要本数(First-Fit Decreasing)')
const { calcStockCount } = await loadTs('src/lib/stockCount.ts')

// 指示書の検証例。単純な合計÷定尺(13500/4000=3.375→4本)とは一致しない。
eq(calcStockCount([3000, 3000, 3000, 1500, 1500, 1500], 4000), 5,
   '定尺4000 / 3000×3 + 1500×3 → 5本 (単純計算の4本ではない)')

// 単純な割り算が正しくなる素直なケース
eq(calcStockCount([2000, 2000], 4000), 1, '定尺4000 / 2000×2 → 1本(ぴったり収まる)')
eq(calcStockCount([2000, 2000, 2000], 4000), 2, '定尺4000 / 2000×3 → 2本')

// 端材が出るケース
eq(calcStockCount([3000], 4000), 1, '定尺4000 / 3000×1 → 1本')
eq(calcStockCount([3000, 1000], 4000), 1, '定尺4000 / 3000+1000 → 1本(ぴったり)')
eq(calcStockCount([3000, 1001], 4000), 2, '定尺4000 / 3000+1001 → 2本(1mm超過で入らない)')

// 長い方から詰めることの確認(順序を変えても結果は同じ)
eq(calcStockCount([1500, 3000, 1500, 3000, 1500, 3000], 4000), 5,
   '入力順が違っても同じ → 5本')

// 定尺5.5m
eq(calcStockCount([3000, 3000, 1500, 1500], 5500), 2,
   '定尺5500 / 3000×2 + 1500×2 → 2本')

// 切断ロス(kerf)
eq(calcStockCount([2000, 2000], 4000, 0), 1, 'kerf=0 なら 2000×2 は1本に収まる')
eq(calcStockCount([2000, 2000], 4000, 5), 2, 'kerf=5 だと 2000×2 は収まらず2本')

// 端の条件
eq(calcStockCount([], 4000), 0, '切り出しが無ければ0本')
eq(calcStockCount([5000], 4000), 1, '定尺を超える寸法も必ず1本は数える')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
