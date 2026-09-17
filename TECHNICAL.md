# TECHNICAL.md — BetterNode 技术方案

| 项 | 内容 |
|---|---|
| 文档版本 | v1.2 |
| 状态 | 待审阅 |
| 关联文档 | `DESIGN.md`（产品设计）、`AGENTS.md`（开发约束） |
| 变更记录 | v1.1 新增 FR-3 双入口、FR-7 校验与中英引导、FR-8 随机化能力、v1 支持范围；补 §5.8 guards、§5.9 i18n<br>v1.2 **§5.4 重写**：起线拖拽实测否决（§5.4.1 记录根因），FR-3 收敛为来源菜单单入口；同步目录结构、机制表、能力探测、风险、测试矩阵、未决问题 |

---

## 1. 环境基线（实测）

| 组件 | 版本 / 路径 | 说明 |
|---|---|---|
| ComfyUI | **0.30.2** | `ComfyUI/comfyui_version.py` |
| 前端包 | **comfyui_frontend_package 1.47.12** | `python/Lib/site-packages/comfyui_frontend_package` |
| 前端源码可读性 | 附带 `.js.map`，`sourcesContent` 含未压缩源码 | 本方案所有机制结论均据此核实 |
| KSampler 定义 | `nodes.py:1580` | 沿用 V1 `INPUT_TYPES` 风格 |

> 兼容策略按 `DESIGN.md` §8：**仅支持 1.47.x 基线**，不做向下兼容。

---

## 2. 总体架构

### 2.1 架构结论：纯前端扩展，不需要 Python 节点

插件**不包含任何会参与执行的节点**，原因：

1. 目标参数槽在节点上**已经存在**（见 §4 机制 3），无需后端新增输入。
2. 「入参节点」复用 ComfyUI 内置的虚拟节点 **PrimitiveNode**，它已具备参数规格同步、取值拷贝、下拉选项同步、一对多赋值等全部所需能力（见 §4 机制 5）。
3. 所有交互（菜单、起线、建节点）均属前端画布行为，与后端执行完全无关。

因此 Python 侧只需一个 `__init__.py` 声明 `WEB_DIRECTORY`。

### 2.2 架构分层

```
┌─────────────────────────────────────────────────┐
│  ComfyUI 前端（1.47.12，不修改）                  │
│   LGraphCanvas / LGraphNode / PrimitiveNode      │
│   linkConnector / ContextMenu                    │
└───────────────▲─────────────────────────────────┘
                │ 运行时挂载（prototype 链式钩子 + 公开 API 调用）
┌───────────────┴─────────────────────────────────┐
│  BetterNode 扩展（web/）                          │
│   entry → menu → params → actions → compat       │
└─────────────────────────────────────────────────┘
```

---

## 3. 目录结构

```
ComfyUI-BetterNode/
├── __init__.py              # 仅声明 WEB_DIRECTORY，无节点注册
├── web/
│   ├── betterNode.js        # 扩展入口：app.registerExtension + 生命周期
│   ├── menu/
│   │   └── buildMenu.js     # 构建「输入参数」二级菜单；文案/状态/点击分发
│   ├── params/
│   │   ├── enumerate.js     # 参数枚举、分类、当前值/选项读取
│   │   └── guards.js        # 支持范围判定（返回原因键，文案由 i18n 解析）
│   ├── actions/
│   │   ├── showSourceMenu.js# FR-3 选择来源节点（唯一入口）
│   │   └── createInputNode.js # FR-4/FR-5/FR-6 入参节点工厂、复用索引、状态查询
│   ├── i18n/
│   │   ├── index.js         # 语言判定（读 Comfy.Locale）+ 查表 + 缺键回退
│   │   ├── zh.js            # 中文文案
│   │   └── en.js            # 英文文案
│   ├── ui/
│   │   └── notify.js        # 提示通道（toast → dialog → console 逐级降级）
│   └── compat/
│       └── capability.js    # 能力探测与降级判据
├── tests/
│   └── run.mjs              # 逻辑回归测试（无需启动 ComfyUI）
├── DESIGN.md
├── TECHNICAL.md
└── README.md                # 阶段性收尾时补
```

> `AGENTS.md` 与 `.workbuddy/` 不纳入版本控制（见 `.gitignore`）。

---

## 4. 关键机制与源码依据

以下为方案依赖的全部关键机制，均已在前端源码中核实。

