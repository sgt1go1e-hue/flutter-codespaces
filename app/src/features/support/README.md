# サポート架台図面 — React/TypeScript 移植

Flutter版（別リポジトリ、`-55`）の吊り架台図面機能を、このアプリ
（`sgt1go1e-hue/flutter-codespaces` の `app/`＝React + TS + Vite、
オフラインPWA）へ移植したもの。同一オリジンのネイティブ画面として
組み込んである（iframe埋め込みではない）。

## この段階で入っているもの
- ✅ 計算ロジック（穴々・Z・切り寸・芯高・モードA/B・スリーパー・Uボルト表・吊り穴有無）
- ✅ 図面描画（SVG。バー・穴〔丸/長・色〕・刃/背向き破線・ゲージ寸法・寸法チェーン・切り寸・芯々・吊元芯々・高低差表・凡例）
- ✅ **図から寸法入力**：図の水色の数字・配管をタップ→モーダルで編集（ゲージは15〜30の候補＋手入力、配管はサイズ/スリーパー/削除）
- ✅ 1画面（材料/吊り穴/基準/向きトグル＋タップ編集図面＋配管追加）
- ⏳ PDF出力：後回し（Flutter版 `support_pdf.dart` にあり。次段で `pdf-lib` 等へ移植。`SupportFigure` は `onEdit` を省くと静的SVGとして描けるので、そのままPDFスナップショットに再利用できる）

## ファイル
| ファイル | 役割 | 依存 |
|---|---|---|
| `supportSpec.ts` | 計算エンジン（純関数。UI非依存） | なし |
| `hangerDesign.ts` | モデル（HangerDesign）＋ compute 等 | supportSpec |
| `SupportFigure.tsx` | 図面（SVG＋タップ編集チップ。`onEdit`省略で静的表示） | React, hangerDesign |
| `SupportDrawingPage.tsx` | ページ本体（トグル＋タップ編集図面＋配管追加＋モーダル） | React, 上記すべて |

`SupportFigure.tsx` はFlutter版と同じ「用紙(白背景)に黒線で描く」見た目を
そのまま保っている（アイソメ図の印刷プレビュー等、既存の図面出力と同じ
考え方）。編集チップの水色(`#1565C0`)もFlutter版から踏襲し、「タップできる
＝水色」という操作感を統一している。`SupportDrawingPage.tsx` の周り
（トグル・モーダル）は、このアプリの既存クラスに合わせてダークテーマ化
してある：`.qc-screen`/`.qc-body`/`.field`/`.round-toggle`（クイック計算・
窒素計算と共通の土台）、モーダルは`.disclaimer-*`（免責事項モーダル等と
共通の土台）を流用。

## 組み込み方（このアプリはreact-routerではなく画面切替のstateで管理）
`App.tsx` の `screen` state（`'launcher' | 'drawing' | 'quickcalc' |
'nitrogen' | 'support'`）に `'support'` を追加し、クイック計算・窒素計算と
同じ形で開閉する：

```tsx
import { SupportDrawingPage } from './features/support/SupportDrawingPage'

function openSupport() {
  setEraserMode(false)
  setScreen('support')
}
function closeSupport() {
  setScreen(drawingId ? 'drawing' : 'launcher')
}
// ...
{screen === 'support' && <SupportDrawingPage onClose={closeSupport} />}
```

メインメニュー（`FolderShelf.tsx`）の「＋ 新規作成」の直下に、同じ並びで
「🏗️ サポート架台図面」ボタンを1行追加し、`onSupportDrawing` prop 経由で
`openSupport` を呼ぶ。

## 動作確認（計算が正しいか）
Flutter版と同じ手書き資料の例を再現する（100A=126, 80A=101, 芯々200）。
```ts
import { calcHanger } from './supportSpec'
const r = calcHanger({
  pipes: [
    { pipeSize: '100A', holeSpacing: 126, sleeperThickness: 0, outerDiameter: 0 },
    { pipeSize: '80A', holeSpacing: 101, sleeperThickness: 0, outerDiameter: 0 },
  ],
  centerToCenters: [200],
  endMarginLeft: 40, hangerToUboltLeft: 50, hangerToUboltRight: 50, endMarginRight: 40,
})
// r.totalLength === 493.5, r.gapsZ[0] === 86.5, r.hangerPitch === 413.5
```

## Flutter版との対応
| Flutter (Dart) | React (TS) |
|---|---|
| `lib/models/support_spec.dart` | `supportSpec.ts` |
| `lib/models/hanger_design.dart` | `hangerDesign.ts` |
| `_FigurePainter` / `support_pdf.dart _paintSupport` | `SupportFigure.tsx` |
| `HangerDrawingScreen` | `SupportDrawingPage.tsx` |

Flutter版（`-55` リポジトリ）は引き続き動く。ロジックは両者同一なので、
どちらかで計算ルールを直したらもう一方にも反映すること（表データ・穴々・ゲージ等）。
