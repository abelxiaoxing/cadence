# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence は [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) を永続的なタスクワークスペースに変えます。
コードタスクを計画し、サブエージェントに作業させ、チェックを実行し、結果を Pi ターミナル（`/cadence`）やブラウザの WebUI からレビューします。
両方とも同じバックグラウンドサービスに接続します。

## なぜ Cadence か

- **作業はウィンドウを超えて残る。**
  タスクはバックグラウンドサービスで実行されます。
  ターミナルを閉じても、Pi を終了しても、ブラウザのタブを離れても、それらはデタッチするだけで、どちらのクライアントも同じ実行に再接続できます。
- **承認するまで何も編集されない。**
  タスクはまず読み取り専用で分析し、読みやすい計画を提案します。
  ファイルが変更されるのは、あなたがその正確な計画を確認した後のみです。
- **信頼できる結果。**
  サブエージェントの出力、実際のチェック実行、あなた自身のレビューは別々に保たれます。
  モデルの文章や「Done」はチェック通過としては数えず、失敗・キャンセル・不明の結果は区別されたままです。
- **完全な履歴。**
  各実行はメッセージ、ツール呼び出し、出力を保持し、正確な検索と完全な Markdown/NDJSON エクスポートをサポートします。
  既知のシークレットはマスクされます。
- **すべてに一つのリンク。**
  WebUI（デスクトップとスマホ、英語と簡体字中国語）は通常の Pi 会話もホストし、プロジェクト間で切り替えられます。
  各プロジェクトには独自の owner と履歴があります。

Cadence は信頼できるアシスタントであり、**サンドボックスではありません**。
そのエージェントはホストツールであなたの作業コピーを直接編集するため、レビューと復旧が可能なコードで使うください。

## インストール

npm を備えた Node `>=22.19.0`、モデルプロバイダーにログイン済みでインストールされた Pi が必要です。
Cadence は Pi のログインとモデル設定を再利用します。

```sh
npm install -g @abelxiaoxing/cadence
cadence server install
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` はバックグラウンドサービスを登録して起動し（Linux では systemd、macOS では LaunchAgent、Windows ではログイン項目）、プライベートリンク `http://127.0.0.1:17423/?token=…` を表示します。
最後のコマンドは Pi に同じコピーを `/cadence` で読み込ませるため、npm でのアップグレード 1 回で両方が更新されます。
ポートとトークンは `~/.pi/agent/cadence/.env` にあります。
トークンを所持する者はあなたのワークスペースを使えるため、リンクは秘密にしてください。

## 使い方

### ブラウザで

1. 表示されたリンクを一度開く。
   その後ブラウザはあなたを覚えておく。
   リンクを紛失した場合は `cadence token-link --reveal` で再度表示できます。
2. 右下のフォルダボタンでプロジェクトフォルダを選び、モデルを選ぶ。
3. 通常の会話にはメッセージを送信するか、`cadence <goal>` で始める（または Cadence タスクを選ぶ）とタスクが作成される。
4. 分析が計画を提案したら、**実装計画をレビュー**を開き、**計画を確認して実行**を選ぶ。
5. サブエージェントは左下の dock で追える。
   チェック、変更、レビューは右の**タスク詳細**の下にある。

### ターミナルで

Pi の TUI で、自分で `/cadence [goal]` と入力して Enter を押す。
貼り付けやスクリプトの入力では開かない。
モデルを選び、タスクを作成または開き、その計画を編集して Start を確認する。
メニューにはサブエージェント、チェック、変更、レビュー、履歴も表示される。

すべての Pi セッションは、入力の上部に実行中のバックグラウンドエージェントを表示する。
空の入力状態で ↓ を押して選択し、Enter でその記録を読む（`CADENCE_AGENT_PANEL=off` でパネルを非表示にできる）。

### その他のプロジェクト

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

各プロジェクトには独自の owner、ポート、履歴があり、コマンドはそのプライベートリンクを表示する。
WebUI のフォルダピッカーも同じ方法でプロジェクトを開く。
別のプロジェクトを開いても、前のプロジェクトでの作業は止まらない。

### チェック

`.cadence/assistant/config.json` にプロジェクトを検証するコマンドを列挙すると、タスクはレビュー前にそれを実際のチェックとして実行できる：

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## サービスの管理

```sh
cadence server status
cadence server restart     # アップグレードや .env / models.json の変更後
cadence server stop        # 登録は保持され、次の起動またはログイン時に再び起動する
cadence server uninstall   # npm uninstall -g の前に実行
```

`npm install -g @abelxiaoxing/cadence@latest` でアップグレードし、次に `cadence server restart`。
restart、stop、uninstall はデタッチしたままにせずに、実行中の作業を順番に停止する。
uninstall はサービス定義のみを削除する。
プロジェクト、履歴、Pi の設定は残る。
Linux ルートおよび名前付きサービス、リモート HTTPS アクセス、回復は[サービス管理](docs/service-management.md)と[リモートアクセス](docs/remote-access.md)を参照。

## 開発

Pi はローカル checkout やパックされた tarball も読み込める。
その絶対または相対パスを Pi の `packages` に追加するか、`pi -e ./cadence` を試す。
Cadence は Pi のバージョン範囲を強制しない。
開発用のピンとテスト済みのランタイムは、普遍的な互換性の約束ではない。

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

エンジニアリングのガイダンスは [engineering/](engineering/) 下に領域ごとに分割されている。
[AGENTS.md](AGENTS.md) のプロジェクト索引がどのファイルがどのコードをカバーするかを示す。
`verify` には公式 Node ビルド、プライベートな一時ディレクトリ、既存の Chromium も必要。
[検証](engineering/verification.md)を参照。

## ライセンス

Cadence は MIT です。
バンドルされた適応コード、フォント、ベンダーはそれぞれのライセンスを保持。
[再利用と配布](docs/reuse-and-distribution.md)と[サードパーティ通知](THIRD_PARTY_NOTICES.md)を参照。