| # | 机制 | API / 位置 | 用途 |
|---|---|---|---|
| 1 | 节点菜单扩展点 | `node.prototype.getExtraMenuOptions(canvas, options)`，核心自身即以此加项（`src/services/litegraphService.ts` `addNodeContextMenuHandler`）；调用方 `src/lib/litegraph/src/LGraphCanvas.ts:8646`：`const extra = node.getExtraMenuOptions?.(this, options)` | FR-1 挂载菜单 |
| 2 | 二级菜单 | `{ content, has_submenu: true, submenu: { options: [...] } }`（`LGraphCanvas.ts:8778`、`src/composables/graph/contextMenuConverter.ts:428`） | FR-1 子菜单 |
| 3 | widget 与 socket 共存 | `src/extensions/core/widgetInputs.ts:519`：`convertWidgetToInput` 已废弃为空操作；`src/stores/nodeDefStore.ts` `_migrateDefaultInput` 注释确认 required 输入的槽恒存在 | FR-2 分类判据 |
| 3b | widget 输入槽的创建 | `src/services/litegraphService.ts` `addInputWidget`：`node.addInput(name, spec.type, { widget: { name, [GET_CONFIG]: () => specV1 } })`；`forceInput` 与 `socketless` 除外 | FR-2 分类判据 |
| 4 | ~~起线拖拽~~ | **已实测否决并移除**。`linkConnector.dragNewFromInput()` 只能产生连线动画，无法落点——原生落点依赖 `pointerdown` 记录 `eDown`，菜单点击没有这个动作，合成指针序列也无法绕过。详见 **§5.4.1** | 反例参考（勿重试） |
| 5 | 入参节点 | `src/extensions/core/widgetInputs.ts:31` `class PrimitiveNode`（`isVirtualNode = true`、`serialize_widgets = true`）；注册于同文件 `registerCustomNodes()` | FR-4 / FR-5 |
| 5a | 自动取值 | `PrimitiveNode._createWidget`：`widget.value = theirWidget.value` | FR-4 值为当前值 |
| 5b | 下拉选项同步 | `PrimitiveNode.refreshComboInNode`：从 `outputs[0].widget[GET_CONFIG]()[0]` 取选项 | FR-4 下拉框 |
| 5c | 一对多 | `PrimitiveNode.onConnectOutput` / `_mergeWidgetConfig` / 模块内 `mergeIfValid` | FR-5 |
| 5d | 原生同款行为 | 同文件 `onInputDblClick`：双击 widget 输入槽自动创建 PrimitiveNode（`graph.add` → 避让定位 → `node.connect(0, this, slot)` → `title = input.name`） | FR-4 实现范本 |
| 6 | 菜单后处理限制 | `contextMenuConverter.convertSubmenuToOptions` 丢弃 `null` 分隔符；`buildStructuredMenu` 将非核心项归入「Extensions」分组 | FR-2 分组文案化 |
| 7 | 全局引用 | `window.LiteGraph` 在前端包中已挂载；`app` 由 `scripts/app.js` 导出 | 插件取用方式 |
| 8 | **来源选择菜单** | `LGraphCanvas.showConnectionMenu({ nodeTo, slotTo, e })`（`LGraphCanvas.ts:6946`，公开方法）。原生"连线落点在空白处"即调用它（`LGraphCanvas.ts:870-926` `dropped-on-canvas`，受 `LiteGraph.release_link_on_empty_shows_menu` 控制） | **FR-3b**，不依赖指针拖拽生命周期 |
| 9 | **全局模块表** | `window.comfyAPI` 暴露 12 个模块：`api / app / changeTracker / controlWidgetMarker / defaultGraph / domWidget / pnginfo / promotedWidgetControl / ui / utils / valueControl / widgets`（`scripts/*.js` 均为转发层）。**其中无 i18n** | 取用官方实现；明确 i18n 需自建 |
| 10 | **值控制控件** | 由控件构造器自动添加：`inputSpec.control_after_generate` 为真，**或** `inputSpec.name ∈ ['seed','noise_seed']`；combo 控件选项 `fixed/increment/decrement/randomize`（combo 目标额外 `increment-wrap`），默认 `randomize`；`serialize:false` + `canvasOnly:true`，以 `IS_CONTROL_WIDGET` 标记并挂到宿主 `linkedWidgets`；队列时由 `src/scripts/valueControl.ts` `nextValueForLinkedTarget` 计算新值；生效时机受设置 `Comfy.WidgetControlMode` 控制。`PrimitiveNode._createWidget` 中的同名分支为**兜底**（避免重复添加） | **FR-8 原生已满足**（无需实现） |
| 11 | **规格合并校验** | `src/utils/nodeDefUtil.ts:120` `mergeInputSpec`：类型须完全相同（INT/FLOAT 不互通）；数值型要求范围重叠，合并 `min=max(min1,min2)`、`max=min(max1,max2)`、`step=lcm(step1,step2)`；combo 取选项交集，空交集返回 null；其余除 `IGNORE_KEYS` 外所有键须一致。`mergeIfValid` 内对值做越界钳制 | **FR-7** 提示级校验依据 |
| 12 | **多选行为** | `src/composables/graph/useMoreOptionsMenu.ts:180`：仅当 `selectedNodes.length === 1` 时才调用 `canvas.getNodeMenuOptions(node)` → 多选时 `getExtraMenuOptions` 不被调用 | FR-1 边界（多选不出现） |

---

## 5. 模块设计

### 5.1 扩展注册与生命周期

