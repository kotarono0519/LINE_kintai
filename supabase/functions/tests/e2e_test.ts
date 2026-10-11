// 通しの確かめ: 本物の読み取り・受付・祝日とメモリ上の Store で、1 週間ほどのやりとりをなぞる。
import { assertEquals } from "@std/assert";
import { EXAMPLES_TEXT, handleText, MSG } from "../_shared/handle.ts";
import { isHoliday } from "../_shared/holiday.ts";
import type { JstNow } from "../_shared/types.ts";
import { MemoryStore } from "./memory_store.ts";

const at = (date: string, hour: number, minute = 0): JstNow => ({
  date,
  hour,
  minute,
});

const FOOTER = "\n\n答えていない聞き返しが 1 件あります";

// [送った時刻, 送った文, 返事]。上から順に同じ Store へ送る
const CONVERSATION: [JstNow, string, string][] = [
  // 10/5(月) 当日の分を記録する
  [at("2026-10-05", 21), "今日2時間", "10/5(月) 残業 2時間 で記録しました"],
  // 10/6(火) 昨日の分を上書きし、断られる文をいくつか送る
  [
    at("2026-10-06", 20),
    "昨日 1.5h",
    "10/5(月) の残業を 2時間 → 1時間30分 に更新しました",
  ],
  [at("2026-10-06", 20), "10/3 1時間", `10/3(土) ${MSG.holiday}`],
  [at("2026-10-06", 20), "明日2時間", `10/7(水) ${MSG.future}`],
  [at("2026-10-06", 20), "21:30まで", MSG.clockTime],
  [at("2026-10-06", 20), "ありがとう", EXAMPLES_TEXT],
  // 10/7(水) 夜中に日付なし → 聞き返し。答えの前の別の送信には末尾の知らせが付く
  [at("2026-10-07", 1, 30), "2時間", MSG.nightQuestion],
  [
    at("2026-10-07", 1, 31),
    "先週の金曜 1時間",
    `10/2(金) 残業 1時間 で記録しました${FOOTER}`,
  ],
  [at("2026-10-07", 1, 32), "10/6", "10/6(火) 残業 2時間 で記録しました"],
  // 1 通に 2 日分
  [
    at("2026-10-07", 19),
    "今日1時間、昨日30分",
    "10/7(水) 残業 1時間 で記録しました\n10/6(火) の残業を 2時間 → 30分 に更新しました",
  ],
  [
    at("2026-10-07", 19),
    "一覧",
    "9月の記録はありません\n\n" +
    "10月（合計 4時間）\n" +
    "10/2(金) 1時間\n10/5(月) 1時間30分\n10/6(火) 30分\n10/7(水) 1時間",
  ],
  // 取り消し。2 度目は記録が無い
  [at("2026-10-08", 9), "10/6 取り消し", "10/6(火) の記録を取り消しました"],
  [at("2026-10-08", 9), "10/6 残業なし", "10/6(火) の記録はありません"],
  [
    at("2026-10-08", 9),
    "9月分を反映して",
    "反映は Claude Code に『9月分を反映して』と頼んでください",
  ],
  // 11/3(火) 文化の日は休日
  [at("2026-11-03", 20), "今日2時間", `11/3(火) ${MSG.holiday}`],
  // 夜中の聞き返しに休日で答えると、断って聞き返しを消す
  [at("2026-11-04", 2), "1時間", MSG.nightQuestion],
  [at("2026-11-04", 2), "11/3", `11/3(火) ${MSG.holiday}\n${MSG.resend}`],
  [at("2026-11-04", 2), "11/3", EXAMPLES_TEXT],
  [
    at("2026-11-04", 20),
    "今日 1時間30分",
    "11/4(水) 残業 1時間30分 で記録しました",
  ],
  // 先月（10 月）は締まっていないので、前に出す
  [
    at("2026-11-04", 20),
    "一覧",
    "10月（合計 3時間30分）\n" +
    "10/2(金) 1時間\n10/5(月) 1時間30分\n10/7(水) 1時間\n\n" +
    "11月（合計 1時間30分）\n11/4(水) 1時間30分",
  ],
];

Deno.test("通し: 1 週間ほどのやりとり", async () => {
  const store = new MemoryStore();
  const deps = { store, isHoliday };
  for (const [now, text, expected] of CONVERSATION) {
    assertEquals(
      await handleText(text, now, deps),
      expected,
      `${now.date} ${now.hour}時「${text}」`,
    );
  }
  assertEquals(store.dateQuestion, null);
  assertEquals(await store.countOpenQuestions(), 0);
});

Deno.test("通し: 夜中の桁が多すぎる数は、日付で答えると長すぎるとして断り、聞き返しを消す", async () => {
  const store = new MemoryStore();
  const deps = { store, isHoliday };
  const huge = "1" + "0".repeat(400) + "時間";
  assertEquals(
    await handleText(huge, at("2026-10-06", 2), deps),
    MSG.nightQuestion,
  );
  assertEquals(
    await handleText("10/5", at("2026-10-06", 20), deps),
    `10/5(月) ${MSG.tooLong}\n${MSG.resend}`,
  );
  assertEquals(store.dateQuestion, null);
  assertEquals(store.records.size, 0);
});
