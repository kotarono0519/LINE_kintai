// 受付（handle.ts）のテスト。読み取りに頼らないよう、Parsed を手で組んで渡す。

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  EXAMPLES_TEXT,
  FOLLOW_TEXT,
  handleFollow,
  handleParsed,
  handleText,
  MSG,
} from "../_shared/handle.ts";
import type {
  DateRef,
  Entry,
  HandlerDeps,
  IsoDate,
  JstNow,
  Parsed,
} from "../_shared/types.ts";
import { MemoryStore } from "./memory_store.ts";

// 2026-10-06 は火曜
const DAY: JstNow = { date: "2026-10-06", hour: 20, minute: 0 };
const NIGHT: JstNow = { date: "2026-10-06", hour: 2, minute: 30 };

const HOLIDAYS = new Set(["2026-09-21", "2026-09-22", "2026-09-23"]);
function fakeIsHoliday(date: IsoDate): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 || HOLIDAYS.has(date);
}

function setup(): { store: MemoryStore; deps: HandlerDeps } {
  const store = new MemoryStore();
  return { store, deps: { store, isHoliday: fakeIsHoliday } };
}

const at = (date: IsoDate): DateRef => ({ kind: "date", date });
const none: DateRef = { kind: "unspecified" };
const set = (date: DateRef, minutes: number): Entry => ({
  type: "set",
  date,
  minutes,
});
const del = (date: DateRef): Entry => ({ type: "delete", date });
const entries = (...es: Entry[]): Parsed => ({ type: "entries", entries: es });

// ---- 記録する ----

Deno.test("新しく記録する", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 120)),
    DAY,
    deps,
  );
  assertEquals(reply, "10/5(月) 残業 2時間 で記録しました");
  assertEquals(await store.getRecord("2026-10-05"), {
    date: "2026-10-05",
    minutes: 120,
    status: "pending",
    failureReason: null,
  });
});

Deno.test("日付なし・夜中でない → 送った日", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(entries(set(none, 45)), DAY, deps);
  assertEquals(reply, "10/6(火) 残業 45分 で記録しました");
  assertEquals((await store.getRecord("2026-10-06"))?.minutes, 45);
});

Deno.test("上書きする", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-10-05", 120);
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 90)),
    DAY,
    deps,
  );
  assertEquals(reply, "10/5(月) の残業を 2時間 → 1時間30分 に更新しました");
  assertEquals((await store.getRecord("2026-10-05"))?.minutes, 90);
});

Deno.test("失敗だった記録を上書きすると反映待ちに戻る", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-10-05", 120, "failed", "画面が開けない");
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 60)),
    DAY,
    deps,
  );
  assertEquals(reply, "10/5(月) の残業を 2時間 → 1時間 に更新しました");
  assertEquals(await store.getRecord("2026-10-05"), {
    date: "2026-10-05",
    minutes: 60,
    status: "pending",
    failureReason: null,
  });
});

Deno.test("複数の区切りは 1 行ずつ改行でつなぐ", async () => {
  const { deps } = setup();
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 120), { type: "clockTime" }, set(none, 60)),
    DAY,
    deps,
  );
  assertEquals(
    reply,
    [
      "10/5(月) 残業 2時間 で記録しました",
      MSG.clockTime,
      "10/6(火) 残業 1時間 で記録しました",
    ].join("\n"),
  );
});

Deno.test("退勤時刻らしい書き方は記録しない", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(entries({ type: "clockTime" }), DAY, deps);
  assertEquals(
    reply,
    "退勤時刻ではなく、残業した時間で送ってください（例: 今日2時間）",
  );
  assertEquals(store.records.size, 0);
});

// ---- 記録の断り（順番どおり） ----

Deno.test("断り: 未来", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(
    entries(set(at("2026-10-07"), 60)),
    DAY,
    deps,
  );
  assertEquals(reply, "10/7(水) 未来の日付は受け付けていません");
  assertEquals(store.records.size, 0);
});

Deno.test("断り: 未来は休日より先", async () => {
  const { deps } = setup();
  const reply = await handleParsed(
    entries(set(at("2026-10-10"), 60)),
    DAY,
    deps,
  );
  assertEquals(reply, "10/10(土) 未来の日付は受け付けていません");
});

