import type { CapacitorConfig } from '@capacitor/cli';

// appIdはCapacitorの設定上1つしか持てないが、実際のアプリ識別子はiOS/Androidで
// 別々になっている:
//   - iOS の Bundle Identifier: com.isomekobo.1go1e (Xcodeの
//     Signing & Capabilities で直接設定済み。Apple Developer Portal /
//     App Store Connect に登録済みで、サブスクリプションもこのIDに紐づく)
//   - Android の applicationId: com.isomekobo.app (android/app/build.gradle
//     に直接設定済み。Androidのパッケージ名は各セグメントが数字で始まっては
//     いけない規則があり、"1go1e" が使えないため別IDにした)
// どちらも `npx cap add <platform>` の時点で各プラットフォームのプロジェクト
// ファイルに書き込まれ、以降は `npx cap copy`/`sync` を実行してもこのappIdの
// 値では上書きされない（ビルド出力(capacitor.config.json)側のappId表記だけは
// ここの値になるが、カスタムURLスキームでの連携など未使用のため実害はない）。
// 変更する場合は、両方のネイティブプロジェクト側も手動で合わせること。
const config: CapacitorConfig = {
  appId: 'com.isomekobo.1go1e',
  appName: 'アイソメ工房',
  webDir: 'dist',
};

export default config;
