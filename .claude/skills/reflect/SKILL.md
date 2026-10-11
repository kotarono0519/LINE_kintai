---
name: reflect
description: 『10月分を反映して』『反映して』と言われたら使う。Supabase の残業記録を、クラウド勤怠（マネーフォワード）の退勤時刻へ Chrome 越しに 1 件ずつ反映する。
---

# 月末の反映

Supabase の残業記録（pending / failed の日）を、クラウド勤怠の退勤時刻へ 1 件ずつ入れる。
Supabase の操作は Supabase MCP の `execute_sql`、画面の操作は Chrome（Claude in Chrome）で行う。

## 決まり

- 退勤時刻 = 19:00 + 残業時間（日付をまたげば翌日の時刻）
- 出勤時刻など、退勤以外は触らない
- 反映の前に、確認の一覧は出さずに始める
- ログインは代わりにしない
- 試し（10 月の最後の平日より前）のときだけ、本人に言われた場合に限り `kintai_reflect_begin` の第 2 引数に `true` を渡す。言われていなければ渡さない

## 手順

### 1. 月を決める

月が言われていなければ「何月分ですか」と聞く。月は「月の 1 日」の date にする（例: 10 月分なら `2026-10-01`。年は言われていなければ今日の日付から決める）。

### 2. 反映を始める

Supabase MCP の `execute_sql` で次を呼ぶ。

```sql
select public.kintai_reflect_begin('YYYY-MM-01');
```

`ok:false` のときは、理由を日本語で伝えて終わる。

| reason | 伝える内容 |
| --- | --- |
| `not_yet` | 最後の平日の前の月は受け付けません。途中で反映すると月が締まり、残りの日を送れなくなるためです |
| `closed` | この月は反映済みで、締まっています |
| `reflecting` | 別の反映が進行中です。20 分動きが無ければ外れるので、それから頼んでください |

`ok:true` のときは `targets`（日付昇順。`day` / `minutes` / `status` / `failure_reason`）を受け取る。

### 3. 対象が 0 件のとき

`targets` が空なら、次を呼んで終わる。

```sql
select public.kintai_reflect_end('YYYY-MM-01', true);
```

「記録がありません。この月を締めました」と報告する。

### 4. クラウド勤怠を開く

Chrome（Claude in Chrome）でクラウド勤怠を開く。ログインしていなければ、次を呼ぶ。

```sql
select public.kintai_reflect_end('YYYY-MM-01', false);
```

「ログインしてから、もう一度頼んでください」と伝えて終わる（ログインしていなかった依頼は数えない）。

### 5. 対象を 1 件ずつ処理する

`targets` の日を昇順に、1 件ずつ次のとおり進める。

1. その日の打刻を確かめる
2. 打刻が無ければ、記録を消す。

   ```sql
   select public.kintai_reflect_mark('YYYY-MM-01', 'YYYY-MM-DD', 'no_punch');
   ```

3. 打刻があれば、退勤を 19:00 + 残業（`minutes` 分。日付をまたげば翌日の時刻）に直して保存する。画面で保存できたことを確かめてから、次を呼ぶ。

   ```sql
   select public.kintai_reflect_mark('YYYY-MM-01', 'YYYY-MM-DD', 'reflected');
   ```

4. 直せなかったときは、理由を一言つけて呼ぶ。

   ```sql
   select public.kintai_reflect_mark('YYYY-MM-01', 'YYYY-MM-DD', 'failed', '理由');
   ```

`kintai_reflect_mark` の戻りが `ok:false` のとき:

- `reason` が `aborted`: そこで止める。「途中で打ち切られました。もう一度頼めば続きから」と伝える（手順 6 の `kintai_reflect_end` は呼ばない）
- `reason` が `bad_target`: その日は飛ばして次へ進み、最後の報告で「記録と合わなかった日」として伝える

### 6. 反映を終えて報告する

```sql
select public.kintai_reflect_end('YYYY-MM-01', true);
```

戻り値（`reflected` / `failed` / `pending` / `closed`）と、手順 5 で自分で数えた「打刻が無く消した日」から、次を報告する。

- n 件反映
- m 件失敗（日付と理由）
- 打刻が無く消した日（自分で数えた分）
- 残り（`pending` の件数）
- `closed` が true なら「この月は締まりました」

## クラウド勤怠の画面操作（日の開き方・退勤の欄・保存の確かめ）

本人の前で 1 回目に画面を見ながら書き込む。

（ここは空欄。推測で操作手順を書かない）