Deno.test("断り: 土日と祝日", async () => {
  const { store, deps } = setup();
  assertEquals(
    await handleParsed(entries(set(at("2026-10-03"), 60)), DAY, deps),
    "10/3(土) 休日の分は受け付けていません（平日の残業だけ記録します）",
  );
  assertEquals(
    await handleParsed(entries(set(at("2026-09-21"), 60)), DAY, deps),
    "9/21(月) 休日の分は受け付けていません（平日の残業だけ記録します）",
  );
  assertEquals(store.records.size, 0);
});

Deno.test("断り: 休日は締まった月より先", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-09", { requested: true });
  const reply = await handleParsed(
    entries(set(at("2026-09-21"), 60)),
    DAY,
    deps,
  );
  assertStringIncludes(reply, MSG.holiday);
});

Deno.test("断り: 締まった月（頼んでいて、反映待ち・失敗が 0 件）", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-09", { requested: true });
  store.seedRecord("2026-09-29", 60, "reflected");
  const reply = await handleParsed(
    entries(set(at("2026-09-30"), 60)),
    DAY,
    deps,
  );
  assertEquals(
    reply,
    "9/30(水) 反映済みの月です。クラウド勤怠で直接直してください",
  );
  assertEquals(await store.getRecord("2026-09-30"), null);
});

Deno.test("頼んでいない月は記録 0 件でも締まらない", async () => {
  const { deps } = setup();
  const reply = await handleParsed(
    entries(set(at("2026-09-30"), 60)),
    DAY,
    deps,
  );
  assertEquals(reply, "9/30(水) 残業 1時間 で記録しました");
});

Deno.test("頼んでいても反映待ち・失敗が残っていれば締まらない", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-09", { requested: true });
  store.seedRecord("2026-09-29", 60, "failed", "画面が開けない");
  const reply = await handleParsed(
    entries(set(at("2026-09-30"), 60)),
    DAY,
    deps,
  );
  assertEquals(reply, "9/30(水) 残業 1時間 で記録しました");
});

Deno.test("断り: 締まった月は反映中より先", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-09", { requested: true, reflecting: true });
  const reply = await handleParsed(
    entries(set(at("2026-09-30"), 60)),
    DAY,
    deps,
  );
  assertStringIncludes(reply, MSG.closedMonth);
});

Deno.test("断り: 反映中の月", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-10", { reflecting: true });
  store.seedRecord("2026-10-05", 60);
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 999)),
    DAY,
    deps,
  );
  // 長すぎるより反映中が先
  assertEquals(reply, "10/5(月) 反映中です。反映が終わってから送ってください");
  assertEquals((await store.getRecord("2026-10-05"))?.minutes, 60);
});

Deno.test("断り: 900 分を超える（長すぎるは反映済みの記録より先）", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-10-05", 60, "reflected");
  assertEquals(
    await handleParsed(entries(set(at("2026-10-05"), 901)), DAY, deps),
    "10/5(月) 残業時間が長すぎます（1 日 15 時間まで）",
  );
  assertEquals(
    await handleParsed(entries(set(at("2026-10-02"), 900)), DAY, deps),
    "10/2(金) 残業 15時間 で記録しました",
  );
});

Deno.test("断り: 反映済みの記録は変えられない", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-10-05", 60, "reflected");
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 120)),
    DAY,
    deps,
  );
  assertEquals(
    reply,
    "10/5(月) 反映済みの記録は変えられません。クラウド勤怠で直接直してください",
  );
  assertEquals((await store.getRecord("2026-10-05"))?.minutes, 60);
});

// ---- 取り消し ----

Deno.test("取り消す", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-10-05", 60);
  const reply = await handleParsed(entries(del(at("2026-10-05"))), DAY, deps);
  assertEquals(reply, "10/5(月) の記録を取り消しました");
  assertEquals(await store.getRecord("2026-10-05"), null);
});

Deno.test("失敗の記録も取り消せる", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-10-05", 60, "failed", "x");
  assertEquals(
    await handleParsed(entries(del(at("2026-10-05"))), DAY, deps),
    "10/5(月) の記録を取り消しました",
  );
});

