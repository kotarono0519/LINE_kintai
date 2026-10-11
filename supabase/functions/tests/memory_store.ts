// テスト用: メモリ上の偽物 Store。種まき用の補助つき。

import { isReflecting } from "../_shared/types.ts";
import type {
  DateQuestion,
  DateQuestionPayload,
  IsoDate,
  MonthKey,
  MonthState,
  OvertimeRecord,
  RecordStatus,
  Store,
} from "../_shared/types.ts";

export class MemoryStore implements Store {
  records = new Map<IsoDate, OvertimeRecord>();
  /** 月の行（heartbeat_at は epoch ミリ秒。null は未設定） */
  months = new Map<
    MonthKey,
    { reflecting: boolean; requested: boolean; heartbeatAt: number | null }
  >();
  /** 現在時刻（ミリ秒）。20 分の期限を確かめるために外から差し替える */
  now: () => number = () => Date.now();
  dateQuestion: DateQuestionPayload | null = null;
  /** 聞き返しを置くたびに増える番号（Store の id の代わり） */
  dateQuestionVersion = 0;
  processed = new Set<string>();

  /** 記録を直接置く */
  seedRecord(
    date: IsoDate,
    minutes: number,
    status: RecordStatus = "pending",
    failureReason: string | null = null,
  ): void {
    this.records.set(date, { date, minutes, status, failureReason });
  }

  /** 月の状態を直接置く。reflecting: true で heartbeatAt を省くと、今を最後の書き込みとする */
  seedMonth(
    month: MonthKey,
    state: {
      reflecting?: boolean;
      requested?: boolean;
      heartbeatAt?: number | null;
    },
  ): void {
    const reflecting = state.reflecting ?? false;
    this.months.set(month, {
      reflecting,
      requested: state.requested ?? false,
      heartbeatAt: state.heartbeatAt !== undefined
        ? state.heartbeatAt
        : reflecting
        ? this.now()
        : null,
    });
  }

  getRecord(date: IsoDate): Promise<OvertimeRecord | null> {
    const r = this.records.get(date);
    return Promise.resolve(r ? { ...r } : null);
  }

  listRecords(from: IsoDate, to: IsoDate): Promise<OvertimeRecord[]> {
    const list = [...this.records.values()]
      .filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r }));
    return Promise.resolve(list);
  }

  upsertRecord(date: IsoDate, minutes: number): Promise<void> {
    // DB の制約（minutes int not null check between 1 and 900）と同じところで失敗する
    if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= 900)) {
      return Promise.reject(new Error(`残業時間の制約違反: ${minutes}`));
    }
    this.records.set(date, {
      date,
      minutes,
      status: "pending",
      failureReason: null,
    });
    return Promise.resolve();
  }

  deleteRecord(date: IsoDate): Promise<void> {
    this.records.delete(date);
    return Promise.resolve();
  }

  getMonthState(month: MonthKey): Promise<MonthState> {
    const row = this.months.get(month);
    return Promise.resolve({
      month,
      reflecting: row
        ? isReflecting(row.reflecting, row.heartbeatAt, this.now())
        : false,
      requested: row?.requested ?? false,
    });
  }

  getDateQuestion(): Promise<DateQuestion | null> {
    const q = this.dateQuestion;
    return Promise.resolve(
      q ? { id: String(this.dateQuestionVersion), payload: q } : null,
    );
  }

  setDateQuestion(payload: DateQuestionPayload): Promise<void> {
    // jsonb と同じく JSON を通して預かる（Infinity は null になる）
    this.dateQuestion = JSON.parse(JSON.stringify(payload));
    this.dateQuestionVersion++;
    return Promise.resolve();
  }

  clearDateQuestion(id: string): Promise<void> {
    if (id === String(this.dateQuestionVersion)) this.dateQuestion = null;
    return Promise.resolve();
  }

  countOpenQuestions(): Promise<number> {
    return Promise.resolve(this.dateQuestion ? 1 : 0);
  }

  markEventProcessed(eventId: string): Promise<boolean> {
    if (this.processed.has(eventId)) return Promise.resolve(false);
    this.processed.add(eventId);
    return Promise.resolve(true);
  }
}
