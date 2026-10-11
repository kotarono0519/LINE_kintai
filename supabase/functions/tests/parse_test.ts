import { assertEquals } from "@std/assert";
import { parseMessage } from "../_shared/parse.ts";
import type { Entry, JstNow, Parsed } from "../_shared/types.ts";

// 基準日: 2026-10-06（火）の昼
const TUE: JstNow = { date: "2026-10-06", hour: 12, minute: 0 };
const at = (date: string): JstNow => ({ date, hour: 12, minute: 0 });

const set = (date: string | null, minutes: number): Entry => ({
  type: "set",
  date: date ? { kind: "date", date } : { kind: "unspecified" },
  minutes,
});
const del = (date: string | null): Entry => ({
  type: "delete",
  date: date ? { kind: "date", date } : { kind: "unspecified" },
});
const clock: Entry = { type: "clockTime" };
const entries = (...e: Entry[]): Parsed => ({ type: "entries", entries: e });
const unreadable: Parsed = { type: "unreadable" };

function check(cases: [string, Parsed][], now: JstNow = TUE) {
  for (const [text, want] of cases) {
    assertEquals(parseMessage(text, now), want, JSON.stringify(text));
  }
}

Deno.test("残業時間の書き方", () => {
  check([
    ["2時間", entries(set(null, 120))],
    ["2h", entries(set(null, 120))],
    ["2H", entries(set(null, 120))],
    ["1.5h", entries(set(null, 90))],
    ["1.5時間", entries(set(null, 90))],
    ["1時間半", entries(set(null, 90))],
    ["1h半", entries(set(null, 90))],
    ["1時間30分", entries(set(null, 90))],
    ["1h30", entries(set(null, 90))],
    ["1h30m", entries(set(null, 90))],
    ["90分", entries(set(null, 90))],
    ["90m", entries(set(null, 90))],
    ["90min", entries(set(null, 90))],
    ["90MIN", entries(set(null, 90))],
    ["45分", entries(set(null, 45))],
    ["1.25h", entries(set(null, 75))],
    ["0.1h", entries(set(null, 6))],
    ["0.33時間", entries(set(null, 20))], // 19.8 → 20
    ["16時間", entries(set(null, 960))], // 長すぎるかは受付で判定
  ]);
});

Deno.test("桁が多すぎる数も有限の整数で返す（保管で null にならないよう）", () => {
  const huge = "1" + "0".repeat(400);
  for (
    const text of [
      `${huge}時間`,
      `${huge}h半`,
      `1h${huge}`,
      `${huge}分`,
      `昨日 ${huge}時間`,
    ]
  ) {
    const parsed = parseMessage(text, TUE);
    const e = parsed.type === "entries" ? parsed.entries[0] : null;
    const minutes = e?.type === "set" ? e.minutes : NaN;
    // 受付で「長すぎる」と断られる値になる
    assertEquals(Number.isSafeInteger(minutes) && minutes > 900, true, text);
  }
});

Deno.test("0 は取り消し、操作の書き方", () => {
  check([
    ["10/3 0時間", entries(del("2026-10-03"))],
    ["10/3 0分", entries(del("2026-10-03"))],
    ["10/3 0h", entries(del("2026-10-03"))],
    ["0.004h", entries(del(null))], // 四捨五入で 0
    ["10/3 取り消し", entries(del("2026-10-03"))],
    ["10/3取消し", entries(del("2026-10-03"))],
    ["10/3 取消", entries(del("2026-10-03"))],
    ["10/3 残業なし", entries(del("2026-10-03"))],
    ["昨日 取り消し", entries(del("2026-10-05"))],
    ["昨日残業なし", entries(del("2026-10-05"))],
    ["金曜 取り消し", entries(del("2026-10-02"))],
    ["取り消し", entries(del(null))],
    ["残業なし", entries(del(null))],
    ["残業なしです", entries(del(null))],
    ["10/3 取り消しました", entries(del("2026-10-03"))],
  ]);
});

