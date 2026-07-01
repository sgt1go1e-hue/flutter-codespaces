# 配管アイソメ図作成アプリ (PWA)

スマホのブラウザで動作する、配管アイソメ図を手書き入力するための PWA。
React + TypeScript + Vite + SVG で実装。

## 開発

```bash
cd app
npm install
npm run dev      # 開発サーバー (http://localhost:3000)
npm run build    # 型チェック + 本番ビルド
npm run preview  # ビルド結果のプレビュー
```

## 技術選定メモ

- **描画は SVG を採用**（Canvas ではなく）。
  各セグメントを DOM 要素として持てるため、タップ選択・ハイライト・
  属性の紐付けが素直に書ける。フェーズ2以降の「セグメント選択→属性設定」
  との相性が良い。

## 開発フェーズ

- [x] **フェーズ1**: キャンバスにフリーハンドで線を描き、アイソメ角度にスナップ／セグメント選択
- [ ] フェーズ2: セグメント選択 → 管種 / サイズ / 継手選択の UI
- [ ] フェーズ3: 加工寸法（切断寸法）の自動計算
- [ ] フェーズ4: 継手個数集計と CSV 出力
- [ ] フェーズ5: PWA 化（manifest + service worker）・UI 仕上げ

## フェーズ1でできること

- 指でドラッグしてフリーハンド描画
- 離すと最寄りのアイソメ角度（0° / 30° / 90° / 150° / 210° / 270° / 330°）へ自動スナップ
- 線の始点・終点は近くの既存端点へ吸着し、ルートを連結できる
- 線をタップで選択（ハイライト表示）／背景タップで選択解除
- 「元に戻す」「選択削除」「全消去」
- 図面（セグメント配列）は localStorage に自動保存

## ディレクトリ構成

```
app/
├─ src/
│  ├─ types.ts                 # Segment / DrawingState など型定義
│  ├─ lib/isometric.ts         # アイソメ角スナップ・端点吸着ロジック
│  ├─ hooks/useLocalStorage.ts # localStorage 自動保存フック
│  ├─ components/DrawingCanvas.tsx  # SVG 描画キャンバス
│  └─ App.tsx                  # 画面全体・状態管理
└─ ...
```

> pipes.json / fittings.json（管種・継手マスタ）はフェーズ2以降で
> `src/data/` に追加予定。
