/**
 * ComfyUI-BetterNode — 扩展入口
 *
 * 挂载点与 ComfyUI 核心完全一致（TECHNICAL §5.1）：
 *   核心在 litegraphService.addNodeContextMenuHandler 中设置
 *   node.prototype.getExtraMenuOptions = function (canvas, options) {...}
 *   本插件在 beforeRegisterNodeDef 中以链式包装挂到同一位置，
 *   **不覆盖、不修改**任何既有实现。
 */

import { app } from "../../scripts/app.js";
import { buildInputParamsMenu } from "./menu/buildMenu.js";
import { installContextMenuTracker } from "./actions/showSourceMenu.js";
import { t, getLang, getLangSource } from "./i18n/index.js";

const EXTENSION_NAME = "BetterNode.InputParams";

/**
 * 链式包装：先执行原有实现，再执行本插件的处理，最后原样返回原实现的结果。
 * 这样既不会覆盖其他扩展挂载的同名钩子，也不改变核心对返回值的判断逻辑。
 */
function chain(original, handler) {
  return function chained(...args) {
    const result = typeof original === "function" ? original.apply(this, args) : undefined;

    try {
      handler.apply(this, args);
    } catch (error) {
      // 本插件出错不得影响其他扩展与核心菜单
      console.error(`[${EXTENSION_NAME}] 构建「输入参数」菜单失败：`, error);
    }

    return result;
  };
}

app.registerExtension({
  name: EXTENSION_NAME,

  async setup() {
    // 菜单回调拿不到 MouseEvent，需在交互发生时先行捕获（用于来源菜单定位）
    installContextMenuTracker();

    console.info(
      `[${EXTENSION_NAME}] ${t("info.loaded")} · ${t("info.language", { lang: getLang() })}` +
        ` (${getLangSource()})`
    );
  },

  async beforeRegisterNodeDef(nodeType) {
    nodeType.prototype.getExtraMenuOptions = chain(
      nodeType.prototype.getExtraMenuOptions,
      function buildMenu(canvas, options) {
        if (!Array.isArray(options)) return;
        buildInputParamsMenu(this, canvas, options);
      }
    );
  },
});
