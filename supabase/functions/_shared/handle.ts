// 受付: 読み取った文に業務の決まりを当てはめ、記録を変えて返事の文を作る。
// 月末の反映そのものは Claude Code が行うので、「反映して」にはその頼み方を返す。

import type {
  DateQuestionPayload,
  HandlerDeps,
  IsoDate,
  JstNow,
  MonthKey,
  MonthState,
  OvertimeRecord,
  Parsed,
} from "./types.ts";
import {
  addDays,
  formatDay,
  formatDuration,
  monthKey,
  monthRange,
} from "./jst.ts";
import { parseMessage } from "./parse.ts";

/** 1 日に記録できる残業の上限（15 時間） */
const MAX_MINUTES = 900;

const EXAMPLE_LINES = [
  "今日2時間",
  "昨日 1.5h",
  "10/3 90分",
  "一覧",
  "10/3 取り消し",
].join("\n");

/** 読み取れない文への返事（送り方の例） */
export const EXAMPLES_TEXT =
  "読み取れませんでした。次のように送ってください。\n" +
  EXAMPLE_LINES;

/** 友だち追加のあいさつ */
export const FOLLOW_TEXT =
  "友だち追加ありがとうございます。平日の残業した時間を、次のように送ってください。\n" +
  EXAMPLE_LINES;

export const MSG = {
  nightQuestion: "夜中なので、何日の分か日付で答えてください（例: 10/5）",
  future: "未来の日付は受け付けていません",
  holiday: "休日の分は受け付けていません（平日の残業だけ記録します）",
  closedMonth: "反映済みの月です。クラウド勤怠で直接直してください",
  reflecting: "反映中です。反映が終わってから送ってください",
  tooLong: "残業時間が長すぎます（1 日 15 時間まで）",
  reflectedSet:
    "反映済みの記録は変えられません。クラウド勤怠で直接直してください",
  reflectedDelete:
    "反映済みの記録は取り消せません。クラウド勤怠で直接直してください",
  clockTime: "退勤時刻ではなく、残業した時間で送ってください（例: 今日2時間）",
  resend: "日付を付けて送り直してください",
} as const;

/** 「反映して」への返事。反映は LINE ではなく Claude Code に頼む */
function reflectGuideText(month: number): string {
  return `反映は Claude Code に『${month}月分を反映して』と頼んでください`;
}

/** 友だち追加（ブロック解除を含む）への返事 */
export async function handleFollow(deps: HandlerDeps): Promise<string> {
  return await withFooter(FOLLOW_TEXT, deps);
}

export async function handleText(
  text: string,
  now: JstNow,
  deps: HandlerDeps,
): Promise<string> {
  return await handleParsed(parseMessage(text, now), now, deps);
}

export async function handleParsed(
  parsed: Parsed,
  now: JstNow,
  deps: HandlerDeps,
): Promise<string> {
  const { body, askedNow } = await dispatch(parsed, now, deps);
  // 返事そのものが新しい聞き返しのときは、末尾の知らせを付けない
  return askedNow ? body : await withFooter(body, deps);
}

/** 答えていない聞き返しがあれば、末尾で知らせる（DEC-0016） */
async function withFooter(body: string, deps: HandlerDeps): Promise<string> {
  const n = await deps.store.countOpenQuestions();
  return n > 0 ? `${body}\n\n答えていない聞き返しが ${n} 件あります` : body;
}

async function dispatch(
  parsed: Parsed,
  now: JstNow,
  deps: HandlerDeps,
): Promise<{ body: string; askedNow: boolean }> {
  switch (parsed.type) {
    case "entries":
      return await handleEntries(parsed.entries, now, deps);
    case "answerDate":
      return {
        body: await handleAnswerDate(parsed.date, now, deps),
        askedNow: false,
      };
    case "list":
      return { body: await listText(now, deps), askedNow: false };
    case "reflectRequest": {
      // 月が無ければ、受け取った日の月
      const month = parsed.month?.month ?? Number(now.date.slice(5, 7));
      return { body: reflectGuideText(month), askedNow: false };
    }
    case "answerMonth": // 月の聞き返しは無いので、送り方の例
    case "unreadable":
      return { body: EXAMPLES_TEXT, askedNow: false };
  }
}

