# TECHNICAL.md — BetterNode 技术方案

| 项 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 状态 | 待审阅 |
| 关联文档 | `DESIGN.md`（产品设计）、`AGENTS.md`（开发约束） |
| 变更记录 | v1.1 新增 FR-3 双入口、FR-7 校验与中英引导、FR-8 随机化能力、v1 支持范围；补 §5.8 guards、§5.9 i18n |

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
│   │   ├── buildMenu.js     # 构建「输入参数」二级菜单条目
│   │   └── labels.js        # 文案键（对接 i18n）
│   ├── params/
│   │   ├── enumerate.js     # 参数枚举、分类、当前值/选项读取
│   │   └── guards.js        # 支持范围判定（节点/参数可用性 + 置灰原因）
│   ├── actions/
│   │   ├── startLinkDrag.js # FR-3a 起线拖拽态
│   │   ├── showSourceMenu.js# FR-3b 选择来源节点
│   │   └── createInputNode.js # FR-4/FR-5/FR-8 入参节点工厂、复用索引、随机化补齐
│   ├── i18n/
│   │   ├── index.js         # 语言判定（读前端语言设置）+ 文案查表
│   │   ├── zh.js            # 中文文案
│   │   └── en.js            # 英文文案
│   └── compat/
│       └── capability.js    # 能力探测与降级
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
| 4 | 起线 | `src/lib/litegraph/src/linkConnector.ts:412` `dragNewFromInput(network, node, input, fromReroute?)`；鼠标按下输入槽时调用位置 `LGraphCanvas.ts:2871`，**紧随其后必须调用 `this._linkConnectorDrop()`**（`LGraphCanvas.ts:2874`） | FR-3 |
| 5 | 入参节点 | `src/extensions/core/widgetInputs.ts:31` `class PrimitiveNode`（`isVirtualNode = true`、`serialize_widgets = true`）；注册于同文件 `registerCustomNodes()` | FR-4 / FR-5 |
| 5a | 自动取值 | `PrimitiveNode._createWidget`：`widget.value = theirWidget.value` | FR-4 值为当前值 |
| 5b | 下拉选项同步 | `PrimitiveNode.refreshComboInNode`：从 `outputs[0].widget[GET_CONFIG]()[0]` 取选项 | FR-4 下拉框 |
| 5c | 一对多 | `PrimitiveNode.onConnectOutput` / `_mergeWidgetConfig` / 模块内 `mergeIfValid` | FR-5 |
| 5d | 原生同款行为 | 同文件 `onInputDblClick`：双击 widget 输入槽自动创建 PrimitiveNode（`graph.add` → 避让定位 → `node.connect(0, this, slot)` → `title = input.name`） | FR-4 实现范本 |
| 6 | 菜单后处理限制 | `contextMenuConverter.convertSubmenuToOptions` 丢弃 `null` 分隔符；`buildStructuredMenu` 将非核心项归入「Extensions」分组 | FR-2 分组文案化 |
| 7 | 全局引用 | `window.LiteGraph` 在前端包中已挂载；`app` 由 `scripts/app.js` 导出 | 插件取用方式 |
| 8 | **来源选择菜单** | `LGraphCanvas.showConnectionMenu({ nodeTo, slotTo, e })`（`LGraphCanvas.ts:6946`，公开方法）。原生"连线落点在空白处"即调用它（`LGraphCanvas.ts:870-926` `dropped-on-canvas`，受 `LiteGraph.release_link_on_empty_shows_menu` 控制） | **FR-3b**，不依赖指针拖拽生命周期 |
| 9 | **全局模块表** | `window.comfyAPI` 暴露 12 个模块：`api / app / changeTracker / controlWidgetMarker / defaultGraph / domWidget / pnginfo / promotedWidgetControl / ui / utils / valueControl / widgets`（`scripts/*.js` 均为转发层）。**其中无 i18n** | 取用官方实现；明确 i18n 需自建 |
| 10 | **值控制控件** | `window.comfyAPI.widgets.addValueControlWidgets`（实现于 `src/scripts/widgets.ts:113`）：combo 控件，选项 `fixed/increment/decrement/randomize`（combo 目标额外 `increment-wrap`），`serialize:false` + `canvasOnly:true`，以 `IS_CONTROL_WIDGET` 标记并挂到宿主 `linkedWidgets`；队列时由 `src/scripts/valueControl.ts` `nextValueForLinkedTarget` 计算新值；生效时机受设置 `Comfy.WidgetControlMode` 控制 | **FR-8** 随机化补齐 |
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

