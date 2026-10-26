// docView —— 文档列表/详情展示口径的回归（无 React、无 DOM）。
// 跑法：node --experimental-strip-types --test tests/*.test.ts
//
// 为什么测它：这些函数决定用户看到的「大小 / 时间 / 状态 / 确认文案」。
// 编造数值比报错更难被发现：Invalid Date 会渲染成 "NaN/NaN NaN:NaN"，
// 认不出的状态曾被默认显示成「就绪」—— 都是在替后端编状态。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clearChatConfirmText,
  detailTruncationNote,
  formatSize,
  formatTime,
  getStatusInfo,
} from "../src/lib/docView.ts";

test("formatSize：正常区间按 B/KB/MB 展示", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(2048), "2.0 KB");
  assert.equal(formatSize(1024 * 1024 * 1.5), "1.5 MB");
});

test("formatSize：负数/NaN/Infinity 显示 —，不编造数字", () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatSize(bad), "—", `${bad} 不该被格式化成一个数字`);
  }
});

test("formatTime：非法/空时间显示 —（原来会显示 NaN/NaN NaN:NaN）", () => {
  for (const bad of ["", "not-a-date", "2026-99-99T99:99:99Z"]) {
    assert.equal(formatTime(bad), "—", `${JSON.stringify(bad)} 应显示 —`);
  }
});

test("formatTime：合法 RFC3339 输出 M/D HH:mm", () => {
  const out = formatTime("2026-01-01T00:00:00Z");
  assert.match(out, /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  assert.notEqual(out, "—");
});

test("getStatusInfo：就绪/处理中/失败三态按大小写与空格归一", () => {
  assert.deepEqual(getStatusInfo(" READY "), { label: "就绪", className: "ready" });
  assert.deepEqual(getStatusInfo("done"), { label: "就绪", className: "ready" });
  assert.deepEqual(getStatusInfo("pending"), { label: "处理中", className: "processing" });
  assert.deepEqual(getStatusInfo("Error"), { label: "失败", className: "failed" });
});

test("getStatusInfo：认不出的状态不再是「就绪」，而是「未知」", () => {
  for (const unknown of ["", "trashed", "weird-state"]) {
    assert.deepEqual(
      getStatusInfo(unknown),
      { label: "未知", className: "unknown" },
      `${JSON.stringify(unknown)} 不该被冒充成就绪`
    );
  }
});

test("clearChatConfirmText：包含消息条数与不可恢复的后果", () => {
  const text = clearChatConfirmText(7);
  assert.ok(text.includes("7 条"), text);
  assert.ok(text.includes("无法恢复"), text);
  // 无法计数时也不能编一个数字，仍要说明后果
  assert.ok(clearChatConfirmText(0).includes("无法恢复"));
  assert.ok(clearChatConfirmText(Number.NaN).includes("无法恢复"));
  assert.ok(clearChatConfirmText(-3).includes("无法恢复"));
});

test("detailTruncationNote：只在真的截断时提示，并给出真实总数", () => {
  assert.equal(detailTruncationNote(20, 20), null);
  assert.equal(detailTruncationNote(20, 3), null);
  assert.equal(detailTruncationNote(Number.NaN, 3), null);
  const note = detailTruncationNote(20, 41);
  assert.ok(note?.includes("20"), note ?? "");
  assert.ok(note?.includes("41"), note ?? "");
});
