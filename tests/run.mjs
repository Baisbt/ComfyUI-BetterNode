/**
 * ComfyUI-BetterNode 逻辑回归测试
 *
 * 用途：在不启动 ComfyUI 的前提下，用桩对象验证插件的核心逻辑。
 * 覆盖：菜单结构(FR-1/FR-2)、入参节点创建与复用(FR-4/FR-5)、
 *       同义组复用键(FR-5)、复用明细(FR-6)、批量外置(FR-9)、
 *       校验与提示(FR-7)、置灰判定(§6.1)、无内部参数节点的边界(FR-2)、
 *       扩展链式挂载与其他扩展共存(§5.1)、中英双语(§5.9)
 *
 * 注：FR-3（可连线参数）已下线，菜单只列内部编辑参数，故无相关用例。
 *
 * 运行：node tests/run.mjs
 *
 * 原理：插件内部使用 `../../scripts/app.js` 这类相对路径导入前端模块，
 * 因此本脚本会在系统临时目录中还原出与浏览器一致的结构：
 *   <sandbox>/scripts/app.js                        <- 桩
 *   <sandbox>/extensions/ComfyUI-BetterNode/*.js    <- 由 web/ 复制而来
 * 这样相对路径的深度与真实运行时完全相同，可顺带验证导入路径是否正确。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(pluginRoot, 'web');

// ---------------------------------------------------------------- 沙盒准备

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'betternode-test-'));
const pluginLink = path.join(sandbox, 'extensions', 'ComfyUI-BetterNode');

fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
fs.mkdirSync(pluginLink, { recursive: true });

fs.writeFileSync(
  path.join(sandbox, 'scripts', 'app.js'),
  [
    'export const app = {',
    '  graph: null,',
    '  canvas: null,',
    '  ui: { dialog: null, settings: null },',
    '  extensionManager: null,',
    '  registerExtension() {},',
    '};',
    '',
  ].join('\n'),
  'utf8'
);
fs.cpSync(webDir, pluginLink, { recursive: true });

const importSandbox = (rel) => import(pathToFileURL(path.join(sandbox, rel)).href);

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`  PASS  ${name}`);
};

// ---------------------------------------------------------------- 桩环境

const { app } = await importSandbox('scripts/app.js');

const graph = {
  nodes: [],
  links: {},
  add(n) { this.nodes.push(n); },
  remove(n) { this.nodes = this.nodes.filter((x) => x !== n); },
  beforeChange() {},
  afterChange() {},
  getNodeOnPos() { return null; },
  getLink(id) { return this.links[id]; },
};

const canvas = { graph, setDirty() {} };
app.graph = graph;
app.canvas = canvas;

/** 捕获警告/错误提示（走 toast 通道） */
const toasts = [];
app.extensionManager = { toast: { add: (options) => toasts.push(options) } };
const lastToast = () => toasts[toasts.length - 1]?.detail ?? '';

let linkSeq = 1000;
const STANDARD_WIDGET_TYPES = ['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'];

globalThis.window = {
  comfyAPI: {
    widgets: { isValidWidgetType: (type) => STANDARD_WIDGET_TYPES.includes(type) },
  },
  LiteGraph: {
    NODE_TITLE_HEIGHT: 30,
    registered_node_types: { PrimitiveNode: {} },
    createNode(type) {
      return {
        type,
        title: '',
        pos: [0, 0],
        size: [190, 80],
        properties: {},
        outputs: [{ links: [], type: '*', name: 'connect to widget input' }],
        // 测试钩子：模拟 PrimitiveNode 的合并校验行为
        __rejectConnect: false,
        __clampTo: undefined,
        connect(outSlot, targetNode, targetSlot) {
          if (this.__rejectConnect) return null;

          if (this.__clampTo !== undefined) {
            const slotName = targetNode.inputs[targetSlot]?.name;
            const widget = targetNode.widgets.find((w) => w.name === slotName);
            if (widget) widget.value = this.__clampTo;
          }

          const link = { id: (linkSeq += 1), target_id: targetNode.id, target_slot: targetSlot };
          graph.links[link.id] = link;
          this.outputs[0].links.push(link.id);
          return link;
        },
      };
    },
  },
};

