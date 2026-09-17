/**
 * FR-3a：起线拖拽态（TECHNICAL §5.4.1）
 *
 * 通过 canvas.linkConnector.dragNewFromInput() 让画布进入「从该参数槽拖出连线」的状态，
 * 等价于用户从输入槽按下鼠标开始拖线。
 *
 * ⚠️ 关键：dragNewFromInput 之后必须注册指针生命周期钩子（pointer.onDragEnd / pointer.finally），
 * 否则拖拽无法结束。核心的做法是立即调用 canvas._linkConnectorDrop()（LGraphCanvas.ts:2113）。
 * 该方法为 TS private，运行时可用；缺失时按同义逻辑手动注册（区别仅是无自动平移）。
 */

import { app } from "../../../scripts/app.js";
import { canStartLinkDrag, hasDropHook } from "../compat/capability.js";

export { canStartLinkDrag };

/** 注册落点钩子；返回实际使用的注册方式，便于排查 */
function installDropHandlers(canvas) {
  if (hasDropHook()) {
    canvas._linkConnectorDrop();
    return "native";
  }

  const { linkConnector, graph } = canvas;
  if (typeof linkConnector?.dropLinks !== "function" || !canvas.pointer) return "none";

  canvas.pointer.onDragEnd = (upEvent) => linkConnector.dropLinks(graph, upEvent);
  canvas.pointer.finally = () => {
    canvas._autoPan?.stop?.();
    canvas._autoPan = null;
    linkConnector.reset?.(true);
  };
  return "manual";
}

/**
 * 让画布进入从该参数槽起线的状态。
 *
 * @param {object} targetNode 目标节点
 * @param {number} slotIndex  目标输入槽下标
 * @returns {{ok:boolean, reason?:string}}
 */
export function startLinkDrag(targetNode, slotIndex) {
  const canvas = app?.canvas;

  if (!canvas?.graph) return { ok: false, reason: "noGraph" };
  if (!canStartLinkDrag()) return { ok: false, reason: "unsupported" };

  const input = targetNode?.inputs?.[slotIndex];
  if (!input) return { ok: false, reason: "noSlot" };

  // 已在连线中时 dragNewFromInput 会 throw，先行拦截
  if (canvas.linkConnector.isConnecting) return { ok: false, reason: "busy" };

  try {
    canvas.linkConnector.dragNewFromInput(canvas.graph, targetNode, input);

    const mode = installDropHandlers(canvas);
    if (mode === "none") {
      // 无法注册落点钩子，立即复位，避免半途状态
      canvas.linkConnector.reset?.(true);
      console.warn("[BetterNode] 未能注册拖拽落点钩子，已复位");
      return { ok: false, reason: "noDropHook" };
    }

    canvas.dirty_bgcanvas = true;
    return { ok: true, mode };
  } catch (error) {
    console.error("[BetterNode] dragNewFromInput 调用失败：", error);
    try {
      canvas.linkConnector.reset?.(true);
    } catch (resetError) {
      console.debug("[BetterNode] 复位失败：", resetError);
    }
    return { ok: false, reason: "threw" };
  }
}
