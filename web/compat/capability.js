/**
 * 能力探测（TECHNICAL §7.1）
 *
 * 全部按需调用（画布与内置节点可能晚于扩展注册就绪），不做启动期一次性快照。
 * 探测失败一律走降级路径，不做静默失效。
 */

import { app } from "../../../scripts/app.js";

function getCanvas() {
  return app?.canvas;
}

/** 是否可创建入参节点：依赖内置虚拟节点 PrimitiveNode */
export function canCreateInputNode() {
  return Boolean(globalThis.LiteGraph?.registered_node_types?.PrimitiveNode);
}

/** FR-3a：是否可进入起线拖拽态 */
export function canStartLinkDrag() {
  const canvas = getCanvas();
  if (!canvas) return false;
  if (typeof canvas.linkConnector?.dragNewFromInput !== "function") return false;
  // 拖拽需要指针对象承载 onDragEnd / finally 钩子
  return Boolean(canvas.pointer);
}

/** 是否可手动注册拖拽落点钩子（_linkConnectorDrop 为 TS private，运行时可用） */
export function hasDropHook() {
  return typeof getCanvas()?._linkConnectorDrop === "function";
}

/** FR-3b：是否可弹出来源选择菜单 */
export function canShowSourceMenu() {
  return typeof getCanvas()?.showConnectionMenu === "function";
}

/** 是否具备「可连线参数」的任一可用入口 */
export function canLinkParam() {
  return canStartLinkDrag() || canShowSourceMenu();
}

/**
 * 入参节点能否按目标参数类型正确重建控件。
 * 复用与 PrimitiveNode 相同的判据（isValidWidgetType），避免两边规则分叉。
 */
export function canRecreateWidget(slotType) {
  try {
    const check = globalThis.window?.comfyAPI?.widgets?.isValidWidgetType;
    if (typeof check === "function") return Boolean(check(slotType));
  } catch (error) {
    console.debug("[BetterNode] isValidWidgetType 探测失败：", error);
  }
  return ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(slotType);
}
