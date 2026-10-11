// migration の SQL を PGlite（メモリ上の Postgres）に当てて、制約を確かめる。
import { PGlite } from "@electric-sql/pglite";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { toJstNow } from "../_shared/jst.ts";

const SQL_PATHS = [
  "../../migrations/20261006000000_daily_input.sql",
  "../../migrations/20261011000000_revoke_public_roles.sql",
  "../../migrations/20261012000000_month_end_reflect.sql",
].map((p) => new URL(p, import.meta.url));

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  // Supabase には最初からある役割。PGlite には無いので先に作る
  await db.exec(
    "create role service_role; create role anon; create role authenticated",
  );
  // Supabase の初期設定と同じく、public に作るものは既定で 3 つの役割に渡る
  await db.exec(
    `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
     alter default privileges in schema public grant all on functions to anon, authenticated, service_role`,
  );
  for (const path of SQL_PATHS) await db.exec(await Deno.readTextFile(path));
  return db;
}

Deno.test("migration: 残業時間は 1〜900 分だけ", async () => {
  const db = await freshDb();
  await db.query(
    "insert into overtime_records (work_date, minutes) values ('2026-10-01', 1)",
  );
  await db.query(
    "insert into overtime_records (work_date, minutes) values ('2026-10-02', 900)",
  );
  await assertRejects(() =>
    db.query(
      "insert into overtime_records (work_date, minutes) values ('2026-10-03', 0)",
    )
  );
  await assertRejects(() =>
    db.query(
      "insert into overtime_records (work_date, minutes) values ('2026-10-03', 901)",
    )
  );
  const res = await db.query<{ status: string }>(
    "select status from overtime_records where work_date = '2026-10-01'",
  );
  assertEquals(res.rows[0].status, "pending");
  await db.close();
});

Deno.test("migration: 状態は pending / reflected / failed だけ", async () => {
  const db = await freshDb();
  await db.query(
    `insert into overtime_records (work_date, minutes, status) values
     ('2026-10-01', 60, 'pending'), ('2026-10-02', 60, 'reflected'), ('2026-10-03', 60, 'failed')`,
  );
  await assertRejects(() =>
    db.query(
      "insert into overtime_records (work_date, minutes, status) values ('2026-10-05', 60, 'done')",
    )
  );
  await db.close();
});

Deno.test("migration: 1 日 1 件で、更新すると updated_at が進む", async () => {
  const db = await freshDb();
  await db.query(
    "insert into overtime_records (work_date, minutes, updated_at) values ('2026-10-01', 60, '2000-01-01')",
  );
  await assertRejects(() =>
    db.query(
      "insert into overtime_records (work_date, minutes) values ('2026-10-01', 30)",
    )
  );
  await db.query(
    "update overtime_records set minutes = 30 where work_date = '2026-10-01'",
  );
  const res = await db.query<{ old: boolean }>(
    "select updated_at < '2001-01-01' as old from overtime_records",
  );
  assertEquals(res.rows[0].old, false);
  await db.close();
});

Deno.test("migration: 聞き返しは date / month の種類ごとに 1 件", async () => {
  const db = await freshDb();
  await db.query(
    `insert into open_questions (kind, payload) values ('date', '{"action":"delete"}')`,
  );
  await db.query(
    `insert into open_questions (kind, payload) values ('month', '{}')`,
  );
  await assertRejects(() =>
    db.query(
      `insert into open_questions (kind, payload) values ('date', '{"action":"delete"}')`,
    )
  );
  await assertRejects(() =>
    db.query(`insert into open_questions (kind, payload) values ('year', '{}')`)
  );
  await assertRejects(() =>
    db.query(`insert into open_questions (kind) values ('date')`)
  );
  await db.close();
});

Deno.test("migration: 月の状態は月初の日で、既定は反映中でない・頼んでいない", async () => {
  const db = await freshDb();
  await db.query("insert into reflection_months (month) values ('2026-09-01')");
  const res = await db.query<{ reflecting: boolean; requested: boolean }>(
    "select reflecting, requested from reflection_months",
  );
  assertEquals(res.rows[0], { reflecting: false, requested: false });
  await assertRejects(() =>
    db.query("insert into reflection_months (month) values ('2026-09-15')")
  );
  await db.close();
});