async function handleEntries(
  entries: Extract<Parsed, { type: "entries" }>["entries"],
  now: JstNow,
  deps: HandlerDeps,
): Promise<{ body: string; askedNow: boolean }> {
  const lines: string[] = [];
  const night = now.hour < 5;
  // 夜中の日付なしは、最後のものだけ預かる
  let question: DateQuestionPayload | null = null;

  for (const e of entries) {
    if (e.type === "clockTime") {
      lines.push(MSG.clockTime);
      continue;
    }
    const payload: DateQuestionPayload = e.type === "set"
      ? { action: "set", minutes: e.minutes }
      : { action: "delete" };
    if (e.date.kind === "unspecified" && night) {
      question = payload;
      continue;
    }
    const date = e.date.kind === "date" ? e.date.date : now.date;
    lines.push((await apply(date, payload, now, deps)).line);
  }

  if (question) {
    await deps.store.setDateQuestion(question);
    lines.push(MSG.nightQuestion);
  }
  return { body: lines.join("\n"), askedNow: question !== null };
}

async function handleAnswerDate(
  date: IsoDate,
  now: JstNow,
  deps: HandlerDeps,
): Promise<string> {
  const q = await deps.store.getDateQuestion();
  if (!q) return EXAMPLES_TEXT;
  const r = await apply(date, q.payload, now, deps);
  if (r.outcome === "reflecting") return r.line; // 聞き返しは残す
  // 処理の間に別の文が置いた新しい聞き返しは消さない
  await deps.store.clearDateQuestion(q.id);
  return r.outcome === "rejected" ? `${r.line}\n${MSG.resend}` : r.line;
}

/** 1 日分を確かめて記録に当てはめる。返事の 1 行と結果を返す */
async function apply(
  date: IsoDate,
  p: DateQuestionPayload,
  now: JstNow,
  deps: HandlerDeps,
): Promise<{ line: string; outcome: "done" | "reflecting" | "rejected" }> {
  const { store } = deps;
  const day = formatDay(date);
  const reject = (msg: string) => ({
    line: `${day} ${msg}`,
    outcome: "rejected" as const,
  });

  if (date > now.date) return reject(MSG.future);
  if (p.action === "set" && deps.isHoliday(date)) return reject(MSG.holiday);

  const month = monthKey(date);
  const state = await store.getMonthState(month);
  if (await isClosed(state, deps)) return reject(MSG.closedMonth);
  if (state.reflecting) {
    return { line: `${day} ${MSG.reflecting}`, outcome: "reflecting" };
  }

  if (p.action === "set") {
    // 預かった中身が壊れていても（null など）書かずに断る
    if (!(Number.isInteger(p.minutes) && p.minutes <= MAX_MINUTES)) {
      return reject(MSG.tooLong);
    }
    const old = await store.getRecord(date);
    if (old?.status === "reflected") return reject(MSG.reflectedSet);
    await store.upsertRecord(date, p.minutes);
    const line = old
      ? `${day} の残業を ${formatDuration(old.minutes)} → ${
        formatDuration(p.minutes)
      } に更新しました`
      : `${day} 残業 ${formatDuration(p.minutes)} で記録しました`;
    return { line, outcome: "done" };
  }

  const old = await store.getRecord(date);
  if (!old) return { line: `${day} の記録はありません`, outcome: "done" };
  if (old.status === "reflected") return reject(MSG.reflectedDelete);
  await store.deleteRecord(date);
  return { line: `${day} の記録を取り消しました`, outcome: "done" };
}

/** 締まった月: 反映を頼んだことがあり、反映待ちも失敗も残っていない（DEC-0013, DEC-0023） */
async function isClosed(
  state: MonthState,
  deps: HandlerDeps,
): Promise<boolean> {
  if (!state.requested) return false;
  const records = await deps.store.listRecords(...monthRange(state.month));
  return records.every((r) => r.status === "reflected");
}

/** 「一覧」: 今月分。先月が締まっていなければ先月分も前に出す */
async function listText(now: JstNow, deps: HandlerDeps): Promise<string> {
  const thisMonth = monthKey(now.date);
  const prevMonth = monthKey(addDays(`${thisMonth}-01`, -1));
  const months =
    (await isClosed(await deps.store.getMonthState(prevMonth), deps))
      ? [thisMonth]
      : [prevMonth, thisMonth];
  const blocks: string[] = [];
  for (const m of months) {
    blocks.push(monthBlock(m, await deps.store.listRecords(...monthRange(m))));
  }
  return blocks.join("\n\n");
}

function monthBlock(month: MonthKey, records: OvertimeRecord[]): string {
  const label = `${Number(month.slice(5, 7))}月`;
  if (records.length === 0) return `${label}の記録はありません`;
  const total = records.reduce((sum, r) => sum + r.minutes, 0);
  const lines = records.map((r) => {
    const mark = r.status === "reflected"
      ? " ※反映済み"
      : r.status === "failed"
      ? ` ※失敗${r.failureReason ? `: ${r.failureReason}` : ""}`
      : "";
    return `${formatDay(r.date)} ${formatDuration(r.minutes)}${mark}`;
  });
  return [`${label}（合計 ${formatDuration(total)}）`, ...lines].join("\n");
}
