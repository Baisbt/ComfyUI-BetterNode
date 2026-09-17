/**
 * 入参节点工厂（对应 DESIGN FR-4 / FR-5 / FR-9，TECHNICAL §5.5 / §5.6）
 *
 * 复用 ComfyUI 内置虚拟节点 PrimitiveNode：
 *   - 首次连接时按目标参数规格自动创建同类型控件，并拷贝目标当前值
 *   - 下拉框自动同步选项、值控制控件（fixed/increment/decrement/randomize）自动添加
 *   - 一个节点可同时连接多个目标（原生支持，无需自研同步）
 *
 * 复用策略（TECHNICAL §5.6）：
 *   - 复用键 = paramName 经同义组归并后的 key（web/params/synonyms.js）
 *   - 优先复用「共享」入参节点（marker.owner 为空），尝试与目标合并
 *   - 合并被拒（类型或取值范围不兼容）时，为该目标新建「专用」节点（marker.owner = 节点 id），
 *     避免反复重试导致节点爆炸
 */

import { app } from "../../../scripts/app.js";
import { reuseKeyOf } from "../params/synonyms.js";

/** 写入 node.properties 的标记，随工作流序列化，用于重载后的复用索引与状态识别 */
const MARKER = "betterNode";
const ROLE = "paramInput";
const TITLE_PREFIX = "入参·";

function getLiteGraph() {
  return globalThis.LiteGraph;
}

function readMarker(node) {
  return node?.properties?.[MARKER];
}

/**
 * 入参节点的复用键。
 * 不读 marker.key —— 一律由 marker.param 现算，这样新增同义组后
 * 旧工作流里已存在的节点也能被正确归并，无需迁移数据。
 */