Deno.test("migration: 同じイベントは二度入らない", async () => {
  const db = await freshDb();
  await db.query("insert into processed_events (event_id) values ('ev1')");
  await assertRejects(() =>
    db.query("insert into processed_events (event_id) values ('ev1')")
  );
  await db.close();
});

Deno.test("migration: すべての表で RLS が有効", async () => {
  const db = await freshDb();
  const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select relname, relrowsecurity from pg_class
     where relname in ('overtime_records', 'reflection_months', 'open_questions', 'processed_events')
     order by relname`,
  );
  assertEquals(res.rows.length, 4);
  for (const r of res.rows) assertEquals(r.relrowsecurity, true, r.relname);
  await db.close();
});

Deno.test("migration: 外部の利用者には表の権限を残さない", async () => {
  const db = await freshDb();
  const res = await db.query<{ grantee: string; privilege_type: string }>(
    `select grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
  );
  assertEquals(res.rows, []);
  const svc = await db.query<{ n: number }>(
    `select count(*)::int as n from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'service_role' and privilege_type = 'DELETE'`,
  );
  assertEquals(svc.rows[0].n, 4);
  await db.close();
});

// ---- 月末の反映 ----

type Res = Record<string, unknown>;

async function call(db: PGlite, sql: string): Promise<Res> {
  const res = await db.query<{ r: Res }>(`select ${sql} as r`);
  return res.rows[0].r;
}

async function monthRow(db: PGlite, month: string) {
  const res = await db.query<{ reflecting: boolean; requested: boolean }>(
    "select reflecting, requested from reflection_months where month = $1",
    [month],
  );
  return res.rows[0];
}

async function statusOf(db: PGlite, day: string) {
  const res = await db.query<{ status: string; failure_reason: string | null }>(
    "select status, failure_reason from overtime_records where work_date = $1",
    [day],
  );
  return res.rows[0];
}

Deno.test("migration: 最後の平日（土日・祝日を飛ばす）", async () => {
  const db = await freshDb();
  const cases: [string, string, string][] = [
    ["2026-10-01", "2026-10-30", "31 日が土曜"],
    ["2027-01-01", "2027-01-29", "30・31 日が土日"],
    ["2028-12-01", "2028-12-29", "30・31 日が土日"],
    ["2029-04-01", "2029-04-27", "30 日が振替休日（月）、28・29 日が土日"],
    ["2035-04-01", "2035-04-27", "30 日が振替休日（月）、28・29 日が土日"],
    ["2026-09-01", "2026-09-30", "30 日が平日"],
  ];
  for (const [month, want, label] of cases) {
    const res = await db.query<{ d: string }>(
      "select kintai_last_weekday($1)::text as d",
      [month],
    );
    assertEquals(res.rows[0].d, want, `${month} ${label}`);
  }
  await db.close();
});

Deno.test("migration: 祝日は 2026〜2035 年分が入っている", async () => {
  const db = await freshDb();
  const res = await db.query<{ n: number; first: string; last: string }>(
    "select count(*)::int as n, min(day)::text as first, max(day)::text as last from jp_holidays",
  );
  assertEquals(res.rows[0], {
    n: 178,
    first: "2026-01-01",
    last: "2035-11-23",
  });
  const named = await db.query<{ name: string }>(
    "select name from jp_holidays where day = '2026-09-22'",
  );
  assertEquals(named.rows[0].name, "休日"); // 国民の休日（ライブラリの名前のまま）
  await db.close();
});

Deno.test("migration: 日本時間の今日を Asia/Tokyo で出せる", async () => {
  const db = await freshDb();
  const before = toJstNow(Date.now()).date;
  const res = await db.query<{ d: string }>(
    "select ((now() at time zone 'Asia/Tokyo')::date)::text as d",
  );
  const after = toJstNow(Date.now()).date;
  assert(res.rows[0].d === before || res.rows[0].d === after, res.rows[0].d);
  await db.close();
});

