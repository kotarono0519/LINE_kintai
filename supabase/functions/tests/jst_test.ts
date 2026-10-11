import { assertEquals } from "@std/assert";
import {
  addDays,
  daysBetween,
  formatDay,
  formatDuration,
  makeDate,
  monthKey,
  monthRange,
  splitDate,
  toJstNow,
  weekday,
} from "../_shared/jst.ts";

Deno.test("toJstNow: エポックミリ秒を日本時間にする", () => {
  const cases: [number, ReturnType<typeof toJstNow>][] = [
    [Date.UTC(2026, 9, 5, 15, 0), { date: "2026-10-06", hour: 0, minute: 0 }],
    [Date.UTC(2026, 9, 5, 14, 59), {
      date: "2026-10-05",
      hour: 23,
      minute: 59,
    }],
    [Date.UTC(2026, 9, 5, 19, 59), { date: "2026-10-06", hour: 4, minute: 59 }],
    [Date.UTC(2026, 11, 31, 15, 30), {
      date: "2027-01-01",
      hour: 0,
      minute: 30,
    }],
    [Date.UTC(2026, 9, 6, 3, 15), { date: "2026-10-06", hour: 12, minute: 15 }],
  ];
  for (const [ms, want] of cases) assertEquals(toJstNow(ms), want);
});

Deno.test("addDays: 月・年・うるう日をまたぐ", () => {
  const cases: [string, number, string][] = [
    ["2026-10-06", 0, "2026-10-06"],
    ["2026-10-06", -6, "2026-09-30"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-03-29", 1, "2026-03-30"],
  ];
  for (const [d, n, want] of cases) {
    assertEquals(addDays(d, n), want, `${d} ${n}`);
  }
});

Deno.test("makeDate: 存在しない日付は null", () => {
  assertEquals(makeDate(2026, 10, 3), "2026-10-03");
  assertEquals(makeDate(2028, 2, 29), "2028-02-29");
  assertEquals(makeDate(2026, 2, 29), null);
  assertEquals(makeDate(2026, 2, 30), null);
  assertEquals(makeDate(2026, 9, 31), null);
  assertEquals(makeDate(2026, 13, 1), null);
  assertEquals(makeDate(2026, 1, 0), null);
  assertEquals(makeDate(2026, 1, 32), null);
});

Deno.test("比較・日数・曜日・月", () => {
  assertEquals(daysBetween("2026-10-05", "2027-01-05"), 92);
  assertEquals(daysBetween("2027-01-05", "2026-12-28"), -8);
  assertEquals(weekday("2026-10-04"), 0); // 日
  assertEquals(weekday("2026-10-05"), 1); // 月
  assertEquals(weekday("2026-10-10"), 6); // 土
  assertEquals(monthKey("2026-10-06"), "2026-10");
  assertEquals(splitDate("2026-01-05"), { year: 2026, month: 1, day: 5 });
  assertEquals(monthRange("2026-09"), ["2026-09-01", "2026-09-30"]);
  assertEquals(monthRange("2028-02"), ["2028-02-01", "2028-02-29"]);
  assertEquals(monthRange("2026-12"), ["2026-12-01", "2026-12-31"]);
});

Deno.test("formatDay: 「10/3(土)」の形", () => {
  const cases: [string, string][] = [
    ["2026-10-03", "10/3(土)"],
    ["2026-10-02", "10/2(金)"],
    ["2026-09-29", "9/29(火)"],
    ["2026-12-28", "12/28(月)"],
    ["2026-10-04", "10/4(日)"],
  ];
  for (const [d, want] of cases) assertEquals(formatDay(d), want);
});

Deno.test("formatDuration: 「2時間」「1時間30分」「45分」", () => {
  const cases: [number, string][] = [
    [120, "2時間"],
    [90, "1時間30分"],
    [45, "45分"],
    [60, "1時間"],
    [1, "1分"],
    [900, "15時間"],
    [61, "1時間1分"],
  ];
  for (const [m, want] of cases) assertEquals(formatDuration(m), want);
});
