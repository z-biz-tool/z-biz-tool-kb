// sanitizeChat / isChatMessage —— localStorage 脏数据入口防线的回归（无 React、无 DOM）。
// 跑法：node --experimental-strip-types --test tests/*.test.ts
//
// 为什么它们该有测试：readSnapshot() 从 localStorage 读出一段**完全不可控**的 JSON
// （用户手改、跨版本残留、写到一半被关掉、别的扩展写坏），然后交给 sanitizeChat。
// 形状不对的东西全靠这两个函数滤掉 —— 滤漏一条，脏消息就会直接进聊天界面。
// 它们此前是模块私有的，整条防线一次都没被执行过。
//
// 注：knowledgeStore.ts 依赖 zustand 与 @tauri-apps/api，本仓没装
// node_modules，所以这里用 module.registerHooks 把它们短路到 data: URL 桩。
// 桩只为让模块能加载 —— 被测的两个是纯函数，一个字节都不碰桩。
import { test } from "node:test";
import assert from "node:assert/strict";
import module from "node:module";

const STUBS: Record<string, string> = {
  // 只需让模块能加载完：create 返回带 subscribe 的假 store
  zustand:
    "export const create=(fn)=>{let s;const subs=[];" +
    "const set=(p)=>{const n=typeof p==='function'?p(s):p;s={...s,...n};subs.forEach(f=>f(s));};" +
    "s=fn((x)=>x,()=>s);const use=(sel)=>typeof sel==='function'?sel(s):s;" +
    "use.subscribe=(f)=>{subs.push(f);return()=>{};};return use;};",
  "@tauri-apps/api/core": 'export const invoke=async()=>{throw new Error("no tauri");};',
  "@tauri-apps/api/event": "export const listen=async()=>()=>{};",
};

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = STUBS[specifier];
    if (src) {
      return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { isChatMessage, sanitizeChat } = await import("../src/stores/knowledgeStore.ts");

const msg = (role: string, content: string) => ({ role, content });

/* ------------------------------------------------------------------ *
 * isChatMessage：类型守卫
 * ------------------------------------------------------------------ */

test("两种合法 role 都放行", () => {
  assert.equal(isChatMessage(msg("user", "你好")), true);
  assert.equal(isChatMessage(msg("assistant", "在的")), true);
});

test("非 user/assistant 的 role 一律拒 —— system/tool 的消息不该混进历史", () => {
  for (const role of ["system", "tool", "USER", "Assistant", "", "user "]) {
    assert.equal(isChatMessage(msg(role, "x")), false, `role=${JSON.stringify(role)} 不该通过`);
  }
});

test("content 必须是字符串", () => {
  assert.equal(isChatMessage({ role: "user", content: 42 }), false);
  assert.equal(isChatMessage({ role: "user", content: null }), false);
  assert.equal(isChatMessage({ role: "user", content: ["a"] }), false);
  assert.equal(isChatMessage({ role: "user" }), false);
  // 空字符串是合法内容：用户可以发空消息框以外的空回复，不该被滤掉
  assert.equal(isChatMessage(msg("user", "")), true);
});

test("非对象一律拒（含 null / 数组 / 原始值）", () => {
  for (const bad of [null, undefined, 0, 1, "", "user", true, [], [msg("user", "x")]]) {
    assert.equal(isChatMessage(bad), false, `${JSON.stringify(bad)} 不该通过`);
  }
});

/* ------------------------------------------------------------------ *
 * sanitizeChat：整份快照的清洗
 * ------------------------------------------------------------------ */

test("正常快照原样保留", () => {
  const snap = { messages: [msg("user", "a"), msg("assistant", "b")], draft: "草稿" };
  assert.deepEqual(sanitizeChat(snap), snap);
});

test("messages 不是数组时退回空数组，不抛", () => {
  for (const bad of [{}, { messages: null }, { messages: "abc" },
                     { messages: { 0: msg("user", "x") } }]) {
    const out = sanitizeChat(bad);
    assert.deepEqual(out.messages, [], `${JSON.stringify(bad)} 应当退回空数组`);
    assert.equal(typeof out.draft, "string");
  }
});

test("null / undefined 不炸", () => {
  assert.deepEqual(sanitizeChat(null), { messages: [], draft: "" });
  assert.deepEqual(sanitizeChat(undefined), { messages: [], draft: "" });
});

test("draft 非字符串退回空串", () => {
  assert.equal(sanitizeChat({ messages: [], draft: 5 }).draft, "");
  assert.equal(sanitizeChat({ messages: [], draft: null }).draft, "");
  assert.equal(sanitizeChat({ messages: [], draft: { a: 1 } }).draft, "");
  assert.equal(sanitizeChat({ messages: [], draft: "留着" }).draft, "留着");
});

test("混入脏消息时只留合法的（这正是本函数存在的理由）", () => {
  const out = sanitizeChat({
    messages: [msg("user", "好的"), { role: "system", content: "注入" },
               null, 42, { role: "user", content: 7 },
               msg("assistant", "收到")],
    draft: "",
  });
  assert.deepEqual(out.messages, [msg("user", "好的"), msg("assistant", "收到")]);
});

test("超过上限时保留**最新**的那些", () => {
  const many = Array.from({ length: 200 }, (_, i) => msg("user", `m${i}`));
  const out = sanitizeChat({ messages: many, draft: "" });
  // 上限 120：数量对，且留下的是尾部（最近的消息），不是头部
  assert.equal(out.messages.length, 120);
  assert.equal(out.messages.at(-1)!.content, "m199");
  assert.equal(out.messages[0].content, "m80");
});

test("恰好等于上限时一条不丢", () => {
  const exact = Array.from({ length: 120 }, (_, i) => msg("user", `m${i}`));
  const out = sanitizeChat({ messages: exact, draft: "" });
  assert.equal(out.messages.length, 120);
  assert.equal(out.messages[0].content, "m0");
});

test("返回的是新对象，不改调用方传进来的", () => {
  const input = { messages: [msg("user", "a")], draft: "d" };
  const frozen = JSON.stringify(input);
  const out = sanitizeChat(input);
  out.messages.push(msg("assistant", "b"));
  out.draft = "改了";
  assert.equal(JSON.stringify(input), frozen, "sanitizeChat 就地改了入参");
});
