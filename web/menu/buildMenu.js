/**
 * 菜单构建（对应 DESIGN FR-1 / FR-2 / FR-3b / FR-4 / FR-5）
 *
 * 注入方式与 ComfyUI 核心一致：向 node.getExtraMenuOptions(canvas, options)
 * 传入的 options 数组追加条目，不改动核心与该函数已有的其他扩展行为。
 */

import { enumerateParams, groupParams } from "../params/enumerate.js";
import { assessNode, assessParam, combineVerdicts } from "../params/guards.js";
import { createOrReuseInputNode } from "../actions/createInputNode.js";
import { showSourceMenu, isSourceMenuAvailable } from "../actions/showSourceMenu.js";

const MENU_CONTENT = "输入参数";
const GROUP_LINK = "可连线";
const GROUP_WIDGET = "内部参数";

/**
 * 生成条目文案。
 * 注意：二级菜单不支持分隔线与分组标题（TECHNICAL §4 机制 6），
 * 因此分组与不可用原因一律通过文案前缀表达。
 */
function formatLabel(param, group, verdict, available) {
  if (!verdict.ok) return `${param.label}（不可用：${verdict.text}）`;
  if (!available) return `${param.label}（${group}·当前环境不可用）`;
  return `${param.label}（${group}）`;
}

/**
 * 向 options 追加「输入参数」二级菜单条目。
 *
 * @param {object} node    触发右键的节点
 * @param {object} canvas  画布实例
 * @param {Array}  options 核心传入的菜单项数组（原地追加）
 */
export function buildInputParamsMenu(node, canvas, options) {
  const nodeVerdict = assessNode(node);

  // 节点级不支持且无内容可展示（虚拟节点 / 无参数节点）→ 不注入菜单，避免噪声
  if (!nodeVerdict.ok && !nodeVerdict.showParams) return;

  const params = enumerateParams(node);
  if (!params.length) return;

  const { link, widget } = groupParams(params);
  const sourceMenuReady = isSourceMenuAvailable();
  const items = [];

  // ---- 可连线参数：FR-3b ----
  for (const param of link) {
    const verdict = combineVerdicts(nodeVerdict, assessParam(param));
    items.push({
      content: formatLabel(param, GROUP_LINK, verdict, sourceMenuReady),
      disabled: !verdict.ok || !sourceMenuReady,
      callback: () => {
        const result = showSourceMenu(node, param.index);
        if (!result.ok) {
          console.warn(`[BetterNode] 无法为参数「${param.name}」打开来源菜单：`, result.reason);
        }
      },
    });
  }

  // ---- 内部编辑参数：FR-4 / FR-5 ----
  for (const param of widget) {
    const verdict = combineVerdicts(nodeVerdict, assessParam(param));
    items.push({
      content: formatLabel(param, GROUP_WIDGET, verdict, true),
      disabled: !verdict.ok,
      callback: () => {
        const result = createOrReuseInputNode(node, param);

        if (!result.ok) {
          console.warn(`[BetterNode] 为参数「${param.name}」创建入参节点失败：`, result.reason);
          return;
        }
        if (result.already) {
          console.info(`[BetterNode] 参数「${param.name}」已外置，无需重复操作`);
        }
      },
    });
  }

  if (!items.length) return;

  options.push({
    content: MENU_CONTENT,
    has_submenu: true,
    submenu: {
      title: MENU_CONTENT,
      options: items,
    },
  });
}
