-- 月末の反映（Supabase の残業記録 → クラウド勤怠の退勤時刻）で Claude Code が呼ぶ関数と、その下ごしらえ。
-- 呼ぶのは Claude（MCP 経由の管理者）と Edge Functions（service role）だけ。外部の利用者からは呼べないようにする。

-- 国民の祝日（振替休日・国民の休日を含む）。最後の平日の判定に使う
create table public.jp_holidays (
  day date primary key,
  name text not null
);
comment on table public.jp_holidays is '国民の祝日（振替休日・国民の休日を含む）。@holiday-jp/holiday_jp@2.5.2 のデータから 2026〜2035 年分を入れた';
comment on column public.jp_holidays.day is '祝日の日付';
comment on column public.jp_holidays.name is '祝日の名前';
alter table public.jp_holidays enable row level security;
revoke all on table public.jp_holidays from anon, authenticated, service_role;
grant select on table public.jp_holidays to service_role;

insert into public.jp_holidays (day, name) values
  ('2026-01-01', '元日'),
  ('2026-01-12', '成人の日'),
  ('2026-02-11', '建国記念の日'),
  ('2026-02-23', '天皇誕生日'),
  ('2026-03-20', '春分の日'),
  ('2026-04-29', '昭和の日'),
  ('2026-05-03', '憲法記念日'),
  ('2026-05-04', 'みどりの日'),
  ('2026-05-05', 'こどもの日'),
  ('2026-05-06', 'こどもの日 振替休日'),
  ('2026-07-20', '海の日'),
  ('2026-08-11', '山の日'),
  ('2026-09-21', '敬老の日'),
  ('2026-09-22', '休日'),
  ('2026-09-23', '秋分の日'),
  ('2026-10-12', 'スポーツの日'),
  ('2026-11-03', '文化の日'),
  ('2026-11-23', '勤労感謝の日'),
  ('2027-01-01', '元日'),
  ('2027-01-11', '成人の日'),
  ('2027-02-11', '建国記念の日'),
  ('2027-02-23', '天皇誕生日'),
  ('2027-03-21', '春分の日'),
  ('2027-03-22', '春分の日 振替休日'),
  ('2027-04-29', '昭和の日'),
  ('2027-05-03', '憲法記念日'),
  ('2027-05-04', 'みどりの日'),
  ('2027-05-05', 'こどもの日'),
  ('2027-07-19', '海の日'),
  ('2027-08-11', '山の日'),
  ('2027-09-20', '敬老の日'),
  ('2027-09-23', '秋分の日'),
  ('2027-10-11', 'スポーツの日'),
  ('2027-11-03', '文化の日'),
  ('2027-11-23', '勤労感謝の日'),
  ('2028-01-01', '元日'),
  ('2028-01-10', '成人の日'),
  ('2028-02-11', '建国記念の日'),
  ('2028-02-23', '天皇誕生日'),
  ('2028-03-20', '春分の日'),
  ('2028-04-29', '昭和の日'),
  ('2028-05-03', '憲法記念日'),
  ('2028-05-04', 'みどりの日'),
  ('2028-05-05', 'こどもの日'),
  ('2028-07-17', '海の日'),
  ('2028-08-11', '山の日'),
  ('2028-09-18', '敬老の日'),
  ('2028-09-22', '秋分の日'),
  ('2028-10-09', 'スポーツの日'),
  ('2028-11-03', '文化の日'),
  ('2028-11-23', '勤労感謝の日'),
  ('2029-01-01', '元日'),
  ('2029-01-08', '成人の日'),
  ('2029-02-11', '建国記念の日'),
  ('2029-02-12', '建国記念の日 振替休日'),
  ('2029-02-23', '天皇誕生日'),
  ('2029-03-20', '春分の日'),
  ('2029-04-29', '昭和の日'),
  ('2029-04-30', '昭和の日 振替休日'),
  ('2029-05-03', '憲法記念日'),
  ('2029-05-04', 'みどりの日'),
  ('2029-05-05', 'こどもの日'),
  ('2029-07-16', '海の日'),
  ('2029-08-11', '山の日'),
  ('2029-09-17', '敬老の日'),
  ('2029-09-23', '秋分の日'),
  ('2029-09-24', '秋分の日 振替休日'),
  ('2029-10-08', 'スポーツの日'),
  ('2029-11-03', '文化の日'),
  ('2029-11-23', '勤労感謝の日'),
  ('2030-01-01', '元日'),
  ('2030-01-14', '成人の日'),
  ('2030-02-11', '建国記念の日'),
  ('2030-02-23', '天皇誕生日'),
  ('2030-03-20', '春分の日'),
  ('2030-04-29', '昭和の日'),
  ('2030-05-03', '憲法記念日'),
  ('2030-05-04', 'みどりの日'),
  ('2030-05-05', 'こどもの日'),
  ('2030-05-06', 'こどもの日 振替休日'),
  ('2030-07-15', '海の日'),
  ('2030-08-11', '山の日'),
  ('2030-08-12', '山の日 振替休日'),
  ('2030-09-16', '敬老の日'),
  ('2030-09-23', '秋分の日'),
  ('2030-10-14', 'スポーツの日'),
  ('2030-11-03', '文化の日'),
  ('2030-11-04', '文化の日 振替休日'),
  ('2030-11-23', '勤労感謝の日'),
  ('2031-01-01', '元日'),
  ('2031-01-13', '成人の日'),
  ('2031-02-11', '建国記念の日'),
  ('2031-02-23', '天皇誕生日'),
  ('2031-02-24', '天皇誕生日 振替休日'),
  ('2031-03-21', '春分の日'),
  ('2031-04-29', '昭和の日'),
  ('2031-05-03', '憲法記念日'),
  ('2031-05-04', 'みどりの日'),
  ('2031-05-05', 'こどもの日'),
  ('2031-05-06', 'こどもの日 振替休日'),
  ('2031-07-21', '海の日'),
  ('2031-08-11', '山の日'),
  ('2031-09-15', '敬老の日'),
  ('2031-09-23', '秋分の日'),
  ('2031-10-13', 'スポーツの日'),
  ('2031-11-03', '文化の日'),
  ('2031-11-23', '勤労感謝の日'),
  ('2031-11-24', '勤労感謝の日 振替休日'),
  ('2032-01-01', '元日'),
  ('2032-01-12', '成人の日'),
  ('2032-02-11', '建国記念の日'),
  ('2032-02-23', '天皇誕生日'),
  ('2032-03-20', '春分の日'),
  ('2032-04-29', '昭和の日'),
  ('2032-05-03', '憲法記念日'),
  ('2032-05-04', 'みどりの日'),
  ('2032-05-05', 'こどもの日'),
  ('2032-07-19', '海の日'),
  ('2032-08-11', '山の日'),
  ('2032-09-20', '敬老の日'),
  ('2032-09-21', '休日'),
  ('2032-09-22', '秋分の日'),
  ('2032-10-11', 'スポーツの日'),
  ('2032-11-03', '文化の日'),
  ('2032-11-23', '勤労感謝の日'),
  ('2033-01-01', '元日'),
  ('2033-01-10', '成人の日'),
  ('2033-02-11', '建国記念の日'),
  ('2033-02-23', '天皇誕生日'),
  ('2033-03-20', '春分の日'),
  ('2033-03-21', '春分の日 振替休日'),
  ('2033-04-29', '昭和の日'),
  ('2033-05-03', '憲法記念日'),
  ('2033-05-04', 'みどりの日'),
  ('2033-05-05', 'こどもの日'),
  ('2033-07-18', '海の日'),
  ('2033-08-11', '山の日'),
  ('2033-09-19', '敬老の日'),
  ('2033-09-23', '秋分の日'),
  ('2033-10-10', 'スポーツの日'),
  ('2033-11-03', '文化の日'),
  ('2033-11-23', '勤労感謝の日'),
  ('2034-01-01', '元日'),
  ('2034-01-02', '元日 振替休日'),
  ('2034-01-09', '成人の日'),
  ('2034-02-11', '建国記念の日'),
  ('2034-02-23', '天皇誕生日'),
  ('2034-03-20', '春分の日'),
  ('2034-04-29', '昭和の日'),
  ('2034-05-03', '憲法記念日'),
  ('2034-05-04', 'みどりの日'),
  ('2034-05-05', 'こどもの日'),
  ('2034-07-17', '海の日'),
  ('2034-08-11', '山の日'),
  ('2034-09-18', '敬老の日'),
  ('2034-09-23', '秋分の日'),
  ('2034-10-09', 'スポーツの日'),
  ('2034-11-03', '文化の日'),
  ('2034-11-23', '勤労感謝の日'),
  ('2035-01-01', '元日'),
  ('2035-01-08', '成人の日'),
  ('2035-02-11', '建国記念の日'),
  ('2035-02-12', '建国記念の日 振替休日'),
  ('2035-02-23', '天皇誕生日'),
  ('2035-03-21', '春分の日'),
  ('2035-04-29', '昭和の日'),
  ('2035-04-30', '昭和の日 振替休日'),
  ('2035-05-03', '憲法記念日'),
  ('2035-05-04', 'みどりの日'),
  ('2035-05-05', 'こどもの日'),
  ('2035-07-16', '海の日'),
  ('2035-08-11', '山の日'),
  ('2035-09-17', '敬老の日'),
  ('2035-09-23', '秋分の日'),
  ('2035-09-24', '秋分の日 振替休日'),
  ('2035-10-08', 'スポーツの日'),
  ('2035-11-03', '文化の日'),
  ('2035-11-23', '勤労感謝の日');