Deno.test("日付の書き方（今日・昨日・おととい・M/D・M月D日・D日）", () => {
  check([
    ["今日2時間", entries(set("2026-10-06", 120))],
    ["今日 2時間", entries(set("2026-10-06", 120))],
    ["きょう2h", entries(set("2026-10-06", 120))],
    ["昨日1.5h", entries(set("2026-10-05", 90))],
    ["きのう 1.5時間", entries(set("2026-10-05", 90))],
    ["おととい1時間半", entries(set("2026-10-04", 90))],
    ["一昨日 1h半", entries(set("2026-10-04", 90))],
    ["10/3 2時間", entries(set("2026-10-03", 120))],
    ["10/3 90分", entries(set("2026-10-03", 90))],
    ["10/03 2時間", entries(set("2026-10-03", 120))],
    ["9/29 1h", entries(set("2026-09-29", 60))],
    ["10月3日 2時間", entries(set("2026-10-03", 120))],
    ["10月3日2時間", entries(set("2026-10-03", 120))],
    ["3日2時間", entries(set("2026-10-03", 120))],
    ["3日 2時間", entries(set("2026-10-03", 120))],
  ]);
});

Deno.test("M/D の後ろに空白が無くても読む", () => {
  check([
    ["10/32時間", entries(set("2026-10-03", 120))], // 10/32 は無いので 10/3 と 2時間
    ["10/12時間", entries(set("2026-10-01", 120))], // 10/12 と「時間」は読めないので 10/1 と 2時間
    ["9/302時間", entries(set("2026-09-30", 120))],
    ["9/312時間", unreadable], // 9/31 と 2時間 に読めるが、9/31 は存在しない日付
    // 2 桁の日が存在しなくても、後ろが読めないなら 1 桁の日で読む
    ["9/31時間", entries(set("2026-09-03", 60))],
    ["4/31時間", entries(set("2026-04-03", 60))],
    ["6/31h", entries(set("2026-06-03", 60))],
    ["11/31h", entries(set("2026-11-03", 60))], // 未来（受付で断る）
    ["2/30分", entries(del("2026-02-03"))],
    ["8/31時間", entries(set("2026-08-03", 60))],
    ["9/32時間", entries(set("2026-09-03", 120))],
  ]);
  check([["2/29時間", entries(set("2027-02-02", 540))]], at("2027-03-10"));
});

Deno.test("未来の日付はそのまま返す（受付で断る）", () => {
  check([
    ["明日2時間", entries(set("2026-10-07", 120))],
    ["あした 2時間", entries(set("2026-10-07", 120))],
    ["あす2時間", entries(set("2026-10-07", 120))],
    ["あさって1h", entries(set("2026-10-08", 60))],
    ["明後日1h", entries(set("2026-10-08", 60))],
    ["10/30 1h", entries(set("2026-10-30", 60))],
    ["20日 1h", entries(set("2026-10-20", 60))],
    ["12/28 1h", entries(set("2026-12-28", 60))], // 去年の 12/28 は 92 日より前
  ]);
});

Deno.test("年をまたぐ: 1/5 に 12/28 を送ると去年", () => {
  check([
    ["12/28 2時間", entries(set("2026-12-28", 120))],
    ["12月28日 2時間", entries(set("2026-12-28", 120))],
    ["1/5 1h", entries(set("2027-01-05", 60))],
    ["1/6 1h", entries(set("2027-01-06", 60))], // 明日は今年のまま（未来）
    ["10/5 1h", entries(set("2026-10-05", 60))], // ちょうど 92 日前
    ["10/4 1h", entries(set("2027-10-04", 60))], // 93 日前なので今年（未来）
    ["昨日1h", entries(set("2027-01-04", 60))],
    ["12/28", { type: "answerDate", date: "2026-12-28" }],
  ], at("2027-01-05"));
});

Deno.test("存在しない日付は読めない", () => {
  check([
    ["2/30 2時間", unreadable],
    ["9/31 1h", unreadable],
    ["9月31日 1h", unreadable],
    ["13/1 1h", unreadable],
    ["10/0 1h", unreadable],
    ["2/29 1h", unreadable], // 2026 はうるう年でない
    ["2/30", unreadable],
  ]);
  check([["31日 1h", unreadable], ["0日 1h", unreadable]], at("2026-09-10"));
  check([["2/29 1h", entries(set("2028-02-29", 60))]], at("2028-03-01"));
});

