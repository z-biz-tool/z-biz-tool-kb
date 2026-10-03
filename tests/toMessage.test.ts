// toMessage —— Tauri invoke 错误归一化的回归（无 React、无 DOM）。
// 跑法：node --experimental-strip-types --test tests/*.test.ts
//
// 为什么测它：这个函数是全仓唯一的"后端报错 → 用户可读文案"转换点。
// Tauri 的 invoke 失败时抛的是 Rust 侧的 **String**，不是 Error 实例 ——
// 也就是说 `catch (e) { e.message }` 这种常规写法在 kb 里拿到的是 undefined，
// 界面会显示空白或 "undefined"。这函数就是为了修这一条而存在的，
// 但它同时是条边界：**输入完全不可控**，任何实现改动都可能把某类报错
// 悄悄变成 "[object Object]" 或 "undefined"，用户看到的就是一句废话。
//
// 注：knowledgeStore.ts 依赖 zustand 与 @tauri-apps/api，本仓没装
// node_modules，所以这里用 module.registerHooks 把它们短路到 data: URL 桩。
// 桩只为让模块能加载 —— 被测的 toMessage 是纯函数，一个字节都不碰桩。
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

const { toMessage } = await import("../src/stores/knowledgeStore.ts");

/* ------------------------------------------------------------------ *
 * 主路径：Tauri / JS 两侧真实会抛出来的东西
 * ------------------------------------------------------------------ */

test("Rust 侧抛的字符串原样返回（这正是本函数存在的原因）", () => {
  // invoke 失败时抛的是 Rust 的 String，不是 Error。
  // 若没有这条分支，`e.message` 会是 undefined，界面显示空白。
  assert.equal(toMessage("database is locked"), "database is locked");
  assert.equal(toMessage(""), "");
});

test("Error 实例取 message", () => {
  assert.equal(toMessage(new Error("boom")), "boom");
  assert.equal(toMessage(new TypeError("类型不对")), "类型不对");
  // Error 的 name 不该混进文案
  assert.ok(!toMessage(new Error("boom")).includes("Error"));
});

test("带 message 字段的普通对象（IPC 常见形态）", () => {
  assert.equal(toMessage({ message: "文件不存在" }), "文件不存在");
  assert.equal(toMessage({ message: 42 }), "42", "非字符串 message 要转成字符串而不是原样返回数字");
});

/* ------------------------------------------------------------------ *
 * 退化路径：不能抛、不能返回 undefined
 * ------------------------------------------------------------------ */

test("任何输入都必须返回字符串，绝不返回 undefined", () => {
  // 这条是本文件的核心断言：返回 undefined 会让界面显示 "undefined"。
  for (const input of [0, false, NaN, {}, [], ["a"], new Date(0)]) {
    const out = toMessage(input as unknown);
    assert.equal(typeof out, "string", `${JSON.stringify(input) ?? String(input)} 返回了 ${typeof out}`);
    assert.notEqual(out, "undefined", "绝不能把字面量 'undefined' 当成错误文案返回");
  }
});

test("空对象没有 message 时退化成字符串化，不抛", () => {
  // 不好看，但比抛异常或返回 undefined 好：用户至少看到点什么。
  assert.doesNotThrow(() => toMessage({}));
  assert.equal(typeof toMessage({}), "string");
});

test("message 是 undefined/null/空串时退回'未知错误'，不把字面量当文案", () => {
  // `{ message: undefined }` 里 message 键存在，`"message" in e` 为真，
  // 原实现于是 String(undefined) = "undefined"，界面直接显示 undefined ——
  // 恰是这个函数存在的意义所要防的那件事。2026-10-03 已修。
  assert.equal(toMessage({ message: undefined }), "未知错误");
  assert.equal(toMessage({ message: null }), "未知错误");
  assert.equal(toMessage({ message: "" }), "未知错误");
  // 顶层裸 undefined / null 同理
  assert.equal(toMessage(undefined), "未知错误");
  assert.equal(toMessage(null), "未知错误");
  // 但正常的空串错误（后端就是返回空串）仍原样保留
  assert.equal(toMessage(""), "");
});

test("原始值走 String() 兜底", () => {
  assert.equal(toMessage(42), "42");
  assert.equal(toMessage(0), "0", "0 是 falsy，不能被当成'空'");
  assert.equal(toMessage(false), "false");
  assert.equal(toMessage(123n), "123");
});

test("数组被字符串化而不是抛", () => {
  assert.doesNotThrow(() => toMessage([1, 2]));
  assert.equal(typeof toMessage([1, 2]), "string");
});

test("自定义 toString 生效", () => {
  const custom = { toString: () => "自定义错误" };
  assert.equal(toMessage(custom), "自定义错误");
});

test("Error 子类带 cause 时仍取 message", () => {
  const e = new Error("外层错误", { cause: new Error("内层错误") });
  assert.equal(toMessage(e), "外层错误");
});
