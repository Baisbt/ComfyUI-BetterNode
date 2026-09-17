/**
 * 支持范围判定（对应 DESIGN §6.1 / TECHNICAL §5.8）
 *
 * 统一回答"这个节点 / 这个参数能不能操作"，返回 {ok, reason, text}。
 * MVP 阶段 text 为中文文案；v1 后续接入 i18n 模块（TECHNICAL §5.9）切换中英。
 */

const REASON_TEXT = {
  noNode: "节点不存在",
  virtualNode: "虚拟节点，没有可外置的参数",
  subgraphNode: "暂不支持子图节点",
  noParams: "该节点没有输入参数",
  locked: "该参数槽已被锁定",
  noSocket: "该参数没有输入槽，无法外置",
};

/**
 * 构造一个"不可用"判定结果。
 *
 * @param {string} reason 原因键
 * @param {boolean} [showParams] 是否仍然列出参数（置灰）。
 *   节点级拦截时：虚拟节点 / 无参数节点没有可展示的内容，直接不注入菜单；
 *   子图节点有参数，应列出但全部置灰，让用户知道"为什么少了参数"（DESIGN §6.1）。
 */
export function deny(reason, showParams = false) {
  return { ok: false, reason, text: REASON_TEXT[reason] ?? "暂不支持", showParams };
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
  return { ok: true };
}