Deno.test("曜日: 今日を含めて直近、先週は月曜始まりの前の週（今日は火曜）", () => {
  check([
    ["火曜2時間", entries(set("2026-10-06", 120))], // 今日
    ["月曜 2時間", entries(set("2026-10-05", 120))],
    ["日曜日 1h", entries(set("2026-10-04", 60))],
    ["水曜 1h", entries(set("2026-09-30", 60))],
    ["金曜日1h", entries(set("2026-10-02", 60))],
    ["先週の金曜 2時間", entries(set("2026-10-02", 120))],
    ["先週金曜 2時間", entries(set("2026-10-02", 120))],
    ["先週の 金曜日 2時間", entries(set("2026-10-02", 120))],
    ["先週の火曜 1h", entries(set("2026-09-29", 60))],
    ["先週の月曜 1h", entries(set("2026-09-28", 60))],
    ["先週の日曜 1h", entries(set("2026-10-04", 60))],
    ["先週の水曜 1h", entries(set("2026-09-30", 60))],
  ]);
});

Deno.test("曜日: 今日が日曜・月曜のとき", () => {
  // 2026-10-11 は日曜
  check([
    ["日曜 1h", entries(set("2026-10-11", 60))],
    ["月曜 1h", entries(set("2026-10-05", 60))],
    ["土曜 1h", entries(set("2026-10-10", 60))],
    ["先週の日曜 1h", entries(set("2026-10-04", 60))],
    ["先週の月曜 1h", entries(set("2026-09-28", 60))],
  ], at("2026-10-11"));
  // 2026-10-12 は月曜
  check([
    ["月曜 1h", entries(set("2026-10-12", 60))],
    ["日曜 1h", entries(set("2026-10-11", 60))],
    ["火曜 1h", entries(set("2026-10-06", 60))],
    ["先週の月曜 1h", entries(set("2026-10-05", 60))],
    ["先週の日曜 1h", entries(set("2026-10-11", 60))],
  ], at("2026-10-12"));
});

