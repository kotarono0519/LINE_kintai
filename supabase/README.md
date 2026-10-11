# 毎日の受付（LINE → Supabase）

LINE に送った残業時間（「今日2時間」「昨日 1.5h」など）を読み取り、Supabase の表に記録する仕組みです。
LINE の Webhook を Supabase Edge Functions の `line-webhook` が受け、返事は LINE の reply API で返します。
月末の反映（クラウド勤怠への入力）はまだ入っていません（「反映して」には「準備中です」と返します）。

- `migrations/` … 表の定義（記録・月の状態・聞き返し・処理済みイベント）
- `functions/line-webhook/` … 入口
- `functions/month-end-notice/` … 月の最後の平日 18:00 の合図（LINE の push）
- `functions/_shared/` … 読み取り・受付・保管・LINE とのやりとり
- `functions/tests/` … テスト

## 最初に一度だけやる設定

前提: Supabase のプロジェクトと、LINE Developers の Messaging API チャネルを作ってあること。
コマンドはこのリポジトリの直下（`supabase/` がある場所）で実行します。

1. プロジェクトとつなぐ

   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   ```

2. 表を作る

   ```sh
   supabase db push
   ```

3. 鍵を入れる（リポジトリには書かない）

   チャネルシークレットは LINE Developers の「チャネル基本設定」、アクセストークン（長期）は「Messaging API 設定」にあります。
   本人の LINE ユーザー ID は、まだ分からなければ空のままで構いません（下の「自分の LINE ユーザー ID を調べる」）。

   ```sh
   supabase secrets set LINE_CHANNEL_SECRET=<チャネルシークレット>
   supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=<チャネルアクセストークン>
   supabase secrets set LINE_USER_ID=<本人の LINE ユーザー ID>
   ```

   `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Edge Functions に自動で入るので、設定は要りません。

4. 関数を置く（LINE は Supabase の JWT を送らないので、JWT の確かめを切る。代わりに LINE の署名を確かめる）

   ```sh
   supabase functions deploy line-webhook --no-verify-jwt
   ```

5. LINE Developers の「Messaging API 設定」で
   - Webhook URL に `https://<project-ref>.supabase.co/functions/v1/line-webhook` を入れ、「検証」で成功を確かめる
   - 「Webhook の利用」をオンにする

6. LINE Official Account Manager の「応答設定」で、応答メッセージ（自動応答）をオフにする（二重に返事が来ないように）

## 18:00 の合図を設定する（月の最後の平日）

月の最後の平日の 18:00（日本時間）に、LINE へ「今日は今月の最後の平日です。…『10月分を反映して』と頼んでください」と送ります（答えていない聞き返しがあれば、その件数も添えます）。
Supabase の cron（pg_cron）が毎平日 18:00 に `month-end-notice` を呼び、その日が月の最後の平日のときだけ送ります。
前の「最初に一度だけやる設定」が終わっている前提です。値（合言葉・プロジェクトの URL）は自分の端末で入れ、リポジトリには書きません。

1. 合言葉を作る（cron と関数だけが知る長いランダムな文字列）

   ```sh
   openssl rand -hex 32
   ```

2. 関数に合言葉を入れる

   ```sh
   supabase secrets set CRON_SECRET=<1 で作った合言葉>
   ```

3. Vault に 2 つ入れる（Supabase ダッシュボードの SQL エディタで実行。cron が呼ぶときにここから読みます）

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'kintai_project_url');
   select vault.create_secret('<1 で作った合言葉>', 'kintai_cron_secret');
   ```

   入れ直すときは `vault.update_secret(<id>, <新しい値>)`、または SQL エディタで `delete from vault.secrets where name = '...'` のあと作り直します。
   SQL エディタの履歴に合言葉が残るので、気になるなら履歴から消してください。

4. cron の予定を作る（Vault に先に入れてから。pg_cron と pg_net もここで有効になります）

   ```sh
   supabase db push
   ```

   同じ名前の予定（`kintai-month-end-notice`）が既にあっても、消してから作り直します。

5. 関数を置く（cron は Supabase の JWT を送らないので、JWT の確かめを切る。代わりに `CRON_SECRET` を確かめる）

   ```sh
   supabase functions deploy month-end-notice --no-verify-jwt
   ```

6. 試しに呼ぶ（`date` を指定すると、その日として判定します。最後の平日の日を指定すると、本当に LINE へ届きます）

   ```sh
   # 最後の平日（2026-10-30）として判定 → LINE に届き、{"sent":true,...} が返る
   curl -X POST https://<project-ref>.supabase.co/functions/v1/month-end-notice \
     -H "Authorization: Bearer <1 で作った合言葉>" \
     -H "Content-Type: application/json" \
     -d '{"date":"2026-10-30"}'

   # 最後の平日ではない日 → 送らず {"sent":false,...} が返る
   curl -X POST https://<project-ref>.supabase.co/functions/v1/month-end-notice \
     -H "Authorization: Bearer <1 で作った合言葉>" \
     -H "Content-Type: application/json" \
     -d '{"date":"2026-10-29"}'
   ```

   合言葉が違えば 401 が返ります。cron の実行結果は SQL エディタで `select * from cron.job_run_details order by start_time desc limit 5;` を見ます（呼び出し先の応答は `select * from net._http_response order by created desc limit 5;`）。

## 自分の LINE ユーザー ID を調べる

`LINE_USER_ID` と違う人（未設定なら全員）から届いた文には返事をせず、関数のログに ID を出します。

1. 友だち追加したアカウントに、何か 1 通送る（返事は来ません）
2. Supabase のダッシュボードの Edge Functions → `line-webhook` → Logs で
   `本人以外のイベントを捨てました: userId=U...` の行を探す
3. その `U` で始まる ID を `supabase secrets set LINE_USER_ID=U...` で入れる（入れ直しのあと、関数の再配置は要りません）

## テスト

Deno 2 が要ります。Docker や `supabase start` は使いません（表の確かめはメモリ上の Postgres の PGlite で行います）。

```sh
cd supabase/functions
deno task test    # テスト
deno task check   # 型の確かめ
```