```js
// web/betterNode.js（示意，非最终实现）
import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "BetterNode.InputParams",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    nodeType.prototype.getExtraMenuOptions = chain(
      nodeType.prototype.getExtraMenuOptions,
      function (canvas, options) {
        buildInputParamsMenu(this, canvas, options);
      }
    );
  },
});
```

要点：

- 使用自实现的 `chain(prev, next)`（等价于前端的 `useChainCallback`），保证不覆盖其他扩展已挂载的同名钩子。
- 仅在 `beforeRegisterNodeDef` 挂载，不触碰任何节点源码；`nodeData` 可用于提前判定该节点类型是否值得挂载。
- 钩子返回值：核心逻辑为「返回数组则前置插入」，为避免干扰其他扩展，本插件**直接向传入的 `options` 追加**，并返回 `undefined`。
- **多选双保险**：现版本仅在单选时才聚合节点菜单（§4 机制 12），但插件内部仍须自行判定选中数量，非 1 个时不注入条目/置灰，不依赖上游行为长期不变。
- **节点类型过滤**：在钩子内先经 `guards.assessNode()` 判定（§5.8），虚拟节点与子图节点直接返回，不产生菜单噪声。

### 5.2 菜单注入（FR-1）

- 条目：`{ content: "输入参数", has_submenu: true, submenu: { options: [...] } }`。
- **静态子菜单**写法（`item.submenu.options`）优于动态回调写法，可避免 `contextMenuConverter.captureDynamicSubmenu` 对 `LiteGraph.ContextMenu` 的临时替换。
- 子菜单条目形如 `{ content: "种子 · 已外置", callback: () => onClick(param) }`。
- 约束与应对（源自 §4 机制 6）：
  - 子菜单**无法插入分隔线或分组标题** → 分组用文案前缀表达（`模型`、`种子 · 已外置`）。
  - 顶级项会被归入菜单的「Extensions」分组 → 文案设计保证可辨识，不尝试伪装成核心项。
  - `convertContextMenuToOptions` 有 `HARD_BLACKLIST` 与重复项过滤 → **条目文案不得与核心项重名**（「输入参数」无冲突）。

### 5.3 参数枚举器（FR-2）

以 `node.inputs` 为主序（与节点定义顺序一致），以 `node.widgets` 为补充：

```js
function enumerateParams(node) {
  const params = [];
  for (const input of node.inputs ?? []) {
    const widget = input.widget
      ? node.widgets?.find((w) => w.name === input.widget.name)
      : undefined;
    params.push({
      name: input.name,
      slotType: input.type,
      kind: widget ? "widget" : "link",   // 内部编辑参数 / 可连线参数
      input,
      widget,
    });
  }
  // 补充 socketless 等无输入槽的 widget（是否展示由 DESIGN.md §5.2 决定）
  for (const w of node.widgets ?? []) {
    if (isControlWidget(w)) continue;
    if (params.some((p) => p.name === w.name)) continue;
    params.push({ name: w.name, kind: "widget", widget: w, input: undefined });
  }
  return params;
}
```

- **分类规则**：`input.widget` 存在 → 内部编辑参数；否则 → 可连线参数（已在源码中确认这是本版本的可靠判据）。
- **控件联动项排除**：`seed` 会附带 `control_after_generate` 控件（`addValueControlWidgets` 生成，并挂到宿主 widget 的 `linkedWidgets` 上）。排除规则：被任一 widget 的 `linkedWidgets` 引用者视为控件，不进菜单。
- **取值**：`widget.value`。
- **下拉选项**：`widget.options?.values`（用于 FR-6 状态展示与显示校验，实际选项同步由 PrimitiveNode 负责）。
- **高级/隐藏参数**：`widget.options?.advanced` / `widget.options?.hidden` 仅用于展示标记，不额外过滤。

### 5.4 FR-3 可连线参数：选择来源节点（唯一入口）

**实现**：复用官方公开方法 `canvas.showConnectionMenu({ nodeTo, slotTo, e })`，
即原生"把连线拖到空白处"弹出的来源菜单，选中来源即建链。

```js
canvas.showConnectionMenu({
  nodeTo: targetNode,
  slotTo: slotIndex,          // 传下标而非槽对象，避免同名槽歧义
  e: makePositionEvent(...),  // 菜单定位需要 clientX/clientY
});
```

- 定位事件优先复用真实的 `contextmenu` 事件（菜单回调拿不到 MouseEvent，
  需在 `installContextMenuTracker` 中于交互发生时先行捕获），
  缺失时按 `canvas.graph_mouse` 与 `ds.scale/offset` 折算。
- `MouseEvent` 不可用的环境退化为携带坐标的普通对象。
- 能力缺失时条目置灰并说明原因，不做静默失败。

#### 5.4.1 为什么不做「起线拖拽态」（已实测否决，请勿重试）

**结论**：从节点菜单触发的原生拖拽**无法完成落点**，只能看到连线动画。
该方案已实测否决并从代码中移除。根因如下：