globalThis.LiteGraph = globalThis.window.LiteGraph;

// Node 环境没有 MouseEvent，补一个最小实现（浏览器中由环境提供）
globalThis.MouseEvent = class MouseEvent {
  constructor(type, init = {}) {
    Object.assign(this, init);
    this.type = type;
  }
};

const primitiveNodes = () => graph.nodes.filter((n) => n.type === 'PrimitiveNode');

/** 构造与真实 KSampler 结构一致的节点 */
function makeKSampler(id, seedValue) {
  const widgets = [
    { name: 'seed', label: '种子', value: seedValue, linkedWidgets: [] },
    { name: 'control_after_generate', label: '生成后控制', value: 'randomize' },
    { name: 'steps', label: '步数', value: 20 },
    { name: 'cfg', label: 'CFG', value: 8 },
    { name: 'sampler_name', label: '采样器', value: 'euler', options: { values: ['euler', 'dpmpp_2m'] } },
    { name: 'scheduler', label: '调度器', value: 'normal' },
    { name: 'denoise', label: '降噪', value: 1.0 },
  ];
  // seed 与控件类 widget 的联动关系（核心 addValueControlWidgets 的真实行为）
  widgets[0].linkedWidgets = [widgets[1]];

  const inputs = [
    { name: 'model', type: 'MODEL' },
    { name: 'seed', type: 'INT', widget: { name: 'seed' } },
    { name: 'steps', type: 'INT', widget: { name: 'steps' } },
    { name: 'cfg', type: 'FLOAT', widget: { name: 'cfg' } },
    { name: 'sampler_name', type: 'COMBO', widget: { name: 'sampler_name' } },
    { name: 'scheduler', type: 'COMBO', widget: { name: 'scheduler' } },
    { name: 'positive', type: 'CONDITIONING' },
    { name: 'negative', type: 'CONDITIONING' },
    { name: 'latent_image', type: 'LATENT' },
    { name: 'denoise', type: 'FLOAT', widget: { name: 'denoise' } },
  ];

  const node = {
    id,
    pos: [500, 300 + id * 100],
    graph,
    inputs,
    widgets,
    isVirtualNode: false,
    isSubgraphNode: () => false,
  };
  graph.nodes.push(node);
  return node;
}

