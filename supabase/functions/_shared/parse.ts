// LINE の文を決まった書き方で読む（DEC-0032）。日付の解決は送った日を基準にここで済ませる。
import { addDays, daysBetween, makeDate, splitDate, weekday } from "./jst.ts";
import type { DateRef, Entry, IsoDate, JstNow, Parsed } from "./types.ts";

/** 区切りの後ろ（日付より後）を読んだ結果 */
type Action = { type: "set"; minutes: number } | { type: "delete" };

/** 先頭の日付の候補。date が null なら存在しない日付（その読み方に決まれば読めない） */
type DateCandidate = { date: IsoDate | null; rest: string };

const RELATIVE_DAYS: [string, number][] = [
  ["一昨日", -2],
  ["おととい", -2],
  ["昨日", -1],
  ["きのう", -1],
  ["今日", 0],
  ["きょう", 0],
  ["明後日", 2],
  ["あさって", 2],
  ["明日", 1],
  ["あした", 1],
  ["あす", 1],
];
const WEEKDAY_CHARS = "日月火水木金土";

/** 退勤時刻らしい書き方: "21:30"、または「時」の後ろが「間」でない "21時" */
const CLOCK_TIME = /\d{1,2}:\d{2}|\d時(?!間)/;
/** 区切りの末尾の添え言葉と句点 */
const TRAILING_FILLER =
  /(?:\s|。|!|残業しました|残業した|残業|しました|した|です)$/;

export function parseMessage(text: string, now: JstNow): Parsed {
  const normalized = text.normalize("NFKC").toLowerCase().trim();

  // 文全体で見るもの
  const trimmed = normalized.replace(/[\s。、,.!?]+$/, "");
  const whole = trimmed.replace(/\s+/g, "");
  if (whole === "一覧") return { type: "list" };
  if (/^反映して(?:ください)?$/.test(whole)) {
    return { type: "reflectRequest", month: null };
  }
  const reflectMonth = whole.match(
    /^(\d{1,2})月(?:分を?|を)反映して(?:ください)?$/,
  );
  if (reflectMonth) {
    const month = resolveMonth(Number(reflectMonth[1]), now.date);
    if (month) return { type: "reflectRequest", month };
  }
  const onlyMonth = whole.match(/^(\d{1,2})月$/);
  if (onlyMonth) {
    const month = resolveMonth(Number(onlyMonth[1]), now.date);
    if (month) return { type: "answerMonth", ...month };
  }
  // 日付だけかは空白を残して見る（"10/1 1" を 10/11 と読まないため）
  const onlyDate = readDated(
    trimmed,
    now.date,
    (rest) => (rest === "" ? true : null),
  );
  if (onlyDate?.date.kind === "date") {
    return { type: "answerDate", date: onlyDate.date.date };
  }

  // 読点・改行で区切る。1 つでも読めなければ文全体を読めないとする
  const segments = normalized.split(/[、,\n]/).filter((s) =>
    !/^[\s。!]*$/.test(s)
  );
  const entries: Entry[] = [];
  for (const segment of segments) {
    const entry = readSegment(segment, now.date);
    if (!entry) return { type: "unreadable" };
    entries.push(entry);
  }
  return entries.length > 0
    ? { type: "entries", entries }
    : { type: "unreadable" };
}

/** 「9月」の年: 今月以前なら今年、今月より後なら去年 */
function resolveMonth(
  month: number,
  today: IsoDate,
): { year: number; month: number } | null {
  if (month < 1 || month > 12) return null;
  const now = splitDate(today);
  return { year: month <= now.month ? now.year : now.year - 1, month };
}

function readSegment(segment: string, today: IsoDate): Entry | null {
  if (CLOCK_TIME.test(segment)) return { type: "clockTime" };
  let s = segment.trim();
  while (TRAILING_FILLER.test(s)) s = s.replace(TRAILING_FILLER, "");
  const read = readDated(stripLeadingOvertime(s), today, readAction);
  return read && { ...read.value, date: read.date };
}

/** 先頭の「残業」を除く（「残業なし」は操作なので残す） */
function stripLeadingOvertime(s: string): string {
  return s.replace(/^残業(?!なし)\s*/, "");
}

