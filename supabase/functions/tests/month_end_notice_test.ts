// 18:00 の合図の入口（createHandler）の確かめ。保管・時刻・push は偽物に差し替える。
import { assertEquals } from "@std/assert";
import {
  createHandler,
  type NoticeDeps,
  type NoticeEnv,
  noticeText,
} from "../month-end-notice/index.ts";
import { MemoryStore } from "./memory_store.ts";

const SECRET = "test-cron-secret";
const ME = "U-me";

// 日本時間の 2026-10-30 18:00（最後の平日）と 2026-10-29 18:00 を UTC のミリ秒で
const LAST_WEEKDAY_MS = Date.parse("2026-10-30T09:00:00Z");
const NOT_LAST_MS = Date.parse("2026-10-29T09:00:00Z");

function setup(
  opts: { env?: Partial<NoticeEnv>; nowMs?: number; pushFails?: boolean } = {},
) {
  const store = new MemoryStore();
  const pushes: { to: string; text: string }[] = [];
  const deps: NoticeDeps = {
    store,
    now: () => opts.nowMs ?? LAST_WEEKDAY_MS,
    push: (to, text) => {
      if (opts.pushFails) {
        return Promise.reject(new Error("LINE が落ちています"));
      }
      pushes.push({ to, text });
      return Promise.resolve();
    },
  };
  const handler = createHandler(
    { cronSecret: SECRET, userId: ME, ...opts.env },
    () => deps,
  );
  return { handler, store, pushes };
}

function post(
  handler: (req: Request) => Promise<Response>,
  opts: { auth?: string | null; body?: string; method?: string } = {},
) {
  const headers = new Headers();
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  if (auth !== null) headers.set("authorization", auth);
  return handler(
    new Request("http://localhost/month-end-notice", {
      method: opts.method ?? "POST",
      headers,
      body: opts.method === "GET" ? undefined : opts.body ?? "{}",
    }),
  );
}

Deno.test("noticeText: 月はその日の月。聞き返しがあれば末尾に件数", () => {
  assertEquals(
    noticeText("2026-10-30", 0),
    "今日は今月の最後の平日です。今日の残業を送ってから、Claude Code に『10月分を反映して』と頼んでください",
  );
  assertEquals(
    noticeText("2026-12-31", 2),
    "今日は今月の最後の平日です。今日の残業を送ってから、Claude Code に『12月分を反映して』と頼んでください\n\n答えていない聞き返しが 2 件あります",
  );
});

Deno.test("合図: 最後の平日なら本人に push する", async () => {
  const { handler, pushes } = setup();
  const res = await post(handler);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    sent: true,
    date: "2026-10-30",
    month: "2026-10",
  });
  assertEquals(pushes, [{ to: ME, text: noticeText("2026-10-30", 0) }]);
});

Deno.test("合図: 最後の平日でなければ送らない", async () => {
  const { handler, pushes } = setup({ nowMs: NOT_LAST_MS });
  const res = await post(handler);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { sent: false, date: "2026-10-29" });
  assertEquals(pushes.length, 0);
});

Deno.test("合図: 日本時間の日付で判定する（UTC では前日の 23:30 でも日本は翌日）", async () => {
  // UTC 2026-10-29 15:30 = 日本時間 2026-10-30 00:30
  const { handler } = setup({ nowMs: Date.parse("2026-10-29T15:30:00Z") });
  const res = await post(handler);
  assertEquals((await res.json()).date, "2026-10-30");
});

Deno.test("合図: 本文の date があればその日で判定する", async () => {
  const { handler, pushes } = setup({ nowMs: NOT_LAST_MS });
  const res = await post(handler, { body: '{"date":"2026-11-30"}' });
  assertEquals(await res.json(), {
    sent: true,
    date: "2026-11-30",
    month: "2026-11",
  });
  assertEquals(pushes[0].text, noticeText("2026-11-30", 0));

  const res2 = await post(handler, { body: '{"date":"2026-10-31"}' });
  assertEquals(await res2.json(), { sent: false, date: "2026-10-31" });
  assertEquals(pushes.length, 1);
});

Deno.test("合図: date が正しくなければ 400（送らない）", async () => {
  const { handler, pushes } = setup();
  for (
    const body of [
      '{"date":"2026-02-30"}',
      '{"date":"10/30"}',
      '{"date":20261030}',
      "not json",
    ]
  ) {
    const res = await post(handler, { body });
    assertEquals(res.status, 400, body);
    await res.body?.cancel();
  }
  assertEquals(pushes.length, 0);
});

Deno.test("合図: 本文が空でも今日の日付で動く", async () => {
  const { handler } = setup();
  const res = await post(handler, { body: "" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).sent, true);
});

Deno.test("合図: 答えていない聞き返しの件数を末尾に付ける", async () => {
  const { handler, store, pushes } = setup();
  await store.setDateQuestion({ action: "set", minutes: 60 });
  const res = await post(handler);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(pushes[0].text, noticeText("2026-10-30", 1));
  assertEquals(
    pushes[0].text.endsWith("答えていない聞き返しが 1 件あります"),
    true,
  );
});

Deno.test("合図: 合言葉が違う・無い・未設定なら 401 で何もしない", async () => {
  const cases: { auth: string | null; env?: Partial<NoticeEnv> }[] = [
    { auth: "Bearer wrong" },
    { auth: `Bearer ${SECRET}x` },
    { auth: SECRET }, // Bearer が無い
    { auth: null },
    { auth: "Bearer " },
    { auth: "Bearer ", env: { cronSecret: undefined } }, // 未設定は空の Bearer でも通さない
    { auth: `Bearer ${SECRET}`, env: { cronSecret: undefined } },
    { auth: "Bearer ", env: { cronSecret: "" } },
  ];
  for (const c of cases) {
    const { handler, pushes } = setup({ env: c.env });
    const res = await post(handler, { auth: c.auth });
    assertEquals(res.status, 401, JSON.stringify(c));
    await res.body?.cancel();
    assertEquals(pushes.length, 0);
  }
});

Deno.test("合図: POST 以外は 405", async () => {
  const { handler } = setup();
  const res = await post(handler, { method: "GET" });
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test("合図: LINE_USER_ID が未設定なら 500。最後の平日でなければ要らない", async () => {
  const noUser = setup({ env: { userId: undefined } });
  const res = await post(noUser.handler);
  assertEquals(res.status, 500);
  await res.body?.cancel();

  const off = setup({ env: { userId: undefined }, nowMs: NOT_LAST_MS });
  const res2 = await post(off.handler);
  assertEquals(res2.status, 200);
  await res2.body?.cancel();
});

Deno.test("合図: push に失敗したら 502", async () => {
  const { handler } = setup({ pushFails: true });
  const res = await post(handler);
  assertEquals(res.status, 502);
  await res.body?.cancel();
});

Deno.test("合図: 部品の準備に失敗したら 500", async () => {
  const handler = createHandler({ cronSecret: SECRET, userId: ME }, () => {
    throw new Error("環境変数が無い");
  });
  const res = await post(handler);
  assertEquals(res.status, 500);
  await res.body?.cancel();
});