Deno.test("migration: begin は最後の平日より前なら not_yet、飛ばせば通る", async () => {
  const db = await freshDb();
  assertEquals(await call(db, "kintai_reflect_begin('2035-12-01')"), {
    ok: false,
    reason: "not_yet",
  });
  assertEquals(await monthRow(db, "2035-12-01"), undefined);
  assertEquals(
    await call(db, "kintai_reflect_begin('2035-12-01', true)"),
    { ok: true, month: "2035-12", targets: [] },
  );
  await assertRejects(() =>
    call(db, "kintai_reflect_begin('2026-09-15', true)")
  );
  await db.close();
});

Deno.test("migration: begin は pending と failed を日付順に返し、鍵をかける", async () => {
  const db = await freshDb();
  await db.query(
    `insert into overtime_records (work_date, minutes, status, failure_reason) values
     ('2026-09-30', 30, 'pending', null), ('2026-09-09', 60, 'pending', null),
     ('2026-09-10', 90, 'failed', '打刻が見つからない'), ('2026-09-11', 120, 'reflected', null),
     ('2026-08-31', 45, 'pending', null), ('2026-10-01', 45, 'pending', null)`,
  );
  await db.query(
    "insert into reflection_months (month, requested) values ('2026-09-01', true)",
  );
  assertEquals(await call(db, "kintai_reflect_begin('2026-09-01')"), {
    ok: true,
    month: "2026-09",
    targets: [
      {
        day: "2026-09-09",
        minutes: 60,
        status: "pending",
        failure_reason: null,
      },
      {
        day: "2026-09-10",
        minutes: 90,
        status: "failed",
        failure_reason: "打刻が見つからない",
      },
      {
        day: "2026-09-30",
        minutes: 30,
        status: "pending",
        failure_reason: null,
      },
    ],
  });
  // 鍵がかかり、requested は変えない
  assertEquals(await monthRow(db, "2026-09-01"), {
    reflecting: true,
    requested: true,
  });
  assertEquals(await call(db, "kintai_reflect_begin('2026-09-01')"), {
    ok: false,
    reason: "reflecting",
  });
  // 頼んでいない月は requested=false のまま
  await call(db, "kintai_reflect_begin('2026-08-01')");
  assertEquals(await monthRow(db, "2026-08-01"), {
    reflecting: true,
    requested: false,
  });
  // 最後の書き込みから 21 分たつと鍵が外れたとみなす
  await db.query(
    "update reflection_months set heartbeat_at = now() - interval '21 minutes' where month = '2026-09-01'",
  );
  assertEquals((await call(db, "kintai_reflect_begin('2026-09-01')")).ok, true);
  await db.close();
});

Deno.test("migration: begin は締まった月を断る（記録 0 件も含む）", async () => {
  const db = await freshDb();
  await db.exec(
    `insert into overtime_records (work_date, minutes, status) values ('2026-09-09', 60, 'reflected');
     insert into reflection_months (month, requested) values ('2026-09-01', true), ('2026-07-01', true), ('2026-08-01', false)`,
  );
  assertEquals(await call(db, "kintai_reflect_begin('2026-09-01')"), {
    ok: false,
    reason: "closed",
  });
  assertEquals(await call(db, "kintai_reflect_begin('2026-07-01')"), {
    ok: false,
    reason: "closed",
  });
  // 頼んだことのない月は、記録 0 件でも締まっていない
  assertEquals(await call(db, "kintai_reflect_begin('2026-08-01')"), {
    ok: true,
    month: "2026-08",
    targets: [],
  });
  await db.close();
});

