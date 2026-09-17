/**
 * FR-3b：选择来源节点（TECHNICAL §5.4.2）
 *
 * 复用官方公开方法 canvas.showConnectionMenu({ nodeTo, slotTo, e })，
 * 即原生"把连线拖到空白处"弹出的来源选择菜单。
 * 不依赖指针拖拽生命周期，作为「可连线参数」的稳实现路径。
 */

import { app } from "../../../scripts/app.js";

/** 最近一次右键事件，用于给菜单定位 */
let lastContextMenuEvent = null;

/**
 * 记录最近一次 contextmenu 事件。
 * 菜单回调（contextMenuConverter）拿不到 MouseEvent，只能在交互发生时先行捕获。
 */
export function installContextMenuTracker() {
  if (typeof document === "undefined") return;

  document.addEventListener(
    "contextmenu",
    (event) => {
      lastContextMenuEvent = event;
    },
    true
  );
}

/** 构造用于菜单定位的事件：优先复用真实右键事件，否则按画布坐标折算 */
function buildPositionEvent(canvas) {
  if (lastContextMenuEvent && typeof lastContextMenuEvent.clientX === "number") {
    return new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: lastContextMenuEvent.clientX,
      clientY: lastContextMenuEvent.clientY,
    });
  }

  const rect = canvas?.canvas?.getBoundingClientRect?.();
  const scale = canvas?.ds?.scale ?? 1;
  const offset = canvas?.ds?.offset ?? [0, 0];
  const graphMouse = canvas?.graph_mouse ?? [0, 0];

  return new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: (rect?.left ?? 0) + (graphMouse[0] + offset[0]) * scale,
    clientY: (rect?.top ?? 0) + (graphMouse[1] + offset[1]) * scale,
  });
}

/** 能力探测：来源菜单是否可用 */
export function isSourceMenuAvailable() {
  return typeof app?.canvas?.showConnectionMenu === "function";
}

/**
 * 为某个可连线参数弹出来源选择菜单。
 *
 * @param {object} targetNode 目标节点
 * @param {number} slotIndex  目标输入槽下标
 */
export function showSourceMenu(targetNode, slotIndex) {
  const canvas = app?.canvas;

  if (!isSourceMenuAvailable()) return { ok: false, reason: "unavailable" };
  if (!canvas?.graph) return { ok: false, reason: "noGraph" };

  try {
    // slotTo 传下标而非槽对象，避免同名槽的查找歧义
    canvas.showConnectionMenu({
      nodeTo: targetNode,
      slotTo: slotIndex,
      e: buildPositionEvent(canvas),
    });
    return { ok: true };
  } catch (error) {
    console.error("[BetterNode] showConnectionMenu 调用失败：", error);
    return { ok: false, reason: "threw" };
  }
}
