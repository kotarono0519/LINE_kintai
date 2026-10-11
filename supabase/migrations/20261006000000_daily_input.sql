-- 毎日の受付（LINE → Supabase）で使う表。
-- 読み書きするのは Edge Functions（service role）だけなので、RLS は有効にしてポリシーは作らない。

-- 更新日時を自動で入れる
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 残業の記録（1 日 1 件）
create table public.overtime_records (
  work_date date primary key,
  minutes int not null check (minutes between 1 and 900),
  status text not null default 'pending' check (status in ('pending', 'reflected', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.overtime_records is '残業の記録。1 日 1 件で、同じ日に送り直したら上書きする';
comment on column public.overtime_records.work_date is '残業した日（日本時間）';
comment on column public.overtime_records.minutes is '残業時間（分）。1〜900（15 時間まで）';
comment on column public.overtime_records.status is '反映の状態。pending=反映待ち, reflected=反映済み, failed=失敗';
comment on column public.overtime_records.failure_reason is '失敗の理由（失敗のときだけ）';
comment on column public.overtime_records.created_at is '作った日時';
comment on column public.overtime_records.updated_at is '最後に変えた日時';
create trigger overtime_records_updated_at before update on public.overtime_records
  for each row execute function public.set_updated_at();
alter table public.overtime_records enable row level security;

-- 月ごとの反映の状態（行が無い月は、反映中でない・頼んでいないとみなす）
create table public.reflection_months (
  month date primary key check (extract(day from month) = 1),
  reflecting boolean not null default false,
  requested boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.reflection_months is '月ごとの反映の状態。行が無い月は反映中でない・頼んでいないとみなす';
comment on column public.reflection_months.month is '対象の月（その月の 1 日）';
comment on column public.reflection_months.reflecting is '反映中か';
comment on column public.reflection_months.requested is '実行された反映の依頼が一度はあるか';
comment on column public.reflection_months.updated_at is '最後に変えた日時';
create trigger reflection_months_updated_at before update on public.reflection_months
  for each row execute function public.set_updated_at();
alter table public.reflection_months enable row level security;

-- 答えていない聞き返し（種類ごとに 1 件まで）
create table public.open_questions (
  kind text primary key check (kind in ('date', 'month')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
comment on table public.open_questions is '答えていない聞き返し。種類ごとに 1 件まで';
comment on column public.open_questions.kind is '聞き返しの種類。date=何日の分か, month=何月の分か';
comment on column public.open_questions.payload is '答えが来るまで預かる中身（日付なら {"action":"set","minutes":120} か {"action":"delete"}）';
comment on column public.open_questions.created_at is '聞き返した日時';
alter table public.open_questions enable row level security;

-- 処理済みの LINE イベント（二重処理を防ぐ）
create table public.processed_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);
comment on table public.processed_events is '処理済みの LINE イベント。同じイベントを二度処理しないための印';
comment on column public.processed_events.event_id is 'LINE の webhookEventId';
comment on column public.processed_events.created_at is '処理した日時';
alter table public.processed_events enable row level security;

-- 新しい表を Data API に自動で公開しない設定でも Edge Functions（service role）が読み書きできるよう、
-- service role にだけ権限を渡す（anon・authenticated には渡さない）
grant select, insert, update, delete
  on public.overtime_records, public.reflection_months, public.open_questions, public.processed_events
  to service_role;