1. **原生落点依赖 pointerdown。** `CanvasPointer.up(e)` 首行即
   `if (e.button !== this.eDown?.button) return false`；`_completeClick(e)` 首行
   `const { eDown } = this; if (!eDown) return`。
   而 `eDown` **只在 `pointer.down(e)` 中赋值**，`pointer.down` 又只由画布的
   `processMouseDown` 调用（`LGraphCanvas.ts:2284`）。
   从菜单点击启动拖拽时从未发生 pointerdown → `eDown` 为空 → `onDragEnd` 永不触发
   → `linkConnector.dropLinks()` 永不被调用 → 连线建立不起来。
   （看到的"连线跟随鼠标"是 `linkConnector.isConnecting` 状态被绘制的结果，
   与落点逻辑无关。）

2. **合成指针序列也无法绕过。** `CanvasPointer.move(e)`：
   - `if (!eDown) return`
   - `if (!e.buttons) { this.reset(); return }`

   合成的 pointerdown 无法让用户"物理按住鼠标键"，用户随后的任何真实
   `pointermove`（`buttons === 0`）都会立即 `reset()`，把状态清空。
   即设计早期设想的"降级方案 2：合成 pointerdown → pointermove 序列"同样不成立。

3. **保留 `isConnecting` 还会引入异常。** 画布的输出槽 mousedown 分支
   （`LGraphCanvas.ts:2808-2820`）**没有 `isConnecting` 判断**，会无条件调用
   `linkConnector.dragNewFromOutput()`；而该方法在已连线状态下会
   `throw new Error('Already dragging links.')`。所以"保持待连线态、让用户点目标输出槽"
   这条替代路也会先抛异常。

**若要重新支持拖拽手感**，需要自行实现输出槽命中判定（核心的判定逻辑内联在
`processMouseDown` 中，未对外暴露），并按 `node.connect()` 建链，同时自行处理
类型校验与 Reroute 等分支 —— 属独立课题，需单独立项评估。

#### 5.4.2 能力不可用时的降级

| 情况 | 行为 |
|---|---|
| `canvas.showConnectionMenu` 缺失 | 该组条目全部**置灰**，文案说明"当前前端版本不支持从菜单连线，请手动拖线到该参数上" |
| 调用抛错 | 错误级提示，附带原因 |

> 原生替代：用户仍可手动把连线拖到参数槽上；ComfyUI 原生也支持双击 widget 输入槽自动挂载 Primitive 节点。

### 5.5 入参节点工厂（FR-4）

以核心 `onInputDblClick` 的实现为范本：

```js
const inputNode = window.LiteGraph.createNode("PrimitiveNode");
graph.add(inputNode);

// 复用核心的避让定位算法
let pos = [node.pos[0] - inputNode.size[0] - 30, node.pos[1]];
while (graph.getNodeOnPos(pos[0], pos[1], graph.nodes))
  pos[1] += window.LiteGraph.NODE_TITLE_HEIGHT;
inputNode.pos = pos;

// 连接：触发 PrimitiveNode 自动创建同规格 widget 并拷贝目标当前值
inputNode.connect(0, node, slotIndex);

inputNode.title = `入参·${param.name}`;
inputNode.addProperty("betterNode", { role: "paramInput", param: param.name, v: 1 });
```

要点：

- **必须先连接**：PrimitiveNode 的 widget 是**首次连接时惰性创建**的（`_onFirstConnection` → `_createWidget`）；连接前不存在 widget，无法读值或设置标题以外的属性。
- **取值语义**：创建时由 PrimitiveNode 自动拷贝目标 widget 的当前值，并立即通过 `applyToGraph` 回写目标——因值相同，**原值不被改变**（满足 DESIGN FR-4）。
- **下拉框**：连接后由 `refreshComboInNode` 从目标参数规格同步选项，无需自行填充。
- **序列化**：PrimitiveNode 为虚拟节点且 `serialize_widgets = true`；`properties.betterNode` 会随工作流序列化，用于重载后的复用索引与状态标识。
- **撤销/重做**：建节点与连线前后调用 `graph.beforeChange()` / `graph.afterChange()`。
- **FR-8 随机化能力：实测确认无需实现。**
  - 值控制控件（`fixed` / `increment` / `decrement` / `randomize`）由**控件构造器**自动添加，条件为：
    `inputSpec.control_after_generate` 为真，**或** `inputSpec.name` 属于 `['seed', 'noise_seed']`；
    默认模式 `randomize`。
  - `PrimitiveNode._createWidget` 中 `!inputData[1].control_after_generate` 的分支是**兜底**，
    仅在目标参数未声明时补一个控件，避免与构造器重复添加。
  - 因此数字型与下拉型入参节点**原生即具备**该控件，插件不写补齐代码，仅按 AC-15 验收。
  - 实测验证：前端 1.47.12，`入参·noise_seed` 节点上已正确出现「生成后控制」。

### 5.6 复用索引（FR-5）