### 5.4 FR-3 双入口实现

#### 5.4.1 FR-3a 起线拖拽态（主入口，P0 待验证）

```js
canvas.linkConnector.dragNewFromInput(canvas.graph, node, input);
canvas._linkConnectorDrop();   // 注册 pointer.onDragEnd / pointer.finally
canvas.dirty_bgcanvas = true;
```

- `_linkConnectorDrop()` 是 TS `private`，但运行时可用；其作用是注册 `pointer.onDragEnd = dropLinks` 与 `pointer.finally = reset`，并启动自动平移（`LGraphCanvas.ts:2113-2140`）。**缺此步会导致拖拽无法结束**。
- `canvas.pointer` 在画布构造时创建一次（`LGraphCanvas.ts:838`），为长生命周期对象，这是本方案可行的前提。
- 调用前须检查 `linkConnector.isConnecting`，为真时提示用户并中止（`dragNewFromInput` 在已连线时会 throw）。
- **粘性拖拽语义**：由菜单触发时鼠标左键并未按下，连线跟随鼠标移动直到下一次点击落点。该手感与"按住拖拽"不同，须在文案中提示。

#### 5.4.2 FR-3b 选择来源节点（备选入口，等效）

```js
canvas.showConnectionMenu({ nodeTo: node, slotTo: input, e: mouseEvent });
```

- 直接复用官方公开方法，产出原生「Add Node / Add Reroute / Search」来源菜单，**不依赖指针拖拽生命周期**。
- 需要构造一个 `MouseEvent`（用于菜单定位）；可用菜单项点击事件对象或 `canvas.graph_mouse` 折算后的合成事件。
- 若 `dragNewFromInput` 不可用（能力探测失败），自动改用本入口。

#### 5.4.3 降级链

| 顺序 | 手段 | 触发条件 |
|---|---|---|
| 1 | FR-3a `dragNewFromInput` + `_linkConnectorDrop()` | 能力探测通过 |
| 2 | FR-3a 变体：合成 `pointerdown → pointermove` 事件序列走原生路径 | 方案 1 落点失败 |
| 3 | FR-3b `showConnectionMenu`（始终可用，作为兜底） | 方案 1、2 均不可用 |
| 4 | 菜单项置灰 + 说明原因 | 全部不可用 |

> **P0 验证点**：编码前先用最小脚本验证方案 1 能否完成"起线 → 命中输出槽 → 落点成链 → 取消也可复位"完整闭环，并确认方案 3 独立可用。验证结论同步回写本节与 `DESIGN.md`。

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
- **FR-8 随机化补齐**：连接完成后检查入参节点是否已具备值控制控件（判定：`widgets` 中存在带 `IS_CONTROL_WIDGET` 标记、且 `linkedWidgets` 指向主 widget 的 combo）。若缺失，调用 `window.comfyAPI.widgets.addValueControlWidgets(node, mainWidget, 'fixed', undefined, inputSpec)` 补齐，并设置 `mainWidget.linkedWidgets = [controlWidget]`。
  - ⚠️ 原生行为存在语义反直觉之处：PrimitiveNode 添加该控件的条件是 `!inputData[1].control_after_generate`，因此声明了 `control_after_generate` 的参数（如 KSampler 的 `seed`）**不自带**，未声明的（如 `steps`）反而自带。**该行为须在 P0 阶段实测确认**，补齐逻辑对两种情况都必须幂等（已有则不重复添加）。
  - 补齐时 `defaultValue` 传 `'fixed'`，避免改变现有取值行为。

### 5.6 复用索引（FR-5）

- **复用键**：参数名（`param.name`，大小写敏感）。
- **查找方式**：遍历 `graph.nodes`，筛选满足以下条件的节点：
  1. `node.properties?.betterNode?.role === "paramInput"`（本插件创建）
  2. `node.properties.betterNode.param === param.name`
  3. 参数规格兼容（类型一致；数值型按 §6 合并规则可收敛）
