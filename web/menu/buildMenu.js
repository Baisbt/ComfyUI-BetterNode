/**
 * 菜单构建（对应 DESIGN FR-1 / FR-2 / FR-4 / FR-5 / FR-6 / FR-7）
 *
 * 「输入参数」只列出**内部编辑参数**（widget 类参数），为其创建/复用入参节点。
 * 可连线参数（model / positive 等）不在菜单中出现——用户可按 ComfyUI 原生方式
 * 直接拖线到参数槽，无需插件提供入口。
 *
 * 注入方式与 ComfyUI 核心一致：向 node.getExtraMenuOptions(canvas, options)
 * 传入的 options 数组追加条目，不改动核心与该函数已有的其他扩展行为。
 */

import { enumerateParams } from "../params/enumerate.js";
import { assessNode, assessParam, combineVerdicts, deny } from "../params/guards.js";
import { createOrReuseInputNode, getExternalizeStatus } from "../actions/createInputNode.js";
import { canCreateInputNode } from "../compat/capability.js";
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
 * 因此状态与不可用原因一律通过文案前缀表达。
 * 现已只剩内部参数一组，故不再输出分组后缀。
 */
function buildLabel(param, verdict, statusKey) {
  if (!verdict.ok) {
    return t("label.unavailable", { name: param.label, reason: reasonText(verdict.reason) });
  }
  if (statusKey) {
    return t("label.itemWithStatus", {
      name: param.label,
      status: t(`status.${statusKey}`),
    });
  }
  return t("label.item", { name: param.label });
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

  // 只保留内部编辑参数；节点若没有此类参数则整项不注入，避免出现空菜单
  const params = enumerateParams(node).filter((param) => param.kind === "widget");
  if (!params.length) return;

  const inputNodeReady = canCreateInputNode();
  const items = [];

  for (const param of params) {
    const verdict = combineVerdicts(
      nodeVerdict,
      assessParam(param),
      inputNodeReady ? null : deny("noPrimitiveNode")
    );
    const status = verdict.ok
      ? getExternalizeStatus(node.graph, param.name, node, param.index)
      : null;

    items.push({
      content: buildLabel(param, verdict, status),
      disabled: !verdict.ok,
      callback: () => onWidgetParamClick(node, param),
    });
  }

  options.push({
    content: t("menu.title"),
    has_submenu: true,
    submenu: {
      title: t("menu.title"),
      options: items,
    },
  });
}