**复用键**：参数名（`param.name`，大小写敏感），并叠加一层 `owner` 归属区分。

入参节点通过 `node.properties.betterNode` 自我描述（`properties` 会被序列化，见 §5.7）：

| 字段 | 含义 |
|---|---|
| `role` | 固定 `"paramInput"`，标识本插件创建 |
| `param` | 所属参数名，即复用键 |
| `owner` | 归属目标节点 id。**缺省 = 共享节点**；有值 = 专属于该目标的**专用节点** |

#### 两类节点与查找顺序

1. **专用节点**（`owner === 当前目标节点 id`）—— 命中即视为已完成，直接返回"已外置"。
2. **共享节点**（`owner` 缺省）—— 可跨目标复用：
   - 若已连到当前目标槽 → 返回"已外置"；
   - 否则尝试 `connect()` 走原生合并：
     - **成功** → 复用，并按 §6.6 检测取值是否被钳制；
     - **失败（合并被拒）** → 落到第 3 步。
3. **新建**：
   - 若第 2 步不存在共享节点（首次外置该参数）→ 建**共享节点**（`owner` 缺省）；
   - 若共享节点存在却连不上（类型或取值范围不兼容）→ 建**专用节点**（`owner = 目标节点 id`），
     并给出提示级说明（§6.6）。

#### 为什么要区分专用节点

早期设计只有一句"不兼容时新建节点"，未考虑重复点击：复用查找总先命中那个不兼容的共享节点，
导致每次点击都"失败一次、新建一个"，节点数无限膨胀。

引入 `owner` 后，专用节点在下一轮查找中**优先命中**，行为收敛为幂等：
首次点击新建专用节点，后续点击直接命中，既不膨胀也不重复告警。
（该路径已由 `tests/run.mjs` 的"专用节点建立后重复点击保持稳定"用例覆盖。）

#### 状态查询

`getExternalizeStatus(graph, paramName, targetNode, slotIndex)` 供 FR-6 使用，
返回 `externalized` / `reusable` / `null`，规则与上述查找顺序一致。

### 5.7 序列化与重载

| 对象 | 序列化内容 | 重载需处理 |
|---|---|---|
| 入参节点 | 标准节点字段 + `widgets_values` + `properties.betterNode` | 无需特殊处理；PrimitiveNode 自带 `onAfterGraphConfigured` 恢复流程 |
| 参数槽连接 | 标准 link 数据 | 无需特殊处理 |
| 状态标识（FR-6） | 不落盘，实时从画布推导 | 每次打开菜单时重新计算 |

### 5.8 支持范围判定器（`web/params/guards.js`）

集中回答"这个节点 / 这个参数能不能操作、不能的话为什么"，供菜单构建与置灰使用。

```js
function assessNode(node) {
  if (node.isVirtualNode) return deny('virtual');          // Note / Reroute / PrimitiveNode 等
  if (isSubgraphNode(node)) return deny('subgraph');       // 伪 widget，规格解析路径不同
  if (!node.inputs?.length) return deny('noInputs');
  return allow();
}

function assessParam(node, param) {
  if (param.input?.locked) return deny('locked');           // 槽被锁定
  if (!param.input) return deny('noSocket');                // socketless / 运行时无输入槽
  if (param.kind === 'widget' && isExoticWidget(param.widget)) return deny('exoticWidget');
  return allow();
}
```

- `isExoticWidget` 判据：widget 类型不在标准集合内（`number` / `combo` / `toggle` / `string` / `text` 为可用；`curve` / `imagecrop` / `colors` / `asset` 等判为 v1 不支持）。
- 每个 `deny` 附带**文案键**，由 i18n 层翻译成中英文说明（FR-7 阻断级）。
- `node.mode` 为 Bypass / Mute 时**不拒绝**，而是返回一个附加状态标记，供菜单标注。

### 5.9 文案与国际化（`web/i18n/`）

**关键约束：前端未对外暴露 i18n 接口**（`window.comfyAPI` 的 12 个模块中不含 i18n，`scripts/` 下亦无导出），因此插件必须自带字典。

- 语言判定：读取前端语言设置（设置项标识含 `Comfy.Locale`，在 GraphView / i18n / api 三个 chunk 中均有引用），通过 `app.ui.settings` 获取；读不到时回退到 `navigator.language`。
- 字典结构：扁平键值（如 `deny.noSocket`、`tip.valueClamped`、`action.generateInputNode`），中英各一份，键集合一致。
- 覆盖范围：菜单项文案、置灰原因、提示级说明、阻断级说明（对应 FR-7 三层）。
- 缺失键处理：回退到英文并在控制台告警，避免出现空文案。
- 文案中**不使用 HTML**：菜单顶级条目直接取 `content` 原文展示，`convertContextMenuToOptions` 仅在子菜单路径做去标签处理。

---

## 6. 一对多赋值的实现细节（FR-5）

复用 PrimitiveNode 的原生行为，**不自研同步逻辑**：

