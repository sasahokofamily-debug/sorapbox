# sorapbox（ソラップBOX）v1

Firebaseを使った、Dropbox風の個人用クラウドストレージです。

## v1でできること

- メールアドレスとパスワードで登録・ログイン
- ドラッグ＆ドロップでファイルアップロード
- アップロード進捗・キャンセル
- フォルダ作成
- ファイル名・フォルダ名の変更
- 画像・動画・音声・PDFのプレビュー
- ファイルのダウンロード
- 最近のファイル表示
- 検索
- ゴミ箱への移動、復元、完全削除
- スマホ表示
- 使用容量の表示

## Firebaseで最初に行う設定

### 1. Authentication

Firebase Consoleで次を開きます。

`Authentication → Sign-in method → メール/パスワード → 有効`

### 2. Firestore Database

`Firestore Database → データベースを作成`

作成後、このリポジトリの `firestore.rules` をルール画面へ貼り付けて公開します。

### 3. Storage

`Storage → 始める`

作成後、このリポジトリの `storage.rules` をルール画面へ貼り付けて公開します。

> Cloud Storageの利用には、Firebaseプロジェクトの料金プラン設定が必要になる場合があります。予算アラートも設定してください。

### 4. Webアプリ設定

Firebase設定は `firebase-config.js` に入力済みです。
Firebase ConsoleのWebアプリ設定に `appId` が表示されている場合は、同ファイルのコメントを外して追加できます。

## 公開

### GitHub Pages

1. GitHubの `Settings`
2. `Pages`
3. Sourceを `Deploy from a branch`
4. Branchを `main`、Folderを `/ (root)`
5. 保存

公開URLは通常、次の形です。

`https://sasahokofamily-debug.github.io/sorapbox/`

## セキュリティ

FirebaseのWeb用 `apiKey` は秘密鍵ではありません。データ保護は `firestore.rules` と `storage.rules` で行います。ルールをテスト用の全公開状態にしないでください。

## v2予定

- 共有リンク
- 共有期限
- パスワード付き共有
- お気に入り
- ファイル移動
- 容量プラン
