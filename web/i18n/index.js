/**
 * 文案与语言判定（TECHNICAL §5.9）
 *
 * 关键约束：前端未对外暴露 i18n 接口（`window.comfyAPI` 的模块清单中不含 i18n），
 * 因此插件自带字典，不做官方翻译的复用。
 *
 * 语言判定优先级：
 *   1) 前端语言设置 `Comfy.Locale`（已核实该设置项存在：{id:'Comfy.Locale', name:'Language', type:'combo'}）
 *   2) 浏览器语言 `navigator.language`
 *   3) 兜底中文（本插件目标用户环境）
 */

import { app } from "../../../scripts/app.js";
import { zh } from "./zh.js";
import { en } from "./en.js";

const DICTS = { zh, en };
const FALLBACK_LANG = "zh";

let cachedLang = null;

function readSettingLocale() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    if (typeof value === "string" && value) return value;
  } catch (error) {
    console.debug("[BetterNode] 读取 Comfy.Locale 失败：", error);
  }
  return null;
}

function readBrowserLocale() {
  const value = globalThis.navigator?.language;
  return typeof value === "string" && value ? value : null;
}

function normalize(raw) {
  const lower = String(raw ?? "").toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower) return "en";
  return FALLBACK_LANG;
}

/** 当前语言（zh / en） */
export function getLang() {
  if (cachedLang) return cachedLang;
  const raw = readSettingLocale() ?? readBrowserLocale();
  cachedLang = normalize(raw);
  return cachedLang;
}

/** 语言来源，便于排查（设置 / 浏览器 / 兜底） */
export function getLangSource() {
  if (readSettingLocale()) return "Comfy.Locale";
  if (readBrowserLocale()) return "navigator.language";
  return "fallback";
}

/** 清空缓存（前端切语言后调用） */
export function resetLang() {
  cachedLang = null;
}

/** 某个键是否存在（不触发缺失告警），用于多域回退查找 */
export function hasKey(key) {
  const lang = getLang();
  return DICTS[lang]?.[key] !== undefined || DICTS.en[key] !== undefined;
}

/**
 * 取文案。缺失键依次回退：当前语言 -> 英文 -> 键名本身（并告警）。
 *
 * @param {string} key    文案键
 * @param {object} [params] 占位符参数，模板中用 {name} 形式引用
 */
export function t(key, params) {
  const lang = getLang();
  let template = DICTS[lang]?.[key];

  if (template === undefined && lang !== "en") {
    template = DICTS.en[key];
  }
  if (template === undefined) {
    console.warn(`[BetterNode] 缺失文案键：${key}`);
    return key;
  }
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}