-- 反映中の鍵: 最後の書き込みから 20 分で外れたとみなす（受付側の getMonthState も同じ判定にする）
alter table public.reflection_months add column heartbeat_at timestamptz;
comment on column public.reflection_months.heartbeat_at is '反映中の最後の書き込みの日時。ここから 20 分を過ぎたら反映中でないとみなす';
comment on column public.reflection_months.reflecting is '反映中か（heartbeat_at から 20 分以内のときだけ有効）';

-- その月の最後の平日（月末日から遡って、土日でも祝日でもない最初の日）
create function public.kintai_last_weekday(p_month date) returns date
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  while extract(isodow from v_day) in (6, 7)
    or exists (select 1 from public.jp_holidays h where h.day = v_day) loop
    v_day := v_day - 1;
  end loop;
  return v_day;
end;
$$;

-- 反映を始める。断る理由が無ければ鍵をかけ、反映する記録（pending・failed）を日付順に返す
create function public.kintai_reflect_begin(p_month date, p_skip_date_check boolean default false)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_end date;
  v_state public.reflection_months;
  v_targets jsonb;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'p_month は月の 1 日で渡す: %', p_month;
  end if;
  v_end := (p_month + interval '1 month')::date;

  if not coalesce(p_skip_date_check, false)
    and (now() at time zone 'Asia/Tokyo')::date < public.kintai_last_weekday(p_month) then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;

  -- 同時に 2 回来ても二重に反映中にならないよう、月の行を作ってからロックする
  insert into public.reflection_months (month) values (p_month) on conflict (month) do nothing;
  select * into v_state from public.reflection_months m where m.month = p_month for update;

  if v_state.requested and not exists (
    select 1 from public.overtime_records r
    where r.work_date >= p_month and r.work_date < v_end and r.status <> 'reflected'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if v_state.reflecting and v_state.heartbeat_at >= now() - interval '20 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'reflecting');
  end if;

  update public.reflection_months m set reflecting = true, heartbeat_at = now() where m.month = p_month;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', r.work_date, 'minutes', r.minutes, 'status', r.status, 'failure_reason', r.failure_reason
    ) order by r.work_date), '[]'::jsonb)
    into v_targets
    from public.overtime_records r
    where r.work_date >= p_month and r.work_date < v_end and r.status in ('pending', 'failed');

  return jsonb_build_object('ok', true, 'month', to_char(p_month, 'YYYY-MM'), 'targets', v_targets);