Deno.test("migration: mark は結果を書き、依頼として数える", async () => {
  const db = await freshDb();
  await db.query(
    `insert into overtime_records (work_date, minutes, status, failure_reason) values
     ('2026-09-09', 60, 'pending', null), ('2026-09-10', 90, 'failed', '前回の理由'),
     ('2026-09-11', 120, 'pending', null), ('2026-09-12', 30, 'pending', null)`,
  );
  await call(db, "kintai_reflect_begin('2026-09-01')");
  assertEquals((await monthRow(db, "2026-09-01")).requested, false);

  assertEquals(
    await call(
      db,
      "kintai_reflect_mark('2026-09-01', '2026-09-10', 'reflected')",
    ),
    { ok: true },
  );
  assertEquals(await statusOf(db, "2026-09-10"), {
    status: "reflected",
    failure_reason: null,
  });
  assertEquals((await monthRow(db, "2026-09-01")).requested, true);

  assertEquals(
    await call(
      db,
      "kintai_reflect_mark('2026-09-01', '2026-09-09', 'failed', '画面が開けない')",
    ),
    { ok: true },
  );
  assertEquals(await statusOf(db, "2026-09-09"), {
    status: "failed",
    failure_reason: "画面が開けない",
  });
  // 失敗には理由が要る
  await assertRejects(() =>
    call(db, "kintai_reflect_mark('2026-09-01', '2026-09-11', 'failed')")
  );
  await assertRejects(() =>
    call(db, "kintai_reflect_mark('2026-09-01', '2026-09-11', 'failed', ' ')")
  );
  await assertRejects(() =>
    call(db, "kintai_reflect_mark('2026-09-01', '2026-09-11', 'done')")
  );

  // 打刻が無い日は記録を消す
  assertEquals(
    await call(
      db,
      "kintai_reflect_mark('2026-09-01', '2026-09-11', 'no_punch')",
    ),
    { ok: true },
  );
  assertEquals(await statusOf(db, "2026-09-11"), undefined);

  // 月違い・記録無し・反映済みは bad_target
  for (const day of ["2026-10-01", "2026-08-31", "2026-09-11", "2026-09-10"]) {
    assertEquals(
      await call(
        db,
        `kintai_reflect_mark('2026-09-01', '${day}', 'reflected')`,
      ),
      { ok: false, reason: "bad_target" },
      day,
    );
  }

  // 最後の書き込みから 21 分たっていたら aborted で、何も変えない
  await db.query(
    "update reflection_months set heartbeat_at = now() - interval '21 minutes'",
  );
  assertEquals(
    await call(
      db,
      "kintai_reflect_mark('2026-09-01', '2026-09-12', 'reflected')",
    ),
    { ok: false, reason: "aborted" },
  );
  assertEquals((await statusOf(db, "2026-09-12")).status, "pending");
  await db.close();
});

Deno.test("migration: mark は反映中でない月では aborted", async () => {
  const db = await freshDb();
  await db.query(
    "insert into overtime_records (work_date, minutes) values ('2026-09-09', 60)",
  );
  // 行が無い月
  assertEquals(
    await call(
      db,
      "kintai_reflect_mark('2026-09-01', '2026-09-09', 'reflected')",
    ),
    { ok: false, reason: "aborted" },
  );
  // end で鍵を外した後
  await call(db, "kintai_reflect_begin('2026-09-01')");
  await call(db, "kintai_reflect_end('2026-09-01', true)");
  assertEquals(
    await call(
      db,
      "kintai_reflect_mark('2026-09-01', '2026-09-09', 'reflected')",
    ),
    { ok: false, reason: "aborted" },
  );
  assertEquals((await statusOf(db, "2026-09-09")).status, "pending");
  await db.close();
});

Deno.test("migration: end は鍵を外し、実行した依頼だけ数える", async () => {
  const db = await freshDb();
  // ログインしていなかった依頼は数えない
  await call(db, "kintai_reflect_begin('2026-08-01')");
  assertEquals(await call(db, "kintai_reflect_end('2026-08-01', false)"), {
    ok: true,
    reflected: 0,
    failed: [],
    pending: 0,
    closed: false,
  });
  assertEquals(await monthRow(db, "2026-08-01"), {
    reflecting: false,
    requested: false,
  });
  // 対象 0 件の月は、実行すれば締まる
  await call(db, "kintai_reflect_begin('2026-08-01')");
  assertEquals(await call(db, "kintai_reflect_end('2026-08-01', true)"), {
    ok: true,
    reflected: 0,
    failed: [],
    pending: 0,
    closed: true,
  });
  assertEquals(await monthRow(db, "2026-08-01"), {
    reflecting: false,
    requested: true,
  });
  assertEquals(await call(db, "kintai_reflect_begin('2026-08-01')"), {
    ok: false,
    reason: "closed",
  });
  // begin を経ずに呼ばれても行を作る
  assertEquals(
    (await call(db, "kintai_reflect_end('2026-06-01', true)")).closed,
    true,
  );
  await db.close();
});