Deno.test("取り消し: 記録が無い", async () => {
  const { deps } = setup();
  assertEquals(
    await handleParsed(entries(del(at("2026-10-05"))), DAY, deps),
    "10/5(月) の記録はありません",
  );
});

Deno.test("取り消し: 休日は確かめない（記録が無いだけ）", async () => {
  const { deps } = setup();
  assertEquals(
    await handleParsed(entries(del(at("2026-10-03"))), DAY, deps),
    "10/3(土) の記録はありません",
  );
});

Deno.test("取り消しの断り: 未来・締まった月・反映中・反映済み", async () => {
  const { store, deps } = setup();
  assertEquals(
    await handleParsed(entries(del(at("2026-10-07"))), DAY, deps),
    "10/7(水) 未来の日付は受け付けていません",
  );

  store.seedMonth("2026-09", { requested: true, reflecting: true });
  assertEquals(
    await handleParsed(entries(del(at("2026-09-30"))), DAY, deps),
    "9/30(水) 反映済みの月です。クラウド勤怠で直接直してください",
  );

  store.seedMonth("2026-10", { reflecting: true });
  store.seedRecord("2026-10-05", 60, "reflected");
  assertEquals(
    await handleParsed(entries(del(at("2026-10-05"))), DAY, deps),
    "10/5(月) 反映中です。反映が終わってから送ってください",
  );

  store.seedMonth("2026-10", { reflecting: false });
  assertEquals(
    await handleParsed(entries(del(at("2026-10-05"))), DAY, deps),
    "10/5(月) 反映済みの記録は取り消せません。クラウド勤怠で直接直してください",
  );
  assertEquals((await store.getRecord("2026-10-05"))?.status, "reflected");
});

// ---- 夜中の聞き返し ----

Deno.test("夜中の日付なしは聞き返す（末尾の知らせは付けない）", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(entries(set(none, 120)), NIGHT, deps);
  assertEquals(reply, "夜中なので、何日の分か日付で答えてください（例: 10/5）");
  assertEquals(store.dateQuestion, { action: "set", minutes: 120 });
  assertEquals(store.records.size, 0);
});

Deno.test("夜中の日付なしの取り消しも聞き返す", async () => {
  const { store, deps } = setup();
  await handleParsed(entries(del(none)), NIGHT, deps);
  assertEquals(store.dateQuestion, { action: "delete" });
});

Deno.test("前の聞き返しは置き換える", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 60 };
  const reply = await handleParsed(entries(set(none, 30)), NIGHT, deps);
  assertEquals(reply, MSG.nightQuestion);
  assertEquals(store.dateQuestion, { action: "set", minutes: 30 });
});

Deno.test("日付なしが複数なら最後のものを預かり、聞き返しは 1 行", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(
    entries(set(none, 30), set(at("2026-10-05"), 60), del(none)),
    NIGHT,
    deps,
  );
  assertEquals(
    reply,
    ["10/5(月) 残業 1時間 で記録しました", MSG.nightQuestion].join("\n"),
  );
  assertEquals(store.dateQuestion, { action: "delete" });
});

Deno.test("夜中でも日付が付いていれば聞き返さない", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 60)),
    NIGHT,
    deps,
  );
  assertEquals(reply, "10/5(月) 残業 1時間 で記録しました");
  assertEquals(store.dateQuestion, null);
});

Deno.test("5 時からは夜中でない", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(entries(set(none, 60)), {
    ...NIGHT,
    hour: 5,
    minute: 0,
  }, deps);
  assertEquals(reply, "10/6(火) 残業 1時間 で記録しました");
  assertEquals(store.dateQuestion, null);
});

// ---- 日付の答え ----

Deno.test("答え: 書けたら聞き返しを消す", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 120 };
  const reply = await handleParsed(
    { type: "answerDate", date: "2026-10-05" },
    DAY,
    deps,
  );
  assertEquals(reply, "10/5(月) 残業 2時間 で記録しました");
  assertEquals(store.dateQuestion, null);
  assertEquals((await store.getRecord("2026-10-05"))?.minutes, 120);
});