1. **首次连接**：`_onFirstConnection` → `_createWidget`，从目标参数规格建 widget，并取目标当前值。
2. **追加连接**：`onConnectOutput` 回调中调用 `applyToGraph([{ target_id, target_slot }])`，把当前值写入新目标的 widget。
3. **值变更**：widget 的 `callback` 被 `useChainCallback` 链上 `applyToGraph()`，向全部已连接目标回写。
4. **规格合并**：`_mergeWidgetConfig` + `mergeIfValid` 在数值型参数间合并配置；合并结果中 `min`/`max` 取更严格者，并在 `mergeIfValid` 内对恢复后的 widget 值做越界钳制。
5. **下拉框**：选项取自 `outputs[0].widget[GET_CONFIG]()`，即**首个连接**目标的参数规格。多目标为同类型节点时选项天然一致；跨节点类型混连时以首个为准——**需在文档中向用户说明该边界**。
6. **合并的合法校验与提示（FR-7 提示级）**：合并前由 `mergeInputSpec` 判定；插件在**连接动作前后**读取判定结果并向用户说明：
   - 判定为不可合并（类型不同、数值范围无交集、combo 选项无交集、其余选项键不一致）→ 不合并，改为**新建专用入参节点**（`owner = 目标节点 id`，见 §5.6），并提示原因。
   - 判定为可合并但原值被钳制（`mergeIfValid` 内的 min/max 钳制）→ 允许合并，并提示"取值范围已收敛，值已调整"。
   - **判定方式**：不复制 `mergeInputSpec` 逻辑（避免与核心规则分叉），而是观察连接结果——
     - 合并被拒 ⇔ `connect()` 返回空（`node.connect()` 返回 `LLink | null`）；
     - 值被钳制 ⇔ 连接前后目标 widget 的 `value` 发生变化，变化前后的值直接用于提示文案。

> 结论：Design FR-5「同一入参节点同时给多个同类型节点赋值」由内置节点原生满足，插件只需负责"复用而非重复创建"。

---

## 7. 兼容性与降级策略

### 7.1 启动期能力探测（`web/compat/capability.js`）

| 探测项 | 探测方式 | 缺失时行为 |
|---|---|---|
| 前端版本 | 读取前端暴露的版本信息 | 非 1.47.x 时提示"未验证版本"，功能仍尝试启用 |
| 菜单扩展点 | `LGraphNode.prototype.getExtraMenuOptions` 是否存在 | 缺失 → 整体禁用，控制台说明原因 |
| 入参节点 | `window.LiteGraph.registered_node_types.PrimitiveNode` | 缺失 → 禁用 FR-4/FR-5，FR-3 仍可用 |
| 来源菜单 | `typeof canvas.showConnectionMenu === 'function'` | 缺失 → FR-3 整组置灰并说明 |
| 值控制控件 | `window.comfyAPI?.widgets?.addValueControlWidgets` | 缺失 → FR-8 跳过补齐，仅沿用原生能力并提示 |
| 语言设置 | `app.ui.settings` 可读 | 缺失 → 回退 `navigator.language`，再缺失则用中文 |
| 提示通道 | `app.extensionManager.toast.add` → `app.ui.dialog.show` → `console` 逐级降级（`web/ui/notify.js`） | 均不可用时仅写控制台。**真实可用通道需实测确认**，首次调用会打印 `[BetterNode] 提示通道：xxx` |

### 7.2 降级显示

功能不可用时，对应菜单条目**置灰（`disabled: true`）**，并在条目文案或提示中说明原因，不做静默失效。

---

## 8. 风险与缓解

| 级别 | 风险 | 缓解 |
|---|---|---|
| ~~P0~~ 已否决 | ~~从菜单启动的起线缺少指针生命周期钩子，可能无法落点~~ | **2026-09-17 实测确认无法落点，方案已整体移除**（§5.4.1） |
| ~~P0~~ 已解决 | ~~FR-8 依赖原生值控制控件的添加条件，该条件语义反直觉~~ | **2026-09-17 实测已确认**：控件由构造器自动添加，原生完整覆盖，插件无需实现 |
| P1 | `showConnectionMenu` 为非契约方法，版本升级可能失效 | 收敛到 `compat` 层，集中访问 + 探测 + 置灰降级 |
| P1 | 依赖 `PrimitiveNode` 的内部行为（惰性 widget、合并规则） | 只依赖其对外可观测行为，不自研同步；升级时以 AC 回归验证 |
| P1 | 插件间 `getExtraMenuOptions` 冲突 | 强制链式包装（`chain(prev, next)`），绝不直接赋值；加入共存回归用例 |
| P1 | 前端未暴露 i18n，双语字典需自行维护，易出现缺键 | 字典集中管理 + 缺键回退并告警 + 字典键一致性用例覆盖 |
| P2 | 子菜单无法分组，长参数列表可读性差 | 文案前缀 + 按节点定义顺序排列；必要时后续改用动态子菜单 |
| P2 | 菜单项位于「Extensions」分组 | 接受，作为既定交互 |
| P2 | 跨节点类型合并参数时下拉选项以首个连接为准 | 在文档与提示中说明；必要时限制为同节点类型内复用 |
| P2 | 合并被拒路径在核心节点中难以触发，未经真实验证 | 逻辑已由单元测试覆盖；待自然遇到或后续补调试入口 |
| P2 | `socketless` / 自定义 widget / 子图节点无法外置 | 置灰并说明原因（FR-7 阻断级），不做静默隐藏 |