end;
$$;

-- 1 件の結果を書く。reflected=反映済み, failed=失敗（理由つき）, no_punch=打刻が無いので記録を消す
create function public.kintai_reflect_mark(p_month date, p_day date, p_outcome text, p_reason text default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_state public.reflection_months;
  v_status text;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'p_month は月の 1 日で渡す: %', p_month;
  end if;
  if p_outcome is null or p_outcome not in ('reflected', 'failed', 'no_punch') then
    raise exception 'p_outcome は reflected / failed / no_punch のどれか: %', p_outcome;
  end if;
  if p_outcome = 'failed' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'failed には理由（p_reason）が要る';
  end if;

  -- 鍵が外れていたら（20 分たった・終わった）何もしない。Claude はここで止まる
  select * into v_state from public.reflection_months m where m.month = p_month for update;
  if not found or not v_state.reflecting or v_state.heartbeat_at is null
    or v_state.heartbeat_at < now() - interval '20 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'aborted');
  end if;

  if p_day is null or p_day < p_month or p_day >= (p_month + interval '1 month')::date then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;
  select r.status into v_status from public.overtime_records r where r.work_date = p_day for update;
  if not found or v_status = 'reflected' then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;

  if p_outcome = 'no_punch' then
    delete from public.overtime_records r where r.work_date = p_day;
  else
    update public.overtime_records r
      set status = p_outcome, failure_reason = case when p_outcome = 'failed' then p_reason end
      where r.work_date = p_day;
  end if;

  update public.reflection_months m set heartbeat_at = now(), requested = true where m.month = p_month;
  return jsonb_build_object('ok', true);
end;
$$;

-- 反映を終える。鍵を外し、その月の記録の現状を返す。
-- p_executed=true なら依頼として数える（対象 0 件の月もここで締まる）。false（ログインしていなかった等）なら数えない
create function public.kintai_reflect_end(p_month date, p_executed boolean)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_end date;
  v_requested boolean;
  v_reflected int;
  v_pending int;
  v_failed jsonb;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'p_month は月の 1 日で渡す: %', p_month;
  end if;
  v_end := (p_month + interval '1 month')::date;

  insert into public.reflection_months as m (month, requested) values (p_month, coalesce(p_executed, false))
    on conflict (month) do update set reflecting = false, requested = m.requested or excluded.requested
    returning m.requested into v_requested;

  select count(*) filter (where r.status = 'reflected'), count(*) filter (where r.status = 'pending'),
      coalesce(jsonb_agg(jsonb_build_object('day', r.work_date, 'reason', r.failure_reason)
        order by r.work_date) filter (where r.status = 'failed'), '[]'::jsonb)
    into v_reflected, v_pending, v_failed
    from public.overtime_records r
    where r.work_date >= p_month and r.work_date < v_end;

  return jsonb_build_object(
    'ok', true,
    'reflected', v_reflected,
    'failed', v_failed,
    'pending', v_pending,
    'closed', v_requested and v_pending = 0 and jsonb_array_length(v_failed) = 0
  );
end;
$$;

-- 外から /rest/v1/rpc で呼べないようにし、service role にだけ渡す
revoke execute on function
  public.kintai_last_weekday(date),
  public.kintai_reflect_begin(date, boolean),
  public.kintai_reflect_mark(date, date, text, text),
  public.kintai_reflect_end(date, boolean)
  from public, anon, authenticated;
grant execute on function
  public.kintai_last_weekday(date),
  public.kintai_reflect_begin(date, boolean),
  public.kintai_reflect_mark(date, date, text, text),
  public.kintai_reflect_end(date, boolean)
  to service_role;

-- これから作る関数にも、外部の利用者への権限を最初から付けない。
-- （誰でも呼べる PUBLIC の既定は全スキーマ共通なのでここでは外さない。関数を作るたびに from public で外す）
alter default privileges in schema public revoke execute on functions from anon, authenticated;
