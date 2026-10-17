// dev サーバー起動前に、居残っている古い vite プロセスを止める。
// これで「ポート3000が埋まって3001/3002に逃げる」手作業(pkill)が不要になる。
// pkill/lsof/fuser が無い環境でも動くよう、Linux では /proc を直接見る。
// /proc が無い OS では何もしない（no-op）。
import { readdirSync, readFileSync } from 'node:fs'

let killed = 0
try {
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    if (Number(pid) === process.pid) continue
    let cmd = ''
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    } catch {
      continue // 権限が無い/消えた等はスキップ
    }
    // このスクリプト自身(free-vite)は除外し、vite バイナリだけを対象にする
    if (cmd.includes('free-vite')) continue
    if (!cmd.includes('/vite')) continue
    try {
      process.kill(Number(pid), 'SIGTERM')
      killed++
    } catch {
      // すでに終了している等は無視
    }
  }
} catch {
  // /proc が無い環境（macOS/Windows 等）は何もしない
}

if (killed > 0) console.log(`[free-vite] 古い vite プロセスを ${killed} 件停止しました`)