/** 先頭の日付と、その後ろを読む。日付が書かれていなければ全体を後ろとして読む */
function readDated<T>(
  s: string,
  today: IsoDate,
  readRest: (rest: string) => T | null,
): { date: DateRef; value: T } | null {
  const candidates = readDate(s, today);
  if (candidates.length === 0) {
    const value = readRest(s);
    return value === null ? null : { date: { kind: "unspecified" }, value };
  }
  // 後ろまで読めた最初の候補に決める。その日付が存在しなければ読めない
  for (const c of candidates) {
    const value = readRest(c.rest.trimStart());
    if (value === null) continue;
    return c.date ? { date: { kind: "date", date: c.date }, value } : null;
  }
  return null;
}

/** 先頭の日付の候補を返す。書かれていなければ空 */
function readDate(s: string, today: IsoDate): DateCandidate[] {
  for (const [word, offset] of RELATIVE_DAYS) {
    if (s.startsWith(word)) {
      return [{ date: addDays(today, offset), rest: s.slice(word.length) }];
    }
  }

  let m = s.match(/^(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const date = resolveMonthDay(Number(m[1]), Number(m[2]), today);
    return [{ date, rest: s.slice(m[0].length) }];
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})/);
  if (m) {
    // 空白なしの "10/32時間" "9/31時間" は 10/3・9/3 と読めるよう、日の桁を短くした候補も出す
    const [, monthText, dayText] = m;
    const days = dayText.length === 2 ? [dayText, dayText[0]] : [dayText];
    return days.map((d) => ({
      date: resolveMonthDay(Number(monthText), Number(d), today),
      rest: s.slice(monthText.length + 1 + d.length),
    }));
  }

  m = s.match(/^(\d{1,2})日/);
  if (m) {
    const { year, month } = splitDate(today);
    const date = makeDate(year, month, Number(m[1]));
    return [{ date, rest: s.slice(m[0].length) }];
  }

  m = s.match(/^(先週\s*の?\s*)?([日月火水木金土])曜日?/);
  if (m) {
    const target = WEEKDAY_CHARS.indexOf(m[2]);
    const wd = weekday(today);
    const date = m[1]
      // 月曜始まりの前の週
      ? addDays(today, -((wd + 6) % 7) - 7 + ((target + 6) % 7))
      // 今日を含めて直近
      : addDays(today, -((wd - target + 7) % 7));
    return [{ date, rest: s.slice(m[0].length) }];
  }

  return [];
}

/** M/D の年: 今年のその日。未来で、去年のその日が 92 日以内なら去年 */
function resolveMonthDay(
  month: number,
  day: number,
  today: IsoDate,
): IsoDate | null {
  const { year } = splitDate(today);
  const thisYear = makeDate(year, month, day);
  if (!thisYear || thisYear <= today) return thisYear;
  const lastYear = makeDate(year - 1, month, day);
  return lastYear && daysBetween(lastYear, today) <= 92 ? lastYear : thisYear;
}

/** 日付の後ろ: 操作か残業時間 */
function readAction(rest: string): Action | null {
  const s = stripLeadingOvertime(rest);
  if (/^(?:取り?消し?|残業なし)$/.test(s)) return { type: "delete" };
  const minutes = readMinutes(s);
  if (minutes === null) return null;
  return minutes === 0 ? { type: "delete" } : { type: "set", minutes };
}

/** 残業時間を分に直す（四捨五入）。読めなければ null */
function readMinutes(s: string): number | null {
  let m = s.match(/^(\d+(?:\.\d+)?)(?:時間|h)$/);
  if (m) return finite(Math.round(Number(m[1]) * 60));
  m = s.match(/^(\d+)(?:時間|h)半$/);
  if (m) return finite(Number(m[1]) * 60 + 30);
  m = s.match(/^(\d+)(?:時間|h)(\d+)(?:分|min|m)?$/);
  if (m) return finite(Number(m[1]) * 60 + Number(m[2]));
  m = s.match(/^(\d+)(?:分|min|m)$/);
  if (m) return finite(Number(m[1]));
  return null;
}

/** 桁が多すぎる数（Infinity など）は扱える最大の整数に寄せる。
 * 受付で「長すぎる」と断るため。Infinity のまま預けると JSON で null になる */
function finite(minutes: number): number {
  return Number.isSafeInteger(minutes) ? minutes : Number.MAX_SAFE_INTEGER;
}
