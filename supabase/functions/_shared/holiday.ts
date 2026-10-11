// 休日の判定（土日・国民の祝日）。
// ライブラリの isHoliday(Date) は実行環境の時差で日付を作るので使わず、
// "YYYY-MM-DD" をキーにした祝日の一覧を直接引く（Edge は UTC で動くため）。
import holidayJp from "@holiday-jp/holiday_jp";
import { addDays, monthKey, monthRange, weekday } from "./jst.ts";
import type { IsoDate, MonthKey } from "./types.ts";

/** 土日・国民の祝日（振替休日・国民の休日を含む）なら true */
export function isHoliday(date: IsoDate): boolean {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return true;
  return Object.hasOwn(holidayJp.holidays, date);
}

/** 月の最後の平日。月末日から遡って、土日でも国民の祝日でもない最初の日 */
export function lastWeekdayOfMonth(month: MonthKey): IsoDate {
  let date = monthRange(month)[1];
  while (isHoliday(date)) date = addDays(date, -1);
  return date;
}

/** その日がその月の最後の平日なら true */
export function isLastWeekday(date: IsoDate): boolean {
  return date === lastWeekdayOfMonth(monthKey(date));
}
