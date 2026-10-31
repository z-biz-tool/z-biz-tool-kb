/**
 * kb 仓深链语义层的单测。
 *
 * 跑法：node --experimental-strip-types --test tests/deepLink.test.ts
 *
 * 语义层是纯函数，所以这里不碰 Tauri、不碰 store，只喂 Handoff 看结果。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveKbDeepLink } from "../src/_shared/deepLink.ts";
import type { Handoff } from "z-biz-tool-shared/protocol";

function handoff(action: string, params: Record<string, string> = {}): Handoff {
  return { product: "kb", action, params };
}

test("open 带 doc：定位到该文档", () => {
  const out = resolveKbDeepLink(handoff("open", { doc: "d-42" }));
  assert.equal(out.problem, null);
  assert.equal(out.docId, "d-42");
});

test("action 缺省按 open 处理", () => {
  const out = resolveKbDeepLink(handoff("", { doc: "d-42" }));
  assert.equal(out.problem, null);
  assert.equal(out.docId, "d-42");
});

test("name 是可读兜底（发深链的人只有文件名）", () => {
  const out = resolveKbDeepLink(handoff("open", { name: "产品手册.pdf" }));
  assert.equal(out.problem, null);
  assert.equal(out.docName, "产品手册.pdf");
  assert.equal(out.docId, null);
});

test("id 与 name 同时给时以 id 为准，name 一并保留", () => {
  const out = resolveKbDeepLink(handoff("open", { doc: "d-42", name: "产品手册.pdf" }));
  assert.equal(out.docId, "d-42");
  assert.equal(out.docName, "产品手册.pdf");
});

test("既没有 doc 也没有 name：接不住并说明原因", () => {
  const out = resolveKbDeepLink(handoff("open"));
  assert.equal(out.docId, null);
  assert.equal(out.docName, null);
  assert.match(out.problem ?? "", /doc|name/);
});

test("ask 带 q：把问题填进提问框", () => {
  const out = resolveKbDeepLink(handoff("ask", { q: "这份文档讲了什么" }));
  assert.equal(out.problem, null);
  assert.equal(out.question, "这份文档讲了什么");
});

test("ask 但没给问题：接不住并说明原因", () => {
  const out = resolveKbDeepLink(handoff("ask"));
  assert.equal(out.question, null);
  assert.match(out.problem ?? "", /q/);
});

test("不认识的动作：接不住并说明是哪个动作", () => {
  const out = resolveKbDeepLink(handoff("delete", { doc: "d-42" }));
  assert.equal(out.docId, null);
  assert.match(out.problem ?? "", /delete/);
});

test("from 参数透传出来（用于提示与日志）", () => {
  const out = resolveKbDeepLink(handoff("open", { doc: "d-42", from: "box" }));
  assert.equal(out.from, "box");
});

test("标识前后空格被裁掉（深链解析容易带上）", () => {
  const out = resolveKbDeepLink(handoff("open", { doc: "  d-42  " }));
  assert.equal(out.docId, "d-42");
});

test("空字符串等同于没有标识", () => {
  const out = resolveKbDeepLink(handoff("open", { doc: "   " }));
  assert.equal(out.docId, null);
  assert.ok(out.problem);
});
