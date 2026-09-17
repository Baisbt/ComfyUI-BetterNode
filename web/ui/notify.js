/**
 * 用户提示通道（TECHNICAL §5.9 / FR-7）
 *
 * 前端未对外暴露 toast store（`window.comfyAPI` 中不含），故按可用性逐级降级：
 *   1) app.extensionManager.toast.add  —— 现代非阻塞提示
 *   2) app.ui.dialog.show              —— 传统对话框
 *   3) console                         —— 兜底
 *
 * 分级策略（避免打扰）：
 *   info  仅控制台 —— 常规成功路径（创建/复用），不弹 UI
 *   warn  走 UI     —— 值被钳制、合并被拒等"静默改写"必须让用户看见
 *   error 走 UI     —— 硬失败
 */

import { app } from "../../../scripts/app.js";

let channelLogged = false;

function rememberChannel(name) {
  if (channelLogged) return;
  channelLogged = true;
  console.info(`[BetterNode] 提示通道：${name}`);
}

function toast(severity, message) {
  const toastApi = app?.extensionManager?.toast;
  if (typeof toastApi?.add !== "function") return false;

  try {
    toastApi.add({
      severity,
      summary: "BetterNode",
      detail: message,
      life: severity === "error" ? 8000 : 5000,
    });
    return true;
  } catch (error) {
    console.debug("[BetterNode] toast 调用失败：", error);
    return false;
  }
}

function dialog(message) {
  if (typeof app?.ui?.dialog?.show !== "function") return false;

  try {
    app.ui.dialog.show(message);
    return true;
  } catch (error) {
    console.debug("[BetterNode] dialog 调用失败：", error);
    return false;
  }
}

function emit(severity, message, allowDialog) {
  if (toast(severity, message)) {
    rememberChannel("extensionManager.toast");
    return;
  }
  if (allowDialog && dialog(message)) {
    rememberChannel("ui.dialog");
    return;
  }
  rememberChannel("console");
  if (severity === "error") console.error("[BetterNode]", message);
  else console.warn("[BetterNode]", message);
}

/** 信息级：仅控制台，不打扰 */
export function notifyInfo(message) {
  console.info("[BetterNode]", message);
}

/** 提示级：需要用户知晓但不阻断 */
export function notifyWarn(message) {
  emit("warn", message, false);
}

/** 错误级：需要用户知晓且可能阻断 */
export function notifyError(message) {
  emit("error", message, true);
}
