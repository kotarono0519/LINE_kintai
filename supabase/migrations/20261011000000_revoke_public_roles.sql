-- 外部の利用者（ログインしていない anon・ログイン済みの authenticated）に残っていた権限を外す。
-- 表を読み書きするのは Edge Functions（service role）と、反映のときの Claude（MCP 経由の管理者）だけ。

-- 表: Supabase の初期設定で残る TRUNCATE・REFERENCES・TRIGGER を外す（TRUNCATE は RLS で止まらない）
revoke all on table
  public.overtime_records, public.reflection_months, public.open_questions, public.processed_events
  from anon, authenticated;

-- これから作る表にも、外部の利用者への権限を最初から付けない
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- 更新日時を入れる関数: 検索先を固定し、外から呼べないようにする
alter function public.set_updated_at() set search_path = '';
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Supabase の「自動で RLS を有効にする」設定が作る関数。外から /rest/v1/rpc で呼べないようにする
-- （手元の確かめ用の Postgres には無いので、あるときだけ）
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