Deno.test("答え: 取り消し・記録が無かったときも聞き返しを消す", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "delete" };
  store.seedRecord("2026-10-05", 60);
  assertEquals(
    await handleParsed({ type: "answerDate", date: "2026-10-05" }, DAY, deps),
    "10/5(月) の記録を取り消しました",
  );
  assertEquals(store.dateQuestion, null);

  store.dateQuestion = { action: "delete" };
  assertEquals(
    await handleParsed({ type: "answerDate", date: "2026-10-02" }, DAY, deps),
    "10/2(金) の記録はありません",
  );
  assertEquals(store.dateQuestion, null);
});

Deno.test("答え: 反映中なら聞き返しは残す", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 120 };
  store.seedMonth("2026-10", { reflecting: true });
  const reply = await handleParsed(
    { type: "answerDate", date: "2026-10-05" },
    DAY,
    deps,
  );
  assertEquals(
    reply,
    "10/5(月) 反映中です。反映が終わってから送ってください\n\n答えていない聞き返しが 1 件あります",
  );
  assertEquals(store.dateQuestion, { action: "set", minutes: 120 });
});

Deno.test("答え: ずっと通らない断りは聞き返しを消して送り直しを頼む", async () => {
  const cases: [IsoDate, string, (s: MemoryStore) => void][] = [
    ["2026-10-07", "10/7(水) 未来の日付は受け付けていません", () => {}],
    ["2026-10-03", `10/3(土) ${MSG.holiday}`, () => {}],
    [
      "2026-09-30",
      `9/30(水) ${MSG.closedMonth}`,
      (s) => s.seedMonth("2026-09", { requested: true }),
    ],
    [
      "2026-10-05",
      `10/5(月) ${MSG.reflectedSet}`,
      (s) => s.seedRecord("2026-10-05", 60, "reflected"),
    ],
  ];
  for (const [date, line, prepare] of cases) {
    const { store, deps } = setup();
    store.dateQuestion = { action: "set", minutes: 120 };
    prepare(store);
    const reply = await handleParsed({ type: "answerDate", date }, DAY, deps);
    assertEquals(reply, `${line}\n日付を付けて送り直してください`);
    assertEquals(store.dateQuestion, null);
  }
  // 長すぎる
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 901 };
  assertEquals(
    await handleParsed({ type: "answerDate", date: "2026-10-05" }, DAY, deps),
    `10/5(月) ${MSG.tooLong}\n日付を付けて送り直してください`,
  );
  assertEquals(store.dateQuestion, null);
});

Deno.test("答え: 預かった分数が壊れていたら書かずに断り、聞き返しを消す", async () => {
  const { store, deps } = setup();
  // Infinity は JSON を通ると null になる
  store.dateQuestion = JSON.parse('{"action":"set","minutes":null}');
  assertEquals(
    await handleParsed({ type: "answerDate", date: "2026-10-05" }, DAY, deps),
    `10/5(月) ${MSG.tooLong}\n日付を付けて送り直してください`,
  );
  assertEquals(store.dateQuestion, null);
  assertEquals(store.records.size, 0);
});

Deno.test("答え: 処理の間に別の文が置いた新しい聞き返しは消さない", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 120 };
  // 答えを書き込む直前に、同時に届いた「1時間」が新しい聞き返しを置く
  const upsert = store.upsertRecord.bind(store);
  store.upsertRecord = async (date, minutes) => {
    assertEquals(await handleText("1時間", NIGHT, deps), MSG.nightQuestion);
    await upsert(date, minutes);
  };
  assertEquals(
    await handleParsed({ type: "answerDate", date: "2026-10-05" }, NIGHT, deps),
    "10/5(月) 残業 2時間 で記録しました\n\n答えていない聞き返しが 1 件あります",
  );
  assertEquals(store.dateQuestion, { action: "set", minutes: 60 });
});

Deno.test("答え: 聞き返しが無ければ送り方の例", async () => {
  const { store, deps } = setup();
  const reply = await handleParsed(
    { type: "answerDate", date: "2026-10-05" },
    DAY,
    deps,
  );
  assertEquals(reply, EXAMPLES_TEXT);
  assertEquals(store.records.size, 0);
});