Deno.test("全角の入力", () => {
  check([
    ["１０／３　２時間", entries(set("2026-10-03", 120))],
    ["昨日１．５ｈ", entries(set("2026-10-05", 90))],
    ["２Ｈ", entries(set(null, 120))],
    ["９０ＭＩＮ", entries(set(null, 90))],
    ["１時間３０分", entries(set(null, 90))],
    ["１０月３日　取り消し", entries(del("2026-10-03"))],
    ["２１：３０まで", entries(clock)],
    [
      "昨日２時間，今日１時間",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
    ["９月分を反映して", {
      type: "reflectRequest",
      month: { year: 2026, month: 9 },
    }],
    ["１０／４", { type: "answerDate", date: "2026-10-04" }],
  ]);
});

Deno.test("添え言葉と句点", () => {
  check([
    ["今日2時間残業しました。", entries(set("2026-10-06", 120))],
    ["今日 2時間 残業した！", entries(set("2026-10-06", 120))],
    ["今日2時間残業", entries(set("2026-10-06", 120))],
    ["今日2時間しました", entries(set("2026-10-06", 120))],
    ["今日2時間です!", entries(set("2026-10-06", 120))],
    ["残業2時間", entries(set(null, 120))],
    ["残業 2時間です。", entries(set(null, 120))],
    ["昨日 残業2時間", entries(set("2026-10-05", 120))],
    ["  今日2時間  ", entries(set("2026-10-06", 120))],
  ]);
});

Deno.test("退勤時刻らしい書き方", () => {
  check([
    ["21:30まで", entries(clock)],
    ["21:30", entries(clock)],
    ["21時半に上がった", entries(clock)],
    ["21時", entries(clock)],
    ["21時30分", entries(clock)],
    ["昨日 21:30まで", entries(clock)],
    ["10/3 21時半", entries(clock)],
    ["2時間", entries(set(null, 120))], // 「時間」は時刻ではない
    ["2時間半", entries(set(null, 150))],
    ["1時間30分", entries(set(null, 90))],
  ]);
});

Deno.test("複数の日", () => {
  check([
    [
      "昨日2時間、今日1時間",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
    [
      "昨日2時間,今日1時間",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
    [
      "昨日2時間\n今日1時間",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
    [
      "昨日2時間\r\n今日1時間\n",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
    [
      "昨日2時間、、今日1時間",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
    [
      "10/1 1h、10/2 取り消し、2時間",
      entries(set("2026-10-01", 60), del("2026-10-02"), set(null, 120)),
    ],
    ["昨日2時間、21:30まで", entries(set("2026-10-05", 120), clock)],
    [
      "昨日2時間、今日1時間。",
      entries(set("2026-10-05", 120), set("2026-10-06", 60)),
    ],
  ]);
});

Deno.test("読めない区切りが 1 つでもあれば文全体を読めない", () => {
  check([
    ["昨日2時間、あいう", unreadable],
    ["昨日2時間、今日", unreadable],
    ["昨日2時間、9/31 1h", unreadable],
    ["こんにちは", unreadable],
    ["2時間くらい", unreadable],
    ["", unreadable],
    ["   ", unreadable],
    ["。", unreadable],
    ["残業しました", unreadable],
    ["13月", unreadable],
    ["13月分を反映して", unreadable],
    ["一覧 2時間", unreadable],
    ["今週の金曜 1h", unreadable],
  ]);
});

Deno.test("文全体: 一覧・反映の依頼・月", () => {
  check([
    ["一覧", { type: "list" }],
    ["一覧。", { type: "list" }],
    [" 一覧 ", { type: "list" }],
    ["反映して", { type: "reflectRequest", month: null }],
    ["反映してください", { type: "reflectRequest", month: null }],
    ["反映してください。", { type: "reflectRequest", month: null }],
    ["9月分を反映して", {
      type: "reflectRequest",
      month: { year: 2026, month: 9 },
    }],
    ["9月分反映して", {
      type: "reflectRequest",
      month: { year: 2026, month: 9 },
    }],
    ["9月を反映して", {
      type: "reflectRequest",
      month: { year: 2026, month: 9 },
    }],
    ["9月分を 反映してください", {
      type: "reflectRequest",
      month: { year: 2026, month: 9 },
    }],
    ["10月分を反映して", {
      type: "reflectRequest",
      month: { year: 2026, month: 10 },
    }],
    ["11月分を反映して", {
      type: "reflectRequest",
      month: { year: 2025, month: 11 },
    }],
    ["9月", { type: "answerMonth", year: 2026, month: 9 }],
    ["10月", { type: "answerMonth", year: 2026, month: 10 }],
    ["12月", { type: "answerMonth", year: 2025, month: 12 }],
  ]);
  check([["12月分を反映して", {
    type: "reflectRequest",
    month: { year: 2026, month: 12 },
  }]], at("2027-01-05"));
});

Deno.test("文全体: 日付だけは answerDate（未来でもそのまま）", () => {
  check([
    ["10/4", { type: "answerDate", date: "2026-10-04" }],
    ["10/4。", { type: "answerDate", date: "2026-10-04" }],
    ["10月4日", { type: "answerDate", date: "2026-10-04" }],
    ["4日", { type: "answerDate", date: "2026-10-04" }],
    ["昨日", { type: "answerDate", date: "2026-10-05" }],
    ["今日", { type: "answerDate", date: "2026-10-06" }],
    ["金曜", { type: "answerDate", date: "2026-10-02" }],
    ["先週の金曜", { type: "answerDate", date: "2026-10-02" }],
    ["明日", { type: "answerDate", date: "2026-10-07" }],
    ["10/30", { type: "answerDate", date: "2026-10-30" }],
    ["先週 の 金曜", { type: "answerDate", date: "2026-10-02" }],
    ["10/4 。", { type: "answerDate", date: "2026-10-04" }],
  ]);
});

Deno.test("文全体: 空白をまたいで数字をつなげて日付にしない", () => {
  check([
    ["10/1 1", unreadable], // 10/11 ではない
    ["1 0/1", unreadable],
    ["10/ 1", unreadable],
  ]);
  check([["11/1 2", unreadable]], at("2026-11-20"));
});