function keyOfMarker(marker) {
  return reuseKeyOf(marker?.param);
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

/** 该入参节点的输出是否已连到目标的指定槽 */
export function isLinkedTo(graph, inputNode, targetNode, slotIndex) {
  for (const linkId of outputLinkIds(inputNode)) {
    const link = getLink(graph, linkId);
    if (link && link.target_id === targetNode?.id && link.target_slot === slotIndex) {
      return true;
    }
  }
  return false;
}

/**
 * 收集某参数已有的入参节点。
 * dedicated：专属于该目标（合并失败时新建的）
 * shared：可跨目标复用
 */
function collectNodes(graph, paramName, targetNode) {
  const key = reuseKeyOf(paramName);
  let dedicated = null;
  let shared = null;

  for (const candidate of graph?.nodes ?? []) {
    const marker = readMarker(candidate);
    if (marker?.role !== ROLE) continue;
    if (keyOfMarker(marker) !== key) continue;

    if (marker.owner != null) {
      if (marker.owner === targetNode?.id) dedicated = candidate;
    } else if (!shared) {
      shared = candidate;
    }
  }

  return { dedicated, shared };
}

/**
 * FR-6 复用明细：该参数在目标上的外置情况。
 *
 * @returns {{status:'externalized'|'reusable'|null, count:number, viaGroup:boolean, node:object|null}}
 *   - status  已连到本目标 / 存在节点但未连 / 无节点
 *   - count   该入参节点当前连接的目标总数（一对多规模）
 *   - viaGroup 命中的节点是为**同义组内另一个参数名**创建的
 */
export function getExternalizeDetail(graph, param, targetNode, slotIndex) {
  const { dedicated, shared } = collectNodes(graph, param.name, targetNode);
  const node = dedicated ?? shared;

  if (!node) return { status: null, count: 0, viaGroup: false, node: null };

  const linked = dedicated ? true : isLinkedTo(graph, shared, targetNode, slotIndex);
  const viaGroup = readMarker(node)?.param !== param.name;

  return {
    status: linked ? "externalized" : "reusable",
    count: outputLinkIds(node).length,
    viaGroup,
    node,
  };
}

/** 该参数是否已经有入参节点（含未连接的） */
export function hasInputNode(graph, paramName, targetNode) {
  const { dedicated, shared } = collectNodes(graph, paramName, targetNode);
  return Boolean(dedicated ?? shared);
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
 * @param {{skipTransaction?:boolean}} [options] 批量调用时跳过单次事务包裹
 * @returns {{ok:boolean, action?:'created'|'reused'|'already', node?:object,
 *            clamped?:{from:*,to:*}, mergeRejected?:boolean, reason?:string}}
 */
export function createOrReuseInputNode(targetNode, param, options = {}) {
  const LG = getLiteGraph();
  const graph = targetNode?.graph ?? app.graph;
  const transactional = !options.skipTransaction;

  const slotIndex = param?.index;
  if (typeof slotIndex !== "number" || slotIndex < 0) return { ok: false, reason: "noSlot" };
  if (!graph) return { ok: false, reason: "noGraph" };

  const { dedicated, shared } = collectNodes(graph, param.name, targetNode);

  // ---- 分支一：已专属于本目标 ----
  if (dedicated) return { ok: true, action: "already", node: dedicated };

  // ---- 分支二：尝试复用共享节点 ----
  if (shared) {
    if (isLinkedTo(graph, shared, targetNode, slotIndex)) {
      return { ok: true, action: "already", node: shared };
    }

    const before = param.widget?.value;
    if (transactional) graph.beforeChange?.();
    const link = shared.connect(0, targetNode, slotIndex);
    if (transactional) graph.afterChange?.();

    if (link) {
      const after = param.widget?.value;
      app.canvas?.setDirty?.(true, true);
      return {
        ok: true,
        action: "reused",
        node: shared,
        clamped: before !== after ? { from: before, to: after } : null,
      };
    }
    // 合并被拒（类型或取值范围不兼容）→ 落到分支三，改为专用节点
  }

  // ---- 分支三：新建 ----
  if (!LG?.createNode) return { ok: false, reason: "noLiteGraph" };

  if (transactional) graph.beforeChange?.();

  const inputNode = LG.createNode("PrimitiveNode");
  if (!inputNode) {
    if (transactional) graph.afterChange?.();
    return { ok: false, reason: "noPrimitiveNode" };
  }

  graph.add(inputNode);
  inputNode.pos = findFreePosition(graph, targetNode, inputNode);

  // 必须先连接：PrimitiveNode 在首次连接时才按目标规格生成控件并拷贝当前值
  const link = inputNode.connect(0, targetNode, slotIndex);
  if (!link) {
    graph.remove?.(inputNode);
    if (transactional) graph.afterChange?.();
    return { ok: false, reason: "connectFailed" };
  }

  inputNode.title = TITLE_PREFIX + param.name;
  inputNode.properties ??= {};
  // shared 存在却连不上 => 本次是"因合并被拒而新建的专用节点"
  inputNode.properties[MARKER] = shared
    ? { role: ROLE, param: param.name, owner: targetNode.id, v: 1 }
    : { role: ROLE, param: param.name, v: 1 };

  if (transactional) graph.afterChange?.();
  app.canvas?.setDirty?.(true, true);

  return { ok: true, action: "created", node: inputNode, mergeRejected: Boolean(shared) };
}

/**
 * FR-9 批量外置：一次外置目标节点的全部内部参数。
 *
 * 整个批次包在**一次** beforeChange / afterChange 内，因此 Ctrl+Z 可整体回退。
 *
 * @param {object} targetNode
 * @param {Array}  params 待处理参数（调用方已过滤掉不可用项）
 * @returns {{ok:boolean, created:number, reused:number, already:number, failed:Array, reason?:string}}
 */
export function externalizeAll(targetNode, params) {
  const graph = targetNode?.graph ?? app.graph;
  if (!graph) return { ok: false, reason: "noGraph" };
  if (!params?.length) return { ok: true, created: 0, reused: 0, already: 0, failed: [] };

  const summary = { ok: true, created: 0, reused: 0, already: 0, failed: [] };

  graph.beforeChange?.();
  try {
    for (const param of params) {
      const result = createOrReuseInputNode(targetNode, param, { skipTransaction: true });

      if (!result.ok) {
        summary.failed.push({ param, reason: result.reason });
        continue;
      }
      if (result.action === "created") summary.created += 1;
      else if (result.action === "reused") summary.reused += 1;
      else summary.already += 1;
    }
  } finally {
    graph.afterChange?.();
  }

  app.canvas?.setDirty?.(true, true);
  return summary;
}
