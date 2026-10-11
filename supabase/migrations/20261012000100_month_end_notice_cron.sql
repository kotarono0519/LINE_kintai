-- 月の最後の平日の 18:00（日本時間）の合図を、Edge Function month-end-notice に毎平日呼ばせる。
-- 最後の平日かどうかは関数の側で判定するので、cron は月〜金の毎日呼ぶだけ。
--
-- 先にやること: Vault に次の 2 つを入れる（README の手順）。値はこのファイルに書かない。
--   kintai_project_url … https://<project-ref>.supabase.co
--   kintai_cron_secret … supabase secrets set CRON_SECRET で入れた値と同じ合言葉
-- 手元の確かめ用の Postgres（PGlite）には pg_cron・pg_net が無いので、このファイルはテストに入れない。

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 同じ名前の予定があれば先に消す（作り直せるように）
do $$
begin
  if exists (select 1 from cron.job where jobname = 'kintai-month-end-notice') then
    perform cron.unschedule('kintai-month-end-notice');
  end if;
end;
$$;

-- pg_cron は UTC で動く。09:00 UTC = 18:00 JST（同じ日の月〜金）
select cron.schedule(
  'kintai-month-end-notice',
  '0 9 * * 1-5',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'kintai_project_url')
      || '/functions/v1/month-end-notice',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'kintai_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $job$
);