/** 构造与 KSamplerAdvanced 结构一致的节点（含 noise_seed） */
function makeKSamplerAdvanced(id, seedValue) {
  const widgets = [
    { name: 'add_noise', label: '添加噪波', value: 'enable', options: { values: ['enable', 'disable'] } },
    { name: 'noise_seed', label: '噪波种子', value: seedValue, linkedWidgets: [] },
    { name: 'control_after_generate', label: '生成后控制', value: 'randomize' },
    { name: 'steps', label: '步数', value: 20 },
  ];
  widgets[1].linkedWidgets = [widgets[2]];

  const inputs = [
    { name: 'model', type: 'MODEL' },
    { name: 'add_noise', type: 'COMBO', widget: { name: 'add_noise' } },
    { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' } },
    { name: 'steps', type: 'INT', widget: { name: 'steps' } },
    { name: 'positive', type: 'CONDITIONING' },
    { name: 'negative', type: 'CONDITIONING' },
    { name: 'latent_image', type: 'LATENT' },
  ];

  const node = {
    id,
    pos: [900, 300 + id * 100],
    graph,
    inputs,
    widgets,
    isVirtualNode: false,
    isSubgraphNode: () => false,
  };
  graph.nodes.push(node);
  return node;
}

const { buildInputParamsMenu } = await importSandbox('extensions/ComfyUI-BetterNode/menu/buildMenu.js');
const { t, getLang, resetLang } = await importSandbox('extensions/ComfyUI-BetterNode/i18n/index.js');
const { reuseKeyOf, isSameReuseKey } = await importSandbox('extensions/ComfyUI-BetterNode/params/synonyms.js');

const openMenu = (node) => {
  const options = [];
  buildInputParamsMenu(node, canvas, options);
  return options;
};
const subItems = (node) => openMenu(node)[0]?.submenu?.options ?? [];
const findItem = (node, prefix) => {
  const item = subItems(node).find((i) => i.content.startsWith(prefix));
  assert.ok(item, `找不到条目 ${prefix}`);
  return item;
};
const clickItem = (node, prefix) => {
  const item = findItem(node, prefix);
  assert.equal(item.disabled, false, `条目 ${prefix} 不应被置灰`);
  item.callback();
  return item;
};
/** 参数条目（排除批量入口那一项） */
const paramLabels = (node) => subItems(node).filter((i) => !i.content.startsWith('全部外置')).map((i) => i.content);
/** 批量入口条目 */
const batchItem = (node) => subItems(node).find((i) => i.content.startsWith('全部外置'));

// ---------------------------------------------------------------- 1. 菜单结构

console.log('\n[1] 菜单结构（FR-1 / FR-2）');

const ks1 = makeKSampler(1, 12345);
const opts = openMenu(ks1);

assert.equal(opts.length, 1, '应只注入 1 个顶级条目');
assert.equal(opts[0].content, '输入参数');
assert.equal(opts[0].has_submenu, true);
assert.ok(Array.isArray(opts[0].submenu.options), '二级菜单应为静态 options');
ok('注入「输入参数」二级菜单，且只注入一项');

const labels = paramLabels(ks1);
console.log(`      ${labels.join(' | ')}`);
assert.deepEqual(labels, ['种子', '步数', 'CFG', '采样器', '调度器', '降噪'], '顺序应与节点定义一致，且不带状态后缀');
ok('只列出 6 个内部编辑参数，未外置时不带状态后缀');

assert.ok(!labels.some((l) => l.includes('control_after_generate')), '不得出现控件联动项');
ok('排除 control_after_generate 控件联动项');

assert.ok(!labels.some((l) => ['model', 'positive', 'negative', 'latent_image'].some((n) => l.startsWith(n))));
ok('可连线参数（model / positive / negative / latent_image）不在菜单中');

// ---------------------------------------------------------------- 2. 入参节点

console.log('\n[2] 内部参数 -> 入参节点（FR-4）');

clickItem(ks1, '种子');
const created = primitiveNodes();
assert.equal(created.length, 1, '应创建 1 个入参节点');
assert.equal(created[0].title, '入参·seed');
assert.equal(created[0].properties.betterNode.param, 'seed');
assert.equal(created[0].properties.betterNode.owner, undefined, '首次创建应为共享节点');
assert.equal(created[0].outputs[0].links.length, 1, '应建立 1 条连线');

const link1 = graph.links[created[0].outputs[0].links[0]];
assert.equal(link1.target_id, ks1.id);
assert.equal(link1.target_slot, 1, 'seed 在 inputs 中的下标为 1');
ok('点击「种子」创建入参节点并连到 seed 槽（下标 1）');

// ---------------------------------------------------------------- 3. 复用 + 状态

console.log('\n[3] 复用（FR-5）');

clickItem(ks1, '种子');
assert.equal(primitiveNodes().length, 1, '不应重复创建');
ok('同一节点重复点击不重复创建');

const ks2 = makeKSampler(2, 999);
clickItem(ks2, '种子');
assert.equal(primitiveNodes().length, 1, '仍只有 1 个入参节点');
assert.equal(primitiveNodes()[0].outputs[0].links.length, 2, '入参节点应连到 2 个目标');
ok('一个入参节点成功连接两个同类节点');

// ---------------------------------------------------------------- 4. 复用明细

console.log('\n[4] 复用明细（FR-6）');

const ks1Label = findItem(ks1, '种子').content;
console.log(`      ${ks1Label}`);
assert.ok(ks1Label.includes('已外置'), ks1Label);
assert.ok(ks1Label.includes('×2'), `连了 2 个目标应显示 ×2：${ks1Label}`);
ok('已外置的参数显示状态与目标数（×N）');

const ks3 = makeKSampler(3, 7);
assert.equal(findItem(ks3, '步数').content, '步数', '无入参节点时不带后缀');
assert.ok(findItem(ks3, '种子').content.includes('可复用'), findItem(ks3, '种子').content);
console.log(`      ${findItem(ks3, '种子').content}`);
ok('有节点但未连接显示「可复用」，无节点则只显示参数名');

// ---------------------------------------------------------------- 5. 同义组

console.log('\n[5] 同义组复用键（FR-5）');

assert.equal(reuseKeyOf('seed'), reuseKeyOf('noise_seed'), 'seed 与 noise_seed 应归并到同一键');
assert.equal(reuseKeyOf('steps'), 'steps', '未列入同义组的参数，复用键即参数名');
assert.ok(isSameReuseKey('seed', 'noise_seed'));
ok('同义组：seed / noise_seed 归并为同一复用键');

const adv = makeKSamplerAdvanced(20, 42);
clickItem(adv, '噪波种子');
assert.equal(primitiveNodes().length, 1, '应复用同一个入参节点，不新建');
assert.equal(primitiveNodes()[0].outputs[0].links.length, 3, '应追加连到第 3 个目标');
ok('点击 noise_seed 复用 seed 的入参节点（一种子驱动全部采样器）');

const advLabel = findItem(adv, '噪波种子').content;
console.log(`      ${advLabel}`);
assert.ok(advLabel.includes('同义组共用'), advLabel);
assert.ok(advLabel.includes('×3'), advLabel);
ok('经同义组共用的参数在菜单中标注「同义组共用」');

// ---------------------------------------------------------------- 6. 批量外置

console.log('\n[6] 批量外置（FR-9）');

const ks4 = makeKSampler(4, 7);
const item4 = batchItem(ks4);
assert.ok(item4, '存在待处理参数时应提供批量入口');
console.log(`      ${item4.content}`);
assert.ok(item4.content.includes('6'), `待处理数应为 6：${item4.content}`);
ok('批量入口显示待处理参数数量');

const before = primitiveNodes().length;
clickItem(ks4, '全部外置');

const added = primitiveNodes().length - before;
assert.equal(added, 5, `其中 seed 应复用已有节点，其余 5 个新建；实际新增 ${added}`);
const connectedCount = Object.values(graph.links).filter((l) => l.target_id === ks4.id).length;
assert.equal(connectedCount, 6, `ks4 的 6 个内部参数槽应全部接上，实际 ${connectedCount}`);
ok('批量外置把 6 个内部参数全部接上（复用 1 + 新建 5）');

assert.equal(batchItem(ks4), undefined, '全部外置后不应再出现批量入口');
ok('全部已外置后批量入口消失');

const partiallyDone = makeKSampler(5, 7);
clickItem(partiallyDone, '步数');
const item5 = batchItem(partiallyDone);
assert.ok(item5.content.includes('5'), `应剩 5 个待处理：${item5.content}`);
ok('部分已外置时，批量入口只统计待处理项');

// ---------------------------------------------------------------- 7. 提示级校验

console.log('\n[7] 校验与提示（FR-7 提示级）');

toasts.length = 0;
const sharedSteps = primitiveNodes().find((n) => n.properties.betterNode.param === 'steps');
assert.ok(sharedSteps, '应存在共享的 steps 入参节点');
sharedSteps.__rejectConnect = true;

clickItem(ks3, '步数');
assert.ok(toasts.length >= 1, '合并被拒应有提示');
assert.ok(lastToast().includes('不兼容'), lastToast());
console.log(`      ${lastToast()}`);

const stepsNodes = primitiveNodes().filter((n) => n.properties.betterNode.param === 'steps');
assert.equal(stepsNodes.length, 2, '应新增 1 个专用入参节点');
assert.equal(stepsNodes[1].properties.betterNode.owner, ks3.id, '专用节点应记录 owner');
sharedSteps.__rejectConnect = false;
ok('合并被拒 -> 新建专用节点并说明原因');

toasts.length = 0;
clickItem(ks3, '步数');
assert.equal(
  primitiveNodes().filter((n) => n.properties.betterNode.param === 'steps').length,
  2,
  '不得因重复点击而膨胀节点'
);
assert.equal(toasts.length, 0, '不应重复告警');
ok('专用节点建立后重复点击保持稳定（不膨胀、不重复告警）');

toasts.length = 0;
const ks6 = makeKSampler(6, 7);
const seedNode = primitiveNodes().find((n) => n.properties.betterNode.param === 'seed');
seedNode.__clampTo = 111;
clickItem(ks6, '种子');
assert.ok(lastToast().includes('收敛'), lastToast());
assert.ok(lastToast().includes('111'), lastToast());
console.log(`      ${lastToast()}`);
seedNode.__clampTo = undefined;
ok('值被钳制 -> 提示原因与调整前后取值');

// ---------------------------------------------------------------- 8. 置灰判定

console.log('\n[8] 不可用项的置灰（FR-7 阻断级 / DESIGN §6.1）');

const lockedNode = makeKSampler(7, 1);
lockedNode.inputs[1].locked = true;
const lockedItem = findItem(lockedNode, '种子');
assert.equal(lockedItem.disabled, true);
console.log(`      ${lockedItem.content}`);
ok('锁定槽被置灰并给出原因');

const exoticNode = {
  id: 8,
  graph,
  isVirtualNode: false,
  isSubgraphNode: () => false,
  inputs: [{ name: 'curve', type: 'CURVE', widget: { name: 'curve' } }],
  widgets: [{ name: 'curve', label: '曲线', value: 'x' }],
};
assert.equal(findItem(exoticNode, '曲线').disabled, true);
console.log(`      ${findItem(exoticNode, '曲线').content}`);
ok('自定义 widget 类型被置灰并给出原因');

assert.equal(openMenu({ id: 9, graph, isVirtualNode: true, inputs: [], widgets: [] }).length, 0);
ok('虚拟节点不注入菜单');

const subgraphItem = findItem(
  {
    id: 10,
    graph,
    isVirtualNode: false,
    isSubgraphNode: () => true,
    inputs: [{ name: 'x', type: 'INT', widget: { name: 'x' } }],
    widgets: [{ name: 'x', label: 'x', value: 1 }],
  },
  'x'
);
assert.equal(subgraphItem.disabled, true);
assert.ok(subgraphItem.content.includes('子图'));
ok('子图节点被置灰并给出原因');

assert.equal(
  openMenu({ id: 11, graph, isVirtualNode: false, isSubgraphNode: () => false, inputs: [], widgets: [] }).length,
  0
);
ok('无参数节点不注入菜单');

// ---------------------------------------------------------------- 9. 无内部参数

console.log('\n[9] 没有内部编辑参数的节点（FR-2 边界）');

const pureLinkNode = {
  id: 12,
  graph,
  isVirtualNode: false,
  isSubgraphNode: () => false,
  inputs: [
    { name: 'model', type: 'MODEL' },
    { name: 'positive', type: 'CONDITIONING' },
  ],
  widgets: [],
};
assert.equal(openMenu(pureLinkNode).length, 0, '只有可连线参数时不应注入菜单');
ok('只有可连线参数（无内部参数）时整项不注入，避免空菜单');

const mixedNode = {
  id: 13,
  graph,
  isVirtualNode: false,
  isSubgraphNode: () => false,
  inputs: [
    { name: 'model', type: 'MODEL' },
    { name: 'strength', type: 'FLOAT', widget: { name: 'strength' } },
  ],
  widgets: [{ name: 'strength', label: '强度', value: 1 }],
};
const mixedLabels = paramLabels(mixedNode);
console.log(`      ${mixedLabels.join(' | ')}`);
assert.deepEqual(mixedLabels, ['强度'], '混合节点只应列出内部参数');
ok('混合节点仅列出内部参数，可连线条目被过滤');

// ---------------------------------------------------------------- 10. 中英双语

console.log('\n[10] 中英双语（FR-7 / §5.9）');

assert.equal(getLang(), 'zh', '默认应为中文');
resetLang();

app.ui.settings = { getSettingValue: (id) => (id === 'Comfy.Locale' ? 'en-US' : undefined) };
resetLang();
const enOpts = openMenu(makeKSampler(30, 1));
assert.equal(enOpts[0].content, 'Input Parameters');
assert.equal(getLang(), 'en');

const enLabels = enOpts[0].submenu.options.map((i) => i.content);
console.log(`      ${enLabels.join(' | ')}`);
assert.ok(enLabels.some((l) => l.includes('reusable')), enLabels.join('|'));
assert.ok(enLabels.some((l) => l.includes('Externalize all')), enLabels.join('|'));

// 同义组共用（需 KSamplerAdvanced 的 noise_seed 才能体现）
const enAdvLabel = findItem(makeKSamplerAdvanced(33, 1), '噪波种子').content;
console.log(`      ${enAdvLabel}`);
assert.ok(enAdvLabel.includes('shared via group'), enAdvLabel);

const enLocked = makeKSampler(31, 1);
enLocked.inputs[1].locked = true;
console.log(`      ${findItem(enLocked, '种子').content}`);
assert.ok(findItem(enLocked, '种子').content.includes('unavailable'));
ok('切换到英文后菜单文案（含状态、同义组、批量入口、不可用原因）全部变为英文');

app.ui.settings = { getSettingValue: () => 'zh-CN' };
resetLang();
assert.equal(openMenu(makeKSampler(32, 1))[0].content, '输入参数', '切回中文应生效');
ok('语言切换即时生效（每次打开菜单重读）');

const { zh } = await importSandbox('extensions/ComfyUI-BetterNode/i18n/zh.js');
const { en } = await importSandbox('extensions/ComfyUI-BetterNode/i18n/en.js');
const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();
assert.deepEqual(zhKeys, enKeys, '中英字典键集合必须一致');
assert.ok(zhKeys.length >= 30, `字典键数量偏少：${zhKeys.length}`);
ok(`中英字典键集合一致（${zhKeys.length} 项）`);

assert.equal(t('不存在的键'), '不存在的键');
ok('缺键时回退键名本身，不抛错');

// ---------------------------------------------------------------- 11. 扩展挂载

console.log('\n[11] 扩展入口：链式挂载与其他扩展共存（§5.1）');

let registered = null;
app.registerExtension = (ext) => { registered = ext; };
await importSandbox('extensions/ComfyUI-BetterNode/betterNode.js');

assert.ok(registered, '应调用 app.registerExtension');
assert.equal(registered.name, 'BetterNode.InputParams');
ok('扩展已注册');

const otherCalls = [];
function otherExtensionHook(_canvas, options) {
  otherCalls.push(true);
  options.unshift({ content: '其他扩展的条目' });
  return [];
}

const fakeNodeType = function FakeNode() {};
fakeNodeType.prototype.getExtraMenuOptions = otherExtensionHook;

await registered.beforeRegisterNodeDef(fakeNodeType);

const menuNode = makeKSampler(40, 42);
const options = [{ content: '核心条目 1' }, { content: '核心条目 2' }];
const returned = fakeNodeType.prototype.getExtraMenuOptions.call(menuNode, canvas, options);

assert.equal(otherCalls.length, 1, '其他扩展的钩子必须被调用');
ok('其他扩展的钩子被调用（未被覆盖）');

assert.equal(returned.length, 0, '必须原样返回上一个钩子的返回值');
ok('原样返回上一个钩子的返回值');

const contents = options.map((o) => o.content);
console.log(`      ${contents.join(' | ')}`);
assert.ok(contents.includes('核心条目 1') && contents.includes('核心条目 2'), '核心条目不得丢失');
assert.ok(contents.includes('其他扩展的条目'), '其他扩展条目不得丢失');
assert.ok(contents.includes('输入参数'), '本插件条目应已注入');
ok('核心条目、其他扩展条目、本插件条目三者共存');

const brokenNode = {
  id: 41,
  graph,
  isVirtualNode: false,
  isSubgraphNode: () => false,
  get inputs() { throw new Error('模拟异常'); },
};
let threw = false;
try {
  fakeNodeType.prototype.getExtraMenuOptions.call(brokenNode, canvas, []);
} catch {
  threw = true;
}
assert.equal(threw, false, '本插件内部异常不得向外抛出');
ok('内部异常被隔离，不影响核心与其他扩展');

const bareNodeType = function BareNode() {};
await registered.beforeRegisterNodeDef(bareNodeType);

let safe = true;
try {
  const result = bareNodeType.prototype.getExtraMenuOptions.call(menuNode, canvas, undefined);
  assert.equal(result, undefined);
} catch (error) {
  safe = false;
  console.error(error);
}
assert.ok(safe);
ok('options 非数组、无前置钩子时安全退出');

// ---------------------------------------------------------------- 收尾

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(`\n全部通过：${passed} 项\n`);