- **命中后行为**：不新建，直接把该入参节点的输出连到当前目标参数槽。
  - 若该节点已连到当前目标，则提示"已外置"并前置/高亮该节点。
- **未命中**：走 §5.5 新建。
- **兼容性判断失败**（如 `FLOAT` 与 `INT`、取值范围不相交）：按 DESIGN FR-5 建新节点，避免污染既有目标。

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
   - 判定为不可合并（类型不同、数值范围无交集、combo 选项无交集、其余选项键不一致）→ 不合并，改为**新建独立入参节点**，并提示原因。
   - 判定为可合并但原值被钳制（`mergeIfValid` 内的 min/max 钳制）→ 允许合并，并提示"取值范围已收敛，值已调整"。
   - 实现方式：不复制 `mergeInputSpec` 逻辑，而是**复用** `PrimitiveNode` 连接的返回值/前后值对比来判断；避免与核心规则产生分叉。

> 结论：Design FR-5「同一入参节点同时给多个同类型节点赋值」由内置节点原生满足，插件只需负责"复用而非重复创建"。

---

## 7. 兼容性与降级策略

### 7.1 启动期能力探测（`web/compat/capability.js`）

| 探测项 | 探测方式 | 缺失时行为 |
|---|---|---|
| 前端版本 | 读取前端暴露的版本信息 | 非 1.47.x 时提示"未验证版本"，功能仍尝试启用 |
| 菜单扩展点 | `LGraphNode.prototype.getExtraMenuOptions` 是否存在 | 缺失 → 整体禁用，控制台说明原因 |
| 入参节点 | `window.LiteGraph.registered_node_types.PrimitiveNode` | 缺失 → 禁用 FR-4/FR-5/FR-8，FR-3 仍可用 |
| 起线能力 | `canvas.linkConnector?.dragNewFromInput` 是否为函数 | 缺失 → FR-3a 降级为 FR-3b |
| 指针钩子 | `canvas.pointer` 与 `canvas._linkConnectorDrop` 是否存在 | 缺失 → FR-3a 降级为方案 2/3（§5.4.3），FR-3b 始终可用 |
| 来源菜单 | `typeof canvas.showConnectionMenu === 'function'` | 缺失 → FR-3 整项置灰 |
| 值控制控件 | `window.comfyAPI?.widgets?.addValueControlWidgets` | 缺失 → FR-8 跳过补齐，仅沿用原生能力并提示 |
| 语言设置 | `app.ui.settings` 可读 | 缺失 → 回退 `navigator.language`，再缺失则用中文 |

### 7.2 降级显示

功能不可用时，对应菜单条目**置灰（`disabled: true`）**，并在条目文案或提示中说明原因，不做静默失效。

---

## 8. 风险与缓解

| 级别 | 风险 | 缓解 |
|---|---|---|
| P0 | 从菜单启动的起线缺少指针生命周期钩子，可能无法落点 | 编码前最小验证；四级降级链（§5.4.3），FR-3b 兜底 |
| P0 | FR-8 依赖原生值控制控件的添加条件，该条件语义反直觉 | P0 阶段一并实测 `seed` 与 `steps` 两种情况；补齐逻辑幂等，两种结果下都正确 |
| P1 | `_linkConnectorDrop` / `linkConnector` / `showConnectionMenu` 为内部或非契约方法，版本升级易失效 | 收敛到 `compat` 层，集中访问 + 探测 + 降级 |
| P1 | 依赖 `PrimitiveNode` 的内部行为（惰性 widget、合并规则） | 只依赖其对外可观测行为，不自研同步；升级时以 AC 回归验证 |
| P1 | 插件间 `getExtraMenuOptions` 冲突 | 强制链式包装（`chain(prev, next)`），绝不直接赋值；加入共存回归用例 |
| P1 | 前端未暴露 i18n，双语字典需自行维护，易出现缺键 | 字典集中管理 + 缺键回退并告警 + AC-14 覆盖全部文案 |
| P2 | 子菜单无法分组，长参数列表可读性差 | 文案前缀 + 按节点定义顺序排列；必要时后续改用动态子菜单 |
| P2 | 菜单项位于「Extensions」分组 | 接受，作为既定交互 |
| P2 | 跨节点类型合并参数时下拉选项以首个连接为准 | 在文档与提示中说明；必要时限制为同节点类型内复用 |
| P2 | 粘性拖拽手感与预期不符 | 文案提示 + FR-3b 作为等效替代 |
| P2 | `socketless` / 自定义 widget / 子图节点无法外置 | 置灰并说明原因（FR-7 阻断级），不做静默隐藏 |

