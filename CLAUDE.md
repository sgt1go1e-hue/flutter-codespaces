# アイソメ工房（配管アイソメ図 / 芯引き自動計算）

React + Vite + TypeScript のアプリ（`app/`）を、Capacitor で iOS / Android に包んでストア公開している。
同じコードが Web版(PWA, GitHub Pages)にも出る。Web版は無料・制限なし。

## ユーザーについて
- 日本語で話す。開発の初心者。手順は1つずつ、画面で押す場所まで書く。
- コマンドは1ブロックに1つ。パスワードや鍵の中身は、チャットに書かせない（ユーザー自身にファイルへ入力してもらう）。
- iPhone利用でAndroid実機はない。Androidの確認はエミュレーター（AVD `Pixel_9`）で行う。

## 識別子
- iOS: `com.isomekobo.1go1e` / Android: `com.isomekobo.app`
- サブスク商品ID: `com.isomekobo.monthly`（職長プラン、月額500円、1か月自動更新）
- 公開ページ: `https://sgt1go1e-hue.github.io/flutter-codespaces/legal/privacy.html` と `.../terms.html`（ソースは `app/public/legal/`）

## ビルドの鉄則
- モバイル用は必ず `cd app && npm run sync:mobile`（= `--mode capacitor` でビルドして iOS/Android に同期）。
- `npm run build` をモバイルに使わない。GitHub Pages用のパス(`/flutter-codespaces/`)になり、アプリが真っ白になる。
- ビルドの前に GitHub の最新を取り込む（`git fetch` → `git merge origin/claude/piping-isometric-pwa-jg1fi4`）。
  別のセッションはクラウド上で作業して GitHub に保存するため、このMacのフォルダには自動では入らない。

## Android のリリース
1. `app/android/app/build.gradle` の `versionCode` を必ず増やす（同じ番号は再アップロード不可）。`versionName` も更新。
2. `cd app/android && ./gradlew bundleRelease`
3. 出力: `app/android/app/build/outputs/bundle/release/app-release.aab` → Play Console にアップロード。
- 署名: `app/android/keystore.properties`（gitignore済み）。鍵は `~/Documents/keys/isomekobo-upload.jks`、alias は `upload`。
  鍵とパスワードは絶対にコミットしない・失くさない（失くすと更新できなくなる）。
- 個人アカウントのため、本番公開の前に「クローズドテスト: 12人以上が14日間オプトイン」が必要。

## iOS のリリース
- `app/ios` は Git 管理外。バージョンは `app/ios/App/App.xcodeproj/project.pbxproj` の
  `MARKETING_VERSION`（公開済みの版は上げる）と `CURRENT_PROJECT_VERSION`（Build、毎回増やす）。Xcodeの General タブでも変えられる。
- Xcode: 開くのは `app/ios/App/App.xcworkspace` → ビルド先 `Any iOS Device (arm64)` → Product > Archive → Distribute App → Distribute。
- App Store Connect: 新バージョンを作成 → ビルドを選択 → 「最新情報」(日本語)を入力 → 審査メモ → 提出。
  暗号化の質問は「一般的なアルゴリズム」。リリース方法は手動。
- アプリの価格は必ず「無料」。過去に500円になっていて公開を止めた。
- 審査員の端末も無料期間中になり、PDFを押しても購入画面が出ない。審査メモに
  「設定 → 職長プランについて」で購入画面に行けること(購入するボタンあり)を書く。

## 有料機能と無料期間（`app/src/lib/subscription.ts`）
- 初回起動から14日間は全機能を解放（`startTrialIfNeeded` / `hasFullAccess`）。開始日は localStorage（再インストールでリセット）。
- 無料版で使えるのは「アイソメを描く」と「クイック計算」だけ。
- 有料: パーツ配置、材料拾い出し(BOM)、窒素計算、サポート架台図面、PDF/CSV出力、発注書・見積依頼書、
  クイック計算の現場ファイルとメモ30件（無料版はメモ5件まで。計算そのもの・引しろ表は無料）。
  判定は `App.tsx` の `requirePaid` と `BomModal.tsx` の `requireSubscription`。新しい有料の入口を足したら必ず通す。
  クイック計算の記録は `QuickCalc.tsx` の `recordsUnlocked`(hasFullAccess) で判定し、案内は `onRequirePaid`(=requirePaid)。
- 購入画面(`PaywallModal.tsx`)には、プラン名・期間・価格・利用規約/プライバシーポリシーのリンクを必ず出す（Apple 3.1.2(c)）。
  App Store の説明文には、標準Apple EULAへのリンクを入れてある。
- パーツ等のタップで購入画面を開くと、指を離した直後のクリックで即閉じる問題があった。
  購入画面は開いてから0.5秒は背景タップを無視している（消さない）。

## Android エミュレーターでの確認
- `cd app && npm run sync:mobile` → `cd app/android && ./gradlew installDebug`
- 画面の中身は `adb forward tcp:9222 localabstract:webview_devtools_remote_<アプリのpid>` で WebView に接続して確認できる。
- Googleアカウント未ログインだと、購入まわりでログイン画面が出る（アプリの不具合ではない）。

## 既知の注意
- 販売元は個人名で表示される（個人アカウントのため。変えるには法人アカウントが必要）。
- Google Play のクローズドテストは、テスターが「オプトイン」して初めて人数に数えられる。
