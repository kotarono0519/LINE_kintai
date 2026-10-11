// 毎日の受付（LINE → Supabase）で使う型の取り決め。
// 日付はすべて日本時間の暦の日付として "YYYY-MM-DD" の文字列で持つ。

/** 日本時間の暦の日付 "YYYY-MM-DD" */
export type IsoDate = string;
/** 暦の月 "YYYY-MM" */
export type MonthKey = string;

/** 受け取った時点（日本時間） */
export interface JstNow {
  date: IsoDate;
  hour: number; // 0-23
  minute: number; // 0-59
}

/** 文に書かれた日付。解決は送った日を基準に parse の中で済ませる */
export type DateRef =
  | { kind: "unspecified" } // 日付を書いていない
  | { kind: "date"; date: IsoDate }; // 解決済み（未来の日付のこともある）

/** 1 つの区切り（読点・改行で区切った 1 日分） */
export type Entry =
  | { type: "set"; date: DateRef; minutes: number } // minutes >= 1
  | { type: "delete"; date: DateRef } // 取り消し・残業なし・0時間・0分
  | { type: "clockTime" }; // 退勤時刻らしい書き方（記録しない）

/** 1 通の文を読んだ結果 */
export type Parsed =
  | { type: "entries"; entries: Entry[] } // 1 件以上
  | { type: "list" } // 「一覧」
  | { type: "reflectRequest"; month: { year: number; month: number } | null } // 「反映して」「9月分を反映して」
  | { type: "answerDate"; date: IsoDate } // 日付だけの文（聞き返しへの答えになりうる）
  | { type: "answerMonth"; year: number; month: number } // 「9月」だけの文
  | { type: "unreadable" };

export type RecordStatus = "pending" | "reflected" | "failed"; // 反映待ち／反映済み／失敗

export interface OvertimeRecord {
  date: IsoDate;
  minutes: number;
  status: RecordStatus;
  failureReason: string | null;
}

/** 夜中に日付なしで届いた分を、日付の答えが来るまで預かる中身 */
export type DateQuestionPayload =
  | { action: "set"; minutes: number }
  | { action: "delete" };

/** 預かっている日付の聞き返し。id は置くたびに変わる（消すときの取り違えを防ぐ） */
export interface DateQuestion {
  id: string;
  payload: DateQuestionPayload;
}

/** 月ごとの反映の状態。行が無い月は { reflecting: false, requested: false } とみなす */
export interface MonthState {
  month: MonthKey;
  reflecting: boolean; // 反映中（DEC-0031）。鍵が 20 分で外れたあとは false
  requested: boolean; // 実行された反映の依頼が一度はある（DEC-0023）
}

/** 反映中の鍵が自動で外れるまでの時間。最後の書き込み（heartbeat_at）からの 20 分 */
export const REFLECT_LOCK_MS = 20 * 60 * 1000;

/** 反映中か。reflecting かつ heartbeat_at が今から 20 分以内のときだけ（null なら反映中でない） */
export function isReflecting(
  reflecting: boolean,
  heartbeatAt: number | null,
  nowMs: number,
): boolean {
  return reflecting && heartbeatAt !== null &&
    nowMs - heartbeatAt <= REFLECT_LOCK_MS;
}

/** 保管（Supabase）への出入り口。テストではメモリ上の偽物に差し替える */
export interface Store {
  getRecord(date: IsoDate): Promise<OvertimeRecord | null>;
  /** from〜to（両端を含む）の記録を日付の昇順で返す */
  listRecords(from: IsoDate, to: IsoDate): Promise<OvertimeRecord[]>;
  /** 記録を作る／上書きする。状態は反映待ちに戻し、失敗の理由は消す */
  upsertRecord(date: IsoDate, minutes: number): Promise<void>;
  deleteRecord(date: IsoDate): Promise<void>;
  getMonthState(month: MonthKey): Promise<MonthState>;

  /** 答えていない日付の聞き返し（同時に 1 件まで） */
  getDateQuestion(): Promise<DateQuestion | null>;
  /** 日付の聞き返しを置く。前のものがあれば置き換える */
  setDateQuestion(payload: DateQuestionPayload): Promise<void>;
  /** 読んだ聞き返し（id）を消す。その間に置き換わっていたら消さない（同時に届いた文のため） */
  clearDateQuestion(id: string): Promise<void>;
  /** 答えていない聞き返しの件数（日付・月の両方） */
  countOpenQuestions(): Promise<number>;

  /** LINE の同じイベントを二度処理しないための印。初めてなら true、処理済みなら false */
  markEventProcessed(eventId: string): Promise<boolean>;
}

/** 受付の処理が外から受け取るもの */
export interface HandlerDeps {
  store: Store;
  isHoliday: (date: IsoDate) => boolean; // 土日・国民の祝日なら true
}
