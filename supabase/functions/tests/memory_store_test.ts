// メモリ上の偽物 Store が、本物の保管と同じところで失敗するかの確かめ。
import { assertEquals, assertRejects } from "@std/assert";
import { MemoryStore } from "./memory_store.ts";

Deno.test("偽物 Store: 残業時間は 1〜900 分の整数だけ書ける（DB の制約と同じ）", async () => {
  const store = new MemoryStore();
  for (const bad of [0, 901, 1.5, Infinity, NaN, null as unknown as number]) {
    await assertRejects(
      () => store.upsertRecord("2026-10-05", bad),
      Error,
      undefined,
      String(bad),
    );
  }
  await store.upsertRecord("2026-10-05", 900);
  assertEquals((await store.getRecord("2026-10-05"))?.minutes, 900);
});

Deno.test("偽物 Store: 聞き返しの中身は JSON を通して預かる（jsonb と同じ）", async () => {
  const store = new MemoryStore();
  await store.setDateQuestion({ action: "set", minutes: Infinity });
  assertEquals((await store.getDateQuestion())?.payload, {
    action: "set",
    minutes: null as unknown as number,
  });
});

Deno.test("偽物 Store: 反映中は heartbeat から 20 分以内だけ（null・期限切れは反映中でない）", async () => {
  const store = new MemoryStore();
  const t0 = Date.parse("2026-10-06T11:00:00Z");
  let nowMs = t0;
  store.now = () => nowMs;
  const reflecting = async () =>
    (await store.getMonthState("2026-10")).reflecting;

  store.seedMonth("2026-10", { reflecting: true });
  assertEquals(await reflecting(), true); // heartbeat を省くと今
  nowMs = t0 + 20 * 60 * 1000;
  assertEquals(await reflecting(), true);
  nowMs = t0 + 20 * 60 * 1000 + 1;
  assertEquals(await reflecting(), false);

  store.seedMonth("2026-10", { reflecting: true, heartbeatAt: null });
  assertEquals(await reflecting(), false);
  store.seedMonth("2026-10", { reflecting: false, heartbeatAt: nowMs });
  assertEquals(await reflecting(), false);
});