---

## 9. 测试方案

### 9.1 用例矩阵

| 编号 | 场景 | 覆盖需求 | 预期 |
|---|---|---|---|
| T-01 | KSampler 右键，检查菜单与参数清单 | FR-1、FR-2、AC-1、AC-2 | 两组齐全，无 `control_after_generate` |
| T-02 | 点击 `model` → 来源菜单选 CheckpointLoader | FR-3、AC-3 | 连线成功 |
| T-03 | 点击 `seed`，检查入参节点取值 | FR-4、AC-4 | 值等于原 seed |
| T-04 | 点击 `sampler_name`，比对各选项 | FR-4、AC-5 | 选项完全一致 |
| T-05 | 一个入参节点连 3 个 KSampler 的 `seed`，改值后运行 | FR-5、AC-6 | 三者同步且生效 |
| T-06 | 点击第二个 KSampler 的 `seed` | FR-5、AC-7 | 复用既有入参节点 |
| T-07 | 撤销 / 重做 | §6.4、AC-8 | 状态正确回滚 |
| T-08 | 保存 → 重载 | §5.7、AC-9 | 节点、连线、取值恢复 |
| T-09 | 来源菜单中取消 | FR-3 | 无副作用，画布状态正常 |
| T-10 | KSamplerAdvanced 的 advanced 参数 | FR-2 | 正常列出 |
| T-11 | 无输入参数的节点 | FR-1 | 条目不注入 |
| T-12 | 断线 / 删除入参节点后重开菜单 | FR-6 | 状态标识回到"未外置" |
| T-13 | 原生文件比对 | AC-10 | 无任何原生文件改动 |
| T-14 | 来源菜单能力缺失（屏蔽 `showConnectionMenu`） | FR-3、§5.4.2 | 该组条目置灰并说明 |
| T-15 | 来源菜单在空白区域的 Add Node / Search 分支 | FR-3 | 正常 |
| T-16 | `socketless` 参数 / 子图节点 / 自定义 widget | FR-7、§6.1、AC-12 | 置灰且原因文案正确 |
| T-17 | 制造合并钳制（范围不同的两个节点同名参数） | FR-7、AC-13 | 出现原因提示，非静默 |
| T-18 | 合并被拒（INT 与 FLOAT / 范围无交集） | FR-7 | 改为新建节点并提示 |
| T-19 | 切换前端语言为中 / 英，逐项检查文案 | FR-7、AC-14 | 两套文案完整 |
| T-20 | `steps` 与 `seed` 的入参节点随机化能力 | FR-8、AC-15 | 均具备，且不重复添加 |
| T-21 | 多选 2 个以上节点右键 | FR-1、AC-16 | 「输入参数」不出现 |
| T-22 | 节点置为 Bypass 后打开菜单 | FR-7、AC-17 | 条目带状态提示 |
| T-23 | 第三方插件节点（标准 INPUT_TYPES） | §6.1 | 参数正常列出 |
| T-24 | 与另一挂载 `getExtraMenuOptions` 的扩展共存 | §8 P1 | 双方条目均正常，无覆盖 |

### 9.2 回归点（前端升级时必测）

T-01、T-02、T-03、T-05、T-08、T-14、T-20。

### 9.3 手工验证清单

- 控制台无新增报错 / 警告（特别注意扩展触发的 deprecated 提示）。
- 与第三方扩展共存：同节点上另有一个扩展也挂了 `getExtraMenuOptions`，双方条目均正常。

### 9.4 自动化回归（`tests/run.mjs`）

不启动 ComfyUI 即可运行的核心逻辑测试：

```
node tests/run.mjs
```

- **原理**：插件内部使用 `../../scripts/app.js` 这类相对路径导入前端模块。测试脚本在系统临时目录中还原出与浏览器一致的结构（`<sandbox>/scripts/app.js` + `<sandbox>/extensions/ComfyUI-BetterNode/`），因此**相对路径深度与真实运行时完全相同**，可顺带验证导入路径是否正确。
- **已覆盖**：菜单结构与参数分类（FR-1/FR-2）、入参节点创建（FR-4）、复用与一对多（FR-5）、
  参数状态标识（FR-6）、校验与提示级告警（FR-7）、来源菜单调用与能力缺失降级（FR-3/§5.4.2）、
  置灰判定（FR-7 阻断级 / §6.1）、中英双语文案与字典键一致性（§5.9）、
  链式挂载与其他扩展共存及异常隔离（§5.1）。当前 **29 项断言**。
