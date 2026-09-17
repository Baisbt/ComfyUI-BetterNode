/**
 * 菜单构建（对应 DESIGN FR-1 / FR-2 / FR-3 / FR-4 / FR-5 / FR-6 / FR-7）
 *
 * 注入方式与 ComfyUI 核心一致：向 node.getExtraMenuOptions(canvas, options)
 * 传入的 options 数组追加条目，不改动核心与该函数已有的其他扩展行为。
 */

import { enumerateParams, groupParams } from "../params/enumerate.js";
import { assessNode, assessParam, combineVerdicts, deny } from "../params/guards.js";
import { createOrReuseInputNode, getExternalizeStatus } from "../actions/createInputNode.js";
import { showSourceMenu } from "../actions/showSourceMenu.js";
import { canShowSourceMenu, canCreateInputNode } from "../compat/capability.js";
import { t, hasKey, resetLang } from "../i18n/index.js";
import { notifyInfo, notifyWarn, notifyError } from "../ui/notify.js";

/** 失败原因文案：优先 deny.* （节点/参数级），其次 reason.*（操作级） */
function reasonText(reason) {
  if (hasKey(`deny.${reason}`)) return t(`deny.${reason}`);
  if (hasKey(`reason.${reason}`)) return t(`reason.${reason}`);
  return String(reason);
}

/**
 * 生成条目文案。
 * 二级菜单不支持分隔线与分组标题（TECHNICAL §4 机制 6），
 * 因此分组、状态与不可用原因一律通过文案前缀表达。
 */
function buildLabel(param, groupKey, verdict, statusKey) {
  if (!verdict.ok) {
    return t("label.unavailable", { name: param.label, reason: reasonText(verdict.reason) });
  }
  if (statusKey) {
    return t("label.itemWithStatus", {
      name: param.label,
      group: t(groupKey),
      status: t(`status.${statusKey}`),
    });
  }
  return t("label.item", { name: param.label, group: t(groupKey) });
}

/** 可连线参数的状态（FR-6） */
function linkParamStatus(param) {
  const input = param.input;
  const connected = input?.link != null || (input?._floatingLinks?.size ?? 0) > 0;
  return connected ? "connected" : null;
}

/**
 * FR-3 点击处理：弹出"选择来源节点"菜单。
 *
 * 说明：曾实现过"起线拖拽态"（dragNewFromInput），但实测无法落点。
 * 根因是原生落点依赖 pointerdown 记录的 eDown，菜单点击没有这个动作，
 * 导致 onDragEnd 永不触发；合成指针序列也无法绕过（详见 TECHNICAL §5.4）。
 * 因此本操作只保留来源菜单这一条路径。
 */
function onLinkParamClick(node, param) {
  const result = showSourceMenu(node, param.index);
  if (result.ok) return;

  notifyError(
    t("error.sourceMenuFailed", { name: param.label, reason: reasonText(result.reason) })
  );
}

/** FR-4 / FR-5 / FR-7 点击处理：创建或复用入参节点 */
function onWidgetParamClick(node, param) {
  const result = createOrReuseInputNode(node, param);

  if (!result.ok) {
    notifyError(t("error.createFailed", { name: param.label, reason: reasonText(result.reason) }));
    return;
  }

  if (result.mergeRejected) {
    notifyWarn(t("warn.mergeRejected", { name: param.label }));
    return;
  }
  if (result.clamped) {
    notifyWarn(
      t("warn.valueClamped", {
        name: param.label,
        from: result.clamped.from,
        to: result.clamped.to,
      })
    );
    return;
  }

  if (result.action === "created") notifyInfo(t("info.created", { name: param.label }));
  else if (result.action === "reused") notifyInfo(t("info.reused", { name: param.label }));
  else notifyInfo(t("info.already", { name: param.label }));
}

/**
 * 向 options 追加「输入参数」二级菜单条目。
 *
 * @param {object} node    触发右键的节点
 * @param {object} canvas  画布实例
 * @param {Array}  options 核心传入的菜单项数组（原地追加）
 */
export function buildInputParamsMenu(node, canvas, options) {
  // 每次打开菜单重读语言，使前端切换语言后立即生效
  resetLang();

  const nodeVerdict = assessNode(node);

  // 节点级不支持且无内容可展示（虚拟节点 / 无参数节点）→ 不注入菜单，避免噪声
  if (!nodeVerdict.ok && !nodeVerdict.showParams) return;

  const params = enumerateParams(node);
  if (!params.length) return;

  const { link, widget } = groupParams(params);
  const graph = node.graph;
  const sourceMenuReady = canShowSourceMenu();
  const inputNodeReady = canCreateInputNode();
  const items = [];

  // ---- 可连线参数：FR-3 ----
  for (const param of link) {
    const verdict = combineVerdicts(
      nodeVerdict,
      assessParam(param),
      sourceMenuReady ? null : deny("linkUnsupported")
    );
    items.push({
      content: buildLabel(param, "group.link", verdict, linkParamStatus(param)),
      disabled: !verdict.ok,
      callback: () => onLinkParamClick(node, param),
    });
  }

  // ---- 内部编辑参数：FR-4 / FR-5 / FR-6 ----
  for (const param of widget) {
    const verdict = combineVerdicts(
      nodeVerdict,
      assessParam(param),
      inputNodeReady ? null : deny("noPrimitiveNode")
    );
    const status = verdict.ok
      ? getExternalizeStatus(graph, param.name, node, param.index)
      : null;

    items.push({
      content: buildLabel(param, "group.widget", verdict, status),
      disabled: !verdict.ok,
      callback: () => onWidgetParamClick(node, param),
    });
  }

  if (!items.length) return;

  options.push({
    content: t("menu.title"),
    has_submenu: true,
    submenu: {
      title: t("menu.title"),
      options: items,
    },
  });
}
