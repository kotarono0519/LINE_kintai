// Store の Supabase 実装（service role で読み書きする）。
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DateQuestion,
  DateQuestionPayload,
  IsoDate,
  MonthKey,
  MonthState,
  OvertimeRecord,
  RecordStatus,
  Store,
} from "./types.ts";
import { isReflecting } from "./types.ts";

interface RecordRow {
  work_date: string;
  minutes: number;
  status: RecordStatus;
  failure_reason: string | null;
}

const RECORD_COLUMNS = "work_date, minutes, status, failure_reason";

function toRecord(row: RecordRow): OvertimeRecord {
  return {
    date: row.work_date,
    minutes: row.minutes,
    status: row.status,
    failureReason: row.failure_reason,
  };
}

/** エラーがあれば投げる（supabase-js は投げずに error で返すため） */
function check(
  error: { message: string; code?: string } | null,
  what: string,
): void {
  if (error) {
    throw new Error(
      `${what} に失敗しました: ${error.code ?? ""} ${error.message}`,
    );
  }
}

export function createSupabaseStore(client: SupabaseClient): Store {
  return {
    async getRecord(date: IsoDate) {
      const { data, error } = await client
        .from("overtime_records").select(RECORD_COLUMNS).eq("work_date", date)
        .maybeSingle();
      check(error, "記録の読み出し");
      return data ? toRecord(data as RecordRow) : null;
    },

    async listRecords(from: IsoDate, to: IsoDate) {
      const { data, error } = await client
        .from("overtime_records").select(RECORD_COLUMNS)
        .gte("work_date", from).lte("work_date", to).order("work_date", {
          ascending: true,
        });
      check(error, "記録の一覧");
      return (data as RecordRow[]).map(toRecord);
    },

    async upsertRecord(date: IsoDate, minutes: number) {
      // 状態は反映待ちに戻し、失敗の理由は消す（updated_at はトリガーが入れる）
      const { error } = await client.from("overtime_records").upsert({
        work_date: date,
        minutes,
        status: "pending",
        failure_reason: null,
      });
      check(error, "記録の書き込み");
    },

    async deleteRecord(date: IsoDate) {
      const { error } = await client.from("overtime_records").delete().eq(
        "work_date",
        date,
      );
      check(error, "記録の取り消し");
    },

    async getMonthState(month: MonthKey): Promise<MonthState> {
      const { data, error } = await client
        .from("reflection_months").select("reflecting, requested, heartbeat_at")
        .eq("month", `${month}-01`).maybeSingle();
      check(error, "月の状態の読み出し");
      return {
        month,
        reflecting: isReflecting(
          data?.reflecting ?? false,
          data?.heartbeat_at ? Date.parse(data.heartbeat_at) : null,
          Date.now(),
        ),
        requested: data?.requested ?? false,
      };
    },

    async getDateQuestion(): Promise<DateQuestion | null> {
      // 置くたびに created_at を入れ直すので、それを id にする
      const { data, error } = await client
        .from("open_questions").select("payload, created_at").eq("kind", "date")
        .maybeSingle();
      check(error, "聞き返しの読み出し");
      return data
        ? {
          id: data.created_at as string,
          payload: data.payload as DateQuestionPayload,
        }
        : null;
    },

    async setDateQuestion(payload: DateQuestionPayload) {
      const { error } = await client.from("open_questions").upsert({
        kind: "date",
        payload,
        created_at: new Date().toISOString(),
      });
      check(error, "聞き返しの書き込み");
    },

    async clearDateQuestion(id: string) {
      const { error } = await client.from("open_questions").delete()
        .eq("kind", "date").eq("created_at", id);
      check(error, "聞き返しの削除");
    },

    async countOpenQuestions() {
      const { count, error } = await client
        .from("open_questions").select("kind", { count: "exact", head: true });
      check(error, "聞き返しの数え上げ");
      return count ?? 0;
    },

    async markEventProcessed(eventId: string) {
      const { error } = await client.from("processed_events").insert({
        event_id: eventId,
      });
      if (error?.code === "23505") return false; // 主キーの重複 = 処理済み
      check(error, "イベントの印付け");
      return true;
    },
  };
}