// ---- 一覧 ----

Deno.test("一覧: 先月が締まっていなければ先月も出す。印と合計", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-09-30", 90, "failed", "画面が開けない");
  store.seedRecord("2026-09-29", 120);
  store.seedRecord("2026-10-01", 120, "reflected");
  store.seedRecord("2026-10-05", 45);
  store.seedRecord("2026-08-31", 60); // 先々月は出さない
  const reply = await handleParsed({ type: "list" }, DAY, deps);
  assertEquals(
    reply,
    [
      "9月（合計 3時間30分）",
      "9/29(火) 2時間",
      "9/30(水) 1時間30分 ※失敗: 画面が開けない",
      "",
      "10月（合計 2時間45分）",
      "10/1(木) 2時間 ※反映済み",
      "10/5(月) 45分",
    ].join("\n"),
  );
});

Deno.test("一覧: 先月が締まっていれば今月だけ", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-09", { requested: true });
  store.seedRecord("2026-09-29", 120, "reflected");
  store.seedRecord("2026-10-05", 60);
  const reply = await handleParsed({ type: "list" }, DAY, deps);
  assertEquals(reply, "10月（合計 1時間）\n10/5(月) 1時間");
});

Deno.test("一覧: 記録の無い月", async () => {
  const { store, deps } = setup();
  assertEquals(
    await handleParsed({ type: "list" }, DAY, deps),
    "9月の記録はありません\n\n10月の記録はありません",
  );
  store.seedMonth("2026-09", { requested: true });
  assertEquals(
    await handleParsed({ type: "list" }, DAY, deps),
    "10月の記録はありません",
  );
});

Deno.test("一覧: 1 月は去年の 12 月を出す", async () => {
  const { store, deps } = setup();
  store.seedRecord("2026-12-31", 30);
  store.seedRecord("2027-01-05", 60);
  const reply = await handleParsed(
    { type: "list" },
    { date: "2027-01-06", hour: 12, minute: 0 },
    deps,
  );
  assertEquals(
    reply,
    "12月（合計 30分）\n12/31(木) 30分\n\n1月（合計 1時間）\n1/5(火) 1時間",
  );
});

// ---- 末尾の知らせ ----

Deno.test("末尾の知らせ: 処理のあとの件数で付ける", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 60 };
  const reply = await handleParsed(
    entries(set(at("2026-10-05"), 60)),
    DAY,
    deps,
  );
  assertEquals(
    reply,
    "10/5(月) 残業 1時間 で記録しました\n\n答えていない聞き返しが 1 件あります",
  );

  assertStringIncludes(
    await handleParsed({ type: "list" }, DAY, deps),
    "\n\n答えていない聞き返しが 1 件あります",
  );
  assertStringIncludes(
    await handleParsed({ type: "unreadable" }, DAY, deps),
    "\n\n答えていない聞き返しが 1 件あります",
  );
});

Deno.test("末尾の知らせ: 答えて消えたら付けない", async () => {
  const { store, deps } = setup();
  store.dateQuestion = { action: "set", minutes: 60 };
  const reply = await handleParsed(
    { type: "answerDate", date: "2026-10-05" },
    DAY,
    deps,
  );
  assertEquals(reply, "10/5(月) 残業 1時間 で記録しました");
});

// ---- そのほか ----

Deno.test("反映の依頼は Claude Code への頼み方を返す（月なしは受け取った日の月）", async () => {
  const { store, deps } = setup();
  assertEquals(
    await handleParsed({ type: "reflectRequest", month: null }, DAY, deps),
    "反映は Claude Code に『10月分を反映して』と頼んでください",
  );
  assertEquals(
    await handleParsed(
      { type: "reflectRequest", month: { year: 2026, month: 9 } },
      DAY,
      deps,
    ),
    "反映は Claude Code に『9月分を反映して』と頼んでください",
  );
  assertEquals(
    await handleParsed(
      { type: "reflectRequest", month: null },
      { date: "2026-12-30", hour: 18, minute: 0 },
      deps,
    ),
    "反映は Claude Code に『12月分を反映して』と頼んでください",
  );
  // 聞き返しの知らせは今までどおり付く
  store.dateQuestion = { action: "delete" };
  assertEquals(
    await handleParsed({ type: "reflectRequest", month: null }, DAY, deps),
    "反映は Claude Code に『10月分を反映して』と頼んでください\n\n答えていない聞き返しが 1 件あります",
  );
});