- **不覆盖**：真实画布渲染、原生 `PrimitiveNode` 的取值拷贝与下拉选项同步、
  来源菜单的真实弹出与定位、`extensionManager.toast` 的真实可用性——
  这些仍需在 ComfyUI 中按 §9.1 手工验证。

---

## 10. 未决问题（Open Questions）

**已决**

1. ~~自定义 widget 类型~~ → 已定为**置灰并说明**（`assessParam` 走 `canRecreateWidget`，与 PrimitiveNode 同一判据）。
2. ~~子图节点适配~~ → 已定为 v1 不支持，**列出但全部置灰并说明原因**。
3. ~~入参节点标题格式~~ → 已定为 `入参·<参数名>`；标题属数据而非 UI 文案，**不纳入 i18n**。
4. ~~英文文案的参数名~~ → 参数名一律沿用前端提供的 `widget.label`（核心 i18n 已在英文环境给出英文名），插件不另行翻译。

**仍开放**

1. 是否将语义等价的参数（如 `seed` 与 `noise_seed`）纳入同一复用键？现方案按参数名严格匹配。
2. 「合并被拒」提示在核心节点中难以构造复现场景，**尚未真实验证**（逻辑已有单元测试覆盖）。
   若后续需要，可加一个仅控制台可用的调试入口来强制触发。
3. 是否需要"一键外置该节点全部内部参数"的批量入口。
4. 一个参数出现"共享节点 + 多个专用节点"时，菜单是否应展示更细的复用明细。
5. 是否重新立项评估"拖拽式连线"（需自行实现输出槽命中判定，见 §5.4.1）。

---

## 11. 附录：源码依据索引

前端包路径：`python/Lib/site-packages/comfyui_frontend_package/static/assets/*.js.map`（`sourcesContent` 内含原始源码）。

| 源文件 | 关键内容 |
|---|---|
| `src/lib/litegraph/src/LGraphCanvas.ts` | `:838` 指针对象创建；`:854-926` `dropped-on-canvas` 与来源菜单触发；`:2113` `_linkConnectorDrop`；`:2284` `pointer.down`（`eDown` 的唯一来源）；`:2808-2820` 输出槽 mousedown 分支（无 `isConnecting` 判断）；`:2865-2874` 输入槽拖拽分支；`:3303` `pointer.move`；`:3851` `pointer.up`；`:3870+` 抬起处理；`:6946` `showConnectionMenu`；`:8553` 画布菜单聚合；`:8646` `node.getExtraMenuOptions` 调用；`:8751` 节点菜单入口 |
| `src/lib/litegraph/src/CanvasPointer.ts` | `:188` `down()` 赋 `eDown`；`:199` `move()`（`!e.buttons` 即复位）；`:232` `up()`；`:241` `_completeClick()`（`!eDown` 直接返回）。**§5.4.1 根因所在** |
| `src/lib/litegraph/src/linkConnector.ts` | `:412` `dragNewFromInput`；`moveInputLink`、`dragNewFromOutput`、`dropLinks`、`reset` |
| `src/lib/litegraph/src/contextMenuCompat.ts` | 旧式 monkey-patch 兼容层与废弃告警 |
| `src/extensions/core/widgetInputs.ts` | `:31` `PrimitiveNode` 定义（含 `_createWidget` 中值控制控件的添加条件）；`:509` `mergeIfValid`；`:519` `convertWidgetToInput` 废弃；`:564` `onInputDblClick` 范本 |
| `src/scripts/widgets.ts` | `:113` `addValueControlWidgets`（值控制控件构造） |
| `src/scripts/valueControl.ts` | `nextValueForLinkedTarget` / `computeNextControlledValue`（随机化等模式的实际计算） |
| `src/scripts/controlWidgetMarker.ts` | `IS_CONTROL_WIDGET` 标记 |
| `src/utils/nodeDefUtil.ts` | `:120` `mergeInputSpec`（类型 / 范围 / 选项合并规则与 `IGNORE_KEYS`） |
| `src/services/litegraphService.ts` | `addInputSocket` / `addInputWidget`（输入槽与 widget 共存）；`addNodeContextMenuHandler`；`getExtraOptionsForWidget` |
| `src/composables/graph/contextMenuConverter.ts` | `:428` 子菜单转换；分隔符丢弃；`buildStructuredMenu` 分组规则 |
| `src/composables/graph/useMoreOptionsMenu.ts` | `:180` 仅单选时聚合节点菜单 |
| `src/stores/nodeDefStore.ts` | `_migrateDefaultInput`（required 输入槽恒存在）；`getInputSpecForWidget` |
| `src/renderer/utils/nodeTypeGuards.ts` | `isPrimitiveNode` |
| `static/scripts/*.js` | `window.comfyAPI` 转发层，可确认对外暴露模块清单（**无 i18n**） |
| `ComfyUI/nodes.py:1580` | KSampler 输入定义（`:1586` seed 声明 `control_after_generate`） |
