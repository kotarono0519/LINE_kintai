import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  isHoliday,
  isLastWeekday,
  lastWeekdayOfMonth,
} from "../_shared/holiday.ts";

// 実行環境の時差に左右されないこと（TZ=UTC と TZ=Asia/Tokyo の両方で通す）
Deno.test("isHoliday: 土日と国民の祝日", () => {
  const cases: [string, boolean, string][] = [
    ["2026-11-03", true, "文化の日（火）"],
    ["2026-09-21", true, "敬老の日（月）"],
    ["2026-09-22", true, "国民の休日（火）"],
    ["2026-09-23", true, "秋分の日（水）"],
    ["2026-01-12", true, "成人の日（月）"],
    ["2026-05-06", true, "振替休日（水）"],
    ["2026-10-12", true, "スポーツの日（月）"],
    ["2026-01-01", true, "元日（木）"],
    ["2026-10-03", true, "土曜"],
    ["2026-10-04", true, "日曜"],
    ["2026-10-06", false, "平日（火）"],
    ["2026-10-02", false, "平日（金）"],
    ["2026-09-24", false, "平日（木）"],
    ["2026-11-04", false, "文化の日の翌日（水）"],
    ["2026-11-02", false, "文化の日の前日（月）"],
  ];
  for (const [date, want, label] of cases) {
    assertEquals(isHoliday(date), want, `${date} ${label}`);
  }
});

Deno.test("lastWeekdayOfMonth: 月末が土日・祝日なら遡る", () => {
  const cases: [string, string, string][] = [
    ["2026-10", "2026-10-30", "月末が土曜"],
    ["2026-11", "2026-11-30", "月末が平日（月）"],
    ["2026-12", "2026-12-31", "大晦日は祝日ではない（木）"],
    ["2027-01", "2027-01-29", "月末が日曜"],
    ["2029-04", "2029-04-27", "月末が振替休日（月）で、その前は土日"],
  ];
  for (const [month, want, label] of cases) {
    assertEquals(lastWeekdayOfMonth(month), want, `${month} ${label}`);
  }
});

Deno.test("isLastWeekday: 最後の平日の日だけ true", () => {
  assert(isLastWeekday("2026-10-30"));
  assertFalse(isLastWeekday("2026-10-29")); // 前日の平日
  assertFalse(isLastWeekday("2026-10-31")); // 土曜
  assert(isLastWeekday("2029-04-27"));
  assertFalse(isLastWeekday("2029-04-30")); // 振替休日
});