---

## 9. 测试方案

### 9.1 用例矩阵

| 编号 | 场景 | 覆盖需求 | 预期 |
|---|---|---|---|
| T-01 | KSampler 右键，检查菜单与参数清单 | FR-1、FR-2、AC-1、AC-2 | 两组齐全，无 `control_after_generate` |
| T-02 | 点击 `model` 起线并连到 CheckpointLoader | FR-3、AC-3 | 连线成功 |
| T-03 | 点击 `seed`，检查入参节点取值 | FR-4、AC-4 | 值等于原 seed |
| T-04 | 点击 `sampler_name`，比对各选项 | FR-4、AC-5 | 选项完全一致 |
| T-05 | 一个入参节点连 3 个 KSampler 的 `seed`，改值后运行 | FR-5、AC-6 | 三者同步且生效 |
| T-06 | 点击第二个 KSampler 的 `seed` | FR-5、AC-7 | 复用既有入参节点 |
| T-07 | 撤销 / 重做 | §6.4、AC-8 | 状态正确回滚 |
| T-08 | 保存 → 重载 | §5.7、AC-9 | 节点、连线、取值恢复 |
| T-09 | 起线过程中再次点击菜单项 | §5.2 异常分支 | 提示且不产生半途状态 |
| T-10 | KSamplerAdvanced 的 advanced 参数 | FR-2 | 正常列出 |
| T-11 | 无输入参数的节点 | FR-1 | 条目置灰 |
| T-12 | 断线 / 删除入参节点后重开菜单 | FR-6 | 状态标识回到"未外置" |
| T-13 | 原生文件比对 | AC-10 | 无任何原生文件改动 |
| T-14 | 仅用 FR-3b 来源菜单完成连线（屏蔽 FR-3a） | FR-3b、AC-11 | 独立可用 |
| T-15 | 起线后落点在空白处 | FR-3a | 弹出原生来源菜单 |
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
- **已覆盖**：菜单结构与参数分类（FR-1/FR-2）、入参节点创建（FR-4）、复用与一对多（FR-5）、置灰判定（FR-7/§6.1）、链式挂载与其他扩展共存及异常隔离（§5.1）。当前 16 项断言。
- **不覆盖**：真实画布渲染、原生 `PrimitiveNode` 的取值拷贝与下拉选项同步、指针/拖拽行为——这些仍需在 ComfyUI 中按 §9.1 手工验证。

---

## 10. 未决问题（Open Questions）

1. 是否将语义等价的参数（如 `seed` 与 `noise_seed`）纳入同一复用键？现方案按参数名严格匹配。
2. 入参节点标题最终格式（当前拟为 `入参·seed`）。注意：节点标题属**数据**而非 UI 文案，是否纳入 i18n 需定。
3. 已连线的内部参数槽被点击时，是替换现有连线还是拒绝操作。
4. 自定义 widget 类型（curve / imagecrop 等）在后续里程碑是否支持；若支持，入参节点用何种控件承载。
5. 是否需要"一键外置该节点全部内部参数"的批量入口。
6. 子图节点（SubgraphNode）的伪 widget 规格解析是否值得适配（`getInputSpecForWidget` 已有专门分支可参考）。
7. 英文文案的术语口径：参数名保留英文原名（`seed` / `steps`）还是提供英文别名。

---

## 11. 附录：源码依据索引

前端包路径：`python/Lib/site-packages/comfyui_frontend_package/static/assets/*.js.map`（`sourcesContent` 内含原始源码）。

| 源文件 | 关键内容 |
|---|---|
| `src/lib/litegraph/src/LGraphCanvas.ts` | `:838` 指针对象创建；`:854-926` `dropped-on-canvas` 与来源菜单触发；`:2113` `_linkConnectorDrop`；`:2865-2874` 输入槽拖拽分支；`:6946` `showConnectionMenu`；`:8553` 画布菜单聚合；`:8646` `node.getExtraMenuOptions` 调用；`:8751` 节点菜单入口 |
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