Deno.test("送り方の例に「反映して」は入れない", () => {
  assertEquals(EXAMPLES_TEXT.includes("反映"), false);
  assertEquals(FOLLOW_TEXT.includes("反映"), false);
});

Deno.test("断り: 反映中の鍵は最後の書き込みから 20 分で外れる", async () => {
  const { store, deps } = setup();
  const t0 = Date.parse("2026-10-06T11:00:00Z");
  let nowMs = t0;
  store.now = () => nowMs;
  store.seedMonth("2026-10", { reflecting: true, heartbeatAt: t0 });
  const send = () =>
    handleParsed(entries(set(at("2026-10-05"), 60)), DAY, deps);

  nowMs = t0 + 20 * 60 * 1000; // ちょうど 20 分はまだ反映中
  assertEquals(
    await send(),
    "10/5(月) 反映中です。反映が終わってから送ってください",
  );
  assertEquals(store.records.size, 0);

  nowMs = t0 + 20 * 60 * 1000 + 1; // 20 分を過ぎたら受け付ける
  assertEquals(await send(), "10/5(月) 残業 1時間 で記録しました");
});

Deno.test("断り: heartbeat が無い反映中は反映中とみなさない", async () => {
  const { store, deps } = setup();
  store.seedMonth("2026-10", { reflecting: true, heartbeatAt: null });
  assertEquals(
    await handleParsed(entries(set(at("2026-10-05"), 60)), DAY, deps),
    "10/5(月) 残業 1時間 で記録しました",
  );
});

Deno.test("月の答え・読めない文は送り方の例", async () => {
  const { deps } = setup();
  const expected = [
    "読み取れませんでした。次のように送ってください。",
    "今日2時間",
    "昨日 1.5h",
    "10/3 90分",
    "一覧",
    "10/3 取り消し",
  ].join("\n");
  assertEquals(
    await handleParsed(
      { type: "answerMonth", year: 2026, month: 9 },
      DAY,
      deps,
    ),
    expected,
  );
  assertEquals(await handleParsed({ type: "unreadable" }, DAY, deps), expected);
});

Deno.test("友だち追加のあいさつに送り方の例が入る", async () => {
  const { store, deps } = setup();
  const text = await handleFollow(deps);
  assertStringIncludes(text, "友だち追加ありがとうございます");
  assertStringIncludes(
    text,
    "今日2時間\n昨日 1.5h\n10/3 90分\n一覧\n10/3 取り消し",
  );
  assertEquals(text.includes("答えていない聞き返し"), false);
  store.dateQuestion = { action: "delete" };
  assertStringIncludes(
    await handleFollow(deps),
    "10/3 取り消し\n\n答えていない聞き返しが 1 件あります",
  );
});

// ---- handleText（読み取りから通す） ----

Deno.test("handleText: 記録と一覧", async () => {
  const { deps } = setup();
  assertEquals(
    await handleText("昨日2時間", DAY, deps),
    "10/5(月) 残業 2時間 で記録しました",
  );
  assertEquals(
    await handleText("一覧", DAY, deps),
    "9月の記録はありません\n\n10月（合計 2時間）\n10/5(月) 2時間",
  );
});

Deno.test("handleText: 夜中の日付なし → 日付の答え", async () => {
  const { store, deps } = setup();
  assertEquals(await handleText("1.5h", NIGHT, deps), MSG.nightQuestion);
  assertEquals(
    await handleText("10/5", NIGHT, deps),
    "10/5(月) 残業 1時間30分 で記録しました",
  );
  assertEquals(store.dateQuestion, null);
});

Deno.test("handleText: 読めない文", async () => {
  const { deps } = setup();
  assertEquals(await handleText("こんにちは", DAY, deps), EXAMPLES_TEXT);
});
