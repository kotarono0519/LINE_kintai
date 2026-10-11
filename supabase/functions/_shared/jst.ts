// 日本時間の暦の計算。IsoDate は時差を持たない暦の日付なので、UTC の Date に載せて数える。
import type { IsoDate, JstNow, MonthKey } from "./types.ts";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const pad = (n: number) => String(n).padStart(2, "0");

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${
    pad(d.getUTCDate())
  }`;
}

/** エポックミリ秒（LINE の timestamp）を日本時間の「今」にする */
export function toJstNow(ms: number): JstNow {
  const d = new Date(ms + JST_OFFSET_MS);
  return { date: fromUtc(d), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** 年月日から IsoDate を作る。存在しない日付（2/30 など）なら null */
export function makeDate(
  year: number,
  month: number,
  day: number,
): IsoDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return fromUtc(d);
}

/** IsoDate を年・月・日に分ける */
export function splitDate(
  date: IsoDate,
): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/** n 日後（負なら前）の日付 */
export function addDays(date: IsoDate, n: number): IsoDate {
  return fromUtc(new Date(toUtc(date).getTime() + n * DAY_MS));
}

/** a から b までの日数（b が後なら正） */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / DAY_MS);
}

/** 曜日（0 = 日曜 … 6 = 土曜） */
export function weekday(date: IsoDate): number {
  return toUtc(date).getUTCDay();
}

/** その日の月 "YYYY-MM" */
export function monthKey(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

/** 月の初日と末日 */
export function monthRange(month: MonthKey): [IsoDate, IsoDate] {
  const next = monthKey(addDays(`${month}-28`, 4));
  return [`${month}-01`, addDays(`${next}-01`, -1)];
}

/** 返事に使う日付の形「10/3(金)」 */
export function formatDay(date: IsoDate): string {
  const { month, day } = splitDate(date);
  return `${month}/${day}(${WEEKDAYS[weekday(date)]})`;
}

/** 返事に使う時間の形「2時間」「1時間30分」「45分」 */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
