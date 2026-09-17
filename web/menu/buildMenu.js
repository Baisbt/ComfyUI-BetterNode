/**
 * 菜单构建（对应 DESIGN FR-1 / FR-2 / FR-4 / FR-5 / FR-6 / FR-7 / FR-9）
 *
 * 「输入参数」只列出**内部编辑参数**（widget 类参数），为其创建/复用入参节点。
 * 可连线参数（model / positive 等）不在菜单中出现——用户可按 ComfyUI 原生方式
 * 直接拖线到参数槽，无需插件提供入口（FR-3 已下线）。
 *
 * 注入方式与 ComfyUI 核心一致：向 node.getExtraMenuOptions(canvas, options)
 * 传入的 options 数组追加条目，不改动核心与该函数已有的其他扩展行为。
 */

import { enumerateParams } from "../params/enumerate.js";
import { assessNode, assessParam, combineVerdicts, deny } from "../params/guards.js";
import {
  createOrReuseInputNode,
  externalizeAll,
  getExternalizeDetail,
} from "../actions/createInputNode.js";
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
 * FR-6 复用明细文案。
 * 二级菜单不支持分隔线与分组标题（TECHNICAL §4 机制 6），且 `title` / `className`
 * 在转换时会被丢弃、`MenuOption` 也没有 tooltip 字段 —— 因此明细只能压进条目文案。
 * 为避免平时过于冗长，仅在适用时才追加「目标数」与「同义组共用」。
 */
function buildStatusText(detail) {
  const parts = [t(`status.${detail.status}`)];
  if (detail.count > 1) parts.push(t("status.targets", { count: detail.count }));
  if (detail.viaGroup) parts.push(t("status.shared"));
  return parts.join(" · ");
}

function buildLabel(param, verdict, detail) {
  if (!verdict.ok) {
    return t("label.unavailable", { name: param.label, reason: reasonText(verdict.reason) });
  }
  if (detail?.status) {
    return t("label.itemWithStatus", { name: param.label, status: buildStatusText(detail) });
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

/** FR-9 批量外置：整批一次事务，Ctrl+Z 可整体回退 */
function onExternalizeAllClick(node, pending) {
  const summary = externalizeAll(node, pending);

  if (!summary.ok) {
    notifyError(
      t("error.createFailed", { name: t("menu.title"), reason: reasonText(summary.reason) })
    );
    return;
  }

  notifyInfo(
    t("info.batchResult", {
      created: summary.created,
      reused: summary.reused,
      skipped: summary.already + summary.failed.length,
    })
  );

  if (summary.failed.length) {
    for (const failure of summary.failed) {
      console.warn(
        `[BetterNode] 「${failure.param.name}」外置失败：${reasonText(failure.reason)}`
      );
    }
    notifyWarn(t("warn.batchFailed", { count: summary.failed.length }));
  }
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

  const graph = node.graph;
  const inputNodeReady = canCreateInputNode();
  const items = [];
  const pending = [];

  for (const param of params) {
    const verdict = combineVerdicts(
      nodeVerdict,
      assessParam(param),
      inputNodeReady ? null : deny("noPrimitiveNode")
    );

    let detail = null;
    if (verdict.ok) {
      detail = getExternalizeDetail(graph, param, node, param.index);
      if (detail.status !== "externalized") pending.push(param);
    }

    items.push({
      content: buildLabel(param, verdict, detail),
      disabled: !verdict.ok,
      callback: () => onWidgetParamClick(node, param),
    });
  }

  // FR-9：仅在确有待处理参数时提供批量入口
  if (pending.length > 0) {
    items.push({
      content: t("action.externalizeAll", { count: pending.length }),
      disabled: false,
      callback: () => onExternalizeAllClick(node, pending),
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
