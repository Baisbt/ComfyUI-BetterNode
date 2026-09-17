/**
 * 入参节点工厂（对应 DESIGN FR-4 / FR-5，TECHNICAL §5.5 / §5.6）
 *
 * 复用 ComfyUI 内置虚拟节点 PrimitiveNode：
 *   - 首次连接时按目标参数规格自动创建同类型控件，并拷贝目标当前值
 *   - 下拉框自动同步选项
 *   - 一个节点可同时连接多个目标（原生支持，无需自研同步）
 */

import { app } from "../../../scripts/app.js";

/** 写入 node.properties 的标记，随工作流序列化，用于重载后的复用索引与状态识别 */
const MARKER = "betterNode";
const ROLE = "paramInput";
const TITLE_PREFIX = "入参·";

function getLiteGraph() {
  return window.LiteGraph;
}

/** 兼容新版 getLink 与旧版 links 索引 */
function getLink(graph, linkId) {
  if (!graph) return undefined;
  return graph.getLink?.(linkId) ?? graph.links?.[linkId];
}

/** 输出槽上的 link 可能存 id，也可能存 LLink 对象 */
function outputLinkIds(node) {
  const links = node?.outputs?.[0]?.links ?? [];
  return links.filter(Boolean).map((l) => (typeof l === "object" ? l.id : l));
}

/**
 * 查找已存在的同参数入参节点（复用键 = 参数名，见 TECHNICAL §5.6）
 */
export function findExistingInputNode(graph, paramName) {
  for (const candidate of graph?.nodes ?? []) {
    const marker = candidate?.properties?.[MARKER];
    if (marker?.role === ROLE && marker.param === paramName) return candidate;
  }
  return null;
}

function isAlreadyConnected(graph, inputNode, targetNode, slotIndex) {
  for (const linkId of outputLinkIds(inputNode)) {
    const link = getLink(graph, linkId);
    if (link && link.target_id === targetNode.id && link.target_slot === slotIndex) {
      return true;
    }
  }
  return false;
}

/** 复刻核心 onInputDblClick 的避让定位算法，避免与已有节点重叠 */
function findFreePosition(graph, targetNode, inputNode) {
  const titleHeight = getLiteGraph()?.NODE_TITLE_HEIGHT ?? 30;
  const pos = [targetNode.pos[0] - inputNode.size[0] - 30, targetNode.pos[1]];

  let guard = 0;
  while (graph.getNodeOnPos?.(pos[0], pos[1], graph.nodes) && guard < 200) {
    pos[1] += titleHeight;
    guard += 1;
  }
  return pos;
}

/**
 * 为指定参数创建或复用入参节点，并连接到目标参数槽。
 *
 * @param {object} targetNode 目标节点
 * @param {object} param      enumerateParams 产出的参数项
 * @returns {{ok:boolean, reused?:boolean, already?:boolean, node?:object, reason?:string}}
 */
export function createOrReuseInputNode(targetNode, param) {
  const LG = getLiteGraph();
  const graph = targetNode?.graph ?? app.graph;

  if (!LG?.createNode) return { ok: false, reason: "noLiteGraph" };
  if (!graph) return { ok: false, reason: "noGraph" };

  const slotIndex = param.index;
  if (typeof slotIndex !== "number" || slotIndex < 0) {
    return { ok: false, reason: "noSlot" };
  }

  // ---- 分支一：复用已有入参节点 ----
  const existing = findExistingInputNode(graph, param.name);
  if (existing) {
    if (isAlreadyConnected(graph, existing, targetNode, slotIndex)) {
      return { ok: true, reused: true, already: true, node: existing };
    }

    graph.beforeChange?.();
    const link = existing.connect(0, targetNode, slotIndex);
    graph.afterChange?.();
    app.canvas?.setDirty?.(true, true);

    if (!link) return { ok: false, reason: "connectFailed" };
    return { ok: true, reused: true, node: existing };
  }

  // ---- 分支二：新建入参节点 ----
  graph.beforeChange?.();

  const inputNode = LG.createNode("PrimitiveNode");
  if (!inputNode) {
    graph.afterChange?.();
    return { ok: false, reason: "noPrimitiveNode" };
  }

  graph.add(inputNode);
  inputNode.pos = findFreePosition(graph, targetNode, inputNode);

  // 必须先连接：PrimitiveNode 在首次连接时才按目标规格生成控件并拷贝当前值
  const link = inputNode.connect(0, targetNode, slotIndex);
  if (!link) {
    graph.remove?.(inputNode);
    graph.afterChange?.();
    return { ok: false, reason: "connectFailed" };
  }

  inputNode.title = TITLE_PREFIX + param.name;
  inputNode.properties ??= {};
  inputNode.properties[MARKER] = { role: ROLE, param: param.name, v: 1 };

  graph.afterChange?.();
  app.canvas?.setDirty?.(true, true);

  return { ok: true, reused: false, node: inputNode };
}
