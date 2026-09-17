/**
 * 支持范围判定（DESIGN §6.1 / TECHNICAL §5.8）
 *
 * 统一回答"这个节点 / 这个参数能不能操作"，只返回**原因键**，
 * 具体文案由 i18n 层按当前语言解析（FR-7 阻断级）。
 */

import { canCreateInputNode, canRecreateWidget } from "../compat/capability.js";

/**
 * 构造一个"不可用"判定结果。
 *
 * @param {string} reason 原因键（对应 i18n 的 deny.*）
 * @param {boolean} [showParams] 是否仍然列出参数（置灰）。
 *   节点级拦截时：虚拟节点 / 无参数节点没有可展示的内容，直接不注入菜单；
 *   子图节点有参数，应列出但全部置灰，让用户知道"为什么少了参数"（DESIGN §6.1）。
 */
export function deny(reason, showParams = false) {
  return { ok: false, reason, showParams };
}

/** 合并多个判定结果，返回第一个失败项；全部通过则返回 {ok:true} */
export function combineVerdicts(...verdicts) {
  for (const verdict of verdicts) {
    if (verdict && !verdict.ok) return verdict;
  }
  return { ok: true };
}

/** 节点级判定 */
export function assessNode(node) {
  if (!node) return deny("noNode");

  // 虚拟节点：Note / Reroute / PrimitiveNode 自身等，无参数语义
  if (node.isVirtualNode) return deny("virtualNode");

  // 子图节点：其参数为"提升"出来的伪 widget，规格解析路径不同（v1 不支持）
  // 仍有参数可展示，故 showParams = true，条目置灰并说明原因
  if (typeof node.isSubgraphNode === "function" && node.isSubgraphNode()) {
    return deny("subgraphNode", true);
  }

  if (!(node.inputs ?? []).length) return deny("noParams");

  return { ok: true };
}

/** 参数级判定 */
export function assessParam(param) {
  if (!param?.input) return deny("noSocket");
  if (param.input.locked) return deny("locked");

  if (param.kind === "widget") {
    // 入参节点需按目标类型重建控件；无法重建的类型（自定义 widget）暂不支持
    if (!canCreateInputNode()) return deny("noPrimitiveNode");
    if (!canRecreateWidget(param.slotType)) return deny("exoticWidget");
  }

  return { ok: true };
}
