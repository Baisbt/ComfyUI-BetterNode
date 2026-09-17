/**
 * ComfyUI-BetterNode 逻辑回归测试
 *
 * 用途：在不启动 ComfyUI 的前提下，用桩对象验证插件的核心逻辑。
 * 覆盖：菜单结构(FR-1/FR-2)、入参节点创建与复用(FR-4/FR-5)、
 *       置灰判定(FR-7/§6.1)、扩展链式挂载与其他扩展共存(§5.1)
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
  'export const app = { graph: null, canvas: null, ui: { dialog: null }, registerExtension() {} };\n',
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

const canvas = { graph, showConnectionMenu() {}, setDirty() {} };
app.graph = graph;
app.canvas = canvas;

let linkSeq = 1000;
globalThis.window = {
  LiteGraph: {
    NODE_TITLE_HEIGHT: 30,
    createNode(type) {
      return {
        type,
        title: '',
        pos: [0, 0],
        size: [190, 80],
        properties: {},
        outputs: [{ links: [], type: '*', name: 'connect to widget input' }],
        connect(outSlot, targetNode, targetSlot) {
          const link = { id: (linkSeq += 1), target_id: targetNode.id, target_slot: targetSlot };
          graph.links[link.id] = link;
          this.outputs[0].links.push(link.id);
          return link;
        },
      };
    },
  },
};

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

const { buildInputParamsMenu } = await importSandbox('extensions/ComfyUI-BetterNode/menu/buildMenu.js');

const openMenu = (node) => {
  const options = [];
  buildInputParamsMenu(node, canvas, options);
  return options;
};

// ---------------------------------------------------------------- 1. 菜单结构

console.log('\n[1] 菜单结构（FR-1 / FR-2）');

const ks1 = makeKSampler(1, 12345);
const opts = openMenu(ks1);

assert.equal(opts.length, 1, '应只注入 1 个顶级条目');
assert.equal(opts[0].content, '输入参数');
assert.equal(opts[0].has_submenu, true);
assert.ok(Array.isArray(opts[0].submenu.options), '二级菜单应为静态 options');
ok('注入「输入参数」二级菜单，且只注入一项');

const labels = opts[0].submenu.options.map((i) => i.content);
console.log(`      ${labels.join(' | ')}`);
assert.equal(labels.length, 10, '应列出全部 10 个输入参数');
assert.ok(!labels.some((l) => l.includes('control_after_generate')), '不得出现控件联动项');
ok('列出全部 10 个参数，且排除 control_after_generate');

assert.equal(labels.filter((l) => l.includes('（可连线）')).length, 4, 'model/positive/negative/latent_image');
assert.equal(labels.filter((l) => l.includes('（内部参数）')).length, 6, 'seed/steps/cfg/sampler_name/scheduler/denoise');
ok('分类正确：4 可连线 + 6 内部参数');

const click = (options, prefix) => {
  const item = options[0].submenu.options.find((i) => i.content.startsWith(prefix));
  assert.ok(item, `找不到条目 ${prefix}`);
  assert.ok(!item.disabled, `条目 ${prefix} 不应被置灰`);
  item.callback();
  return item;
};

// ---------------------------------------------------------------- 2. 入参节点

console.log('\n[2] 内部参数 -> 入参节点（FR-4）');

click(opts, '种子');
const created = graph.nodes.filter((n) => n.type === 'PrimitiveNode');
assert.equal(created.length, 1, '应创建 1 个入参节点');
assert.equal(created[0].title, '入参·seed');
assert.equal(created[0].properties.betterNode.param, 'seed');
assert.equal(created[0].outputs[0].links.length, 1, '应建立 1 条连线');

const link1 = graph.links[created[0].outputs[0].links[0]];
assert.equal(link1.target_id, ks1.id);
assert.equal(link1.target_slot, 1, 'seed 在 inputs 中的下标为 1');
ok('点击「种子」创建入参节点并连到 seed 槽（下标 1）');

// ---------------------------------------------------------------- 3. 复用

console.log('\n[3] 重复点击同一参数 -> 复用（FR-5）');

click(opts, '种子');
assert.equal(graph.nodes.filter((n) => n.type === 'PrimitiveNode').length, 1, '不应重复创建');
ok('重复点击不重复创建节点');

// ---------------------------------------------------------------- 4. 一对多

console.log('\n[4] 另一同类节点同参数 -> 复用并追加连线（FR-5）');

const ks2 = makeKSampler(2, 999);
click(openMenu(ks2), '种子');

assert.equal(graph.nodes.filter((n) => n.type === 'PrimitiveNode').length, 1, '仍只有 1 个入参节点');
const primitive = graph.nodes.find((n) => n.type === 'PrimitiveNode');
assert.equal(primitive.outputs[0].links.length, 2, '入参节点应连到 2 个目标');
ok('一个入参节点成功连接两个同类节点');

// ---------------------------------------------------------------- 5. 置灰判定

console.log('\n[5] 不可用项的置灰（FR-7 / DESIGN §6.1）');

const lockedNode = makeKSampler(3, 1);
lockedNode.inputs[1].locked = true;
const lockedItem = openMenu(lockedNode)[0].submenu.options.find((i) => i.content.startsWith('种子'));
assert.equal(lockedItem.disabled, true);
assert.ok(lockedItem.content.includes('不可用'));
console.log(`      ${lockedItem.content}`);
ok('锁定槽被置灰并给出原因');

assert.equal(openMenu({ id: 9, graph, isVirtualNode: true, inputs: [], widgets: [] }).length, 0);
ok('虚拟节点不注入菜单');

const subgraphItem = openMenu({
  id: 10,
  graph,
  isVirtualNode: false,
  isSubgraphNode: () => true,
  inputs: [{ name: 'x', type: 'INT', widget: { name: 'x' } }],
  widgets: [{ name: 'x', label: 'x', value: 1 }],
})[0].submenu.options[0];
assert.equal(subgraphItem.disabled, true);
assert.ok(subgraphItem.content.includes('子图'));
console.log(`      ${subgraphItem.content}`);
ok('子图节点被置灰并给出原因');

assert.equal(
  openMenu({ id: 11, graph, isVirtualNode: false, isSubgraphNode: () => false, inputs: [], widgets: [] }).length,
  0
);
ok('无参数节点不注入菜单');

// ---------------------------------------------------------------- 6. 扩展挂载

console.log('\n[6] 扩展入口：链式挂载与其他扩展共存（§5.1）');

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

const menuNode = makeKSampler(20, 42);
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

// 本插件内部异常必须被隔离
const brokenNode = {
  id: 21,
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

// 无前置钩子 + options 非数组
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