Deno.test("migration: end は月の記録の現状を返す", async () => {
  const db = await freshDb();
  await db.query(
    `insert into overtime_records (work_date, minutes, status, failure_reason) values
     ('2026-09-09', 60, 'pending', null), ('2026-09-10', 90, 'pending', null),
     ('2026-09-11', 120, 'pending', null), ('2026-09-12', 30, 'reflected', null),
     ('2026-10-01', 30, 'failed', '別の月')`,
  );
  await call(db, "kintai_reflect_begin('2026-09-01')");
  await call(
    db,
    "kintai_reflect_mark('2026-09-01', '2026-09-10', 'failed', '理由B')",
  );
  await call(
    db,
    "kintai_reflect_mark('2026-09-01', '2026-09-09', 'failed', '理由A')",
  );
  await call(
    db,
    "kintai_reflect_mark('2026-09-01', '2026-09-11', 'reflected')",
  );
  assertEquals(await call(db, "kintai_reflect_end('2026-09-01', true)"), {
    ok: true,
    reflected: 2,
    failed: [{ day: "2026-09-09", reason: "理由A" }, {
      day: "2026-09-10",
      reason: "理由B",
    }],
    pending: 0,
    closed: false,
  });
  // 失敗を直して反映し終えれば締まる
  await call(db, "kintai_reflect_begin('2026-09-01')");
  await call(
    db,
    "kintai_reflect_mark('2026-09-01', '2026-09-09', 'reflected')",
  );
  await call(db, "kintai_reflect_mark('2026-09-01', '2026-09-10', 'no_punch')");
  assertEquals(await call(db, "kintai_reflect_end('2026-09-01', true)"), {
    ok: true,
    reflected: 3,
    failed: [],
    pending: 0,
    closed: true,
  });
  await db.close();
});

Deno.test("migration: 祝日の表と反映の関数は外部の利用者に渡さない", async () => {
  const db = await freshDb();
  const tables = await db.query<{ grantee: string; privilege_type: string }>(
    `select grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'jp_holidays'
       and grantee not in (select current_user)`,
  );
  assertEquals(tables.rows, [{
    grantee: "service_role",
    privilege_type: "SELECT",
  }]);
  const rls = await db.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class where relname = 'jp_holidays'",
  );
  assertEquals(rls.rows[0].relrowsecurity, true);

  const fns = [
    "kintai_last_weekday(date)",
    "kintai_reflect_begin(date, boolean)",
    "kintai_reflect_mark(date, date, text, text)",
    "kintai_reflect_end(date, boolean)",
  ];
  for (const fn of fns) {
    for (const role of ["anon", "authenticated"]) {
      const res = await db.query<{ ok: boolean }>(
        "select has_function_privilege($1, $2, 'execute') as ok",
        [role, `public.${fn}`],
      );
      assertEquals(res.rows[0].ok, false, `${role} ${fn}`);
    }
    const svc = await db.query<{ ok: boolean }>(
      "select has_function_privilege('service_role', $1, 'execute') as ok",
      [`public.${fn}`],
    );
    assertEquals(svc.rows[0].ok, true, fn);
  }
  await db.close();
});

Deno.test("migration: これから作る関数も anon・authenticated に既定で渡さない", async () => {
  const db = await freshDb();
  await db.exec(
    "create function public.later_fn() returns int language sql as 'select 1'",
  );
  const res = await db.query<{ grantee: string }>(
    `select a.grantee::regrole::text as grantee
     from pg_proc p, aclexplode(p.proacl) a
     where p.proname = 'later_fn' and a.grantee <> 0
     order by 1`,
  );
  // PUBLIC（grantee=0）の既定は残る。関数を作るたびに from public で外す
  assert(
    !res.rows.some((r) =>
      r.grantee === "anon" || r.grantee === "authenticated"
    ),
  );
  assert(res.rows.some((r) => r.grantee === "service_role"));
  await db.close();
});
