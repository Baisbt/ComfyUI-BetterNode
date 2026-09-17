# TECHNICAL.md — BetterNode 技术方案

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 状态 | 待审阅 |
| 关联文档 | `DESIGN.md`（产品设计）、`AGENTS.md`（开发约束） |

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
│   │   └── labels.js        # 文案（中文）与状态前缀
│   ├── params/
│   │   └── enumerate.js     # 参数枚举、分类、当前值/选项读取
│   ├── actions/
│   │   ├── startLinkDrag.js # FR-3 起线
│   │   └── createInputNode.js # FR-4/FR-5 入参节点工厂与复用索引
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

### 5.4 起线动作（FR-3，P0 待验证）

**首选方案 A**

```js
canvas.linkConnector.dragNewFromInput(canvas.graph, node, input);
canvas._linkConnectorDrop();   // 注册 pointer.onDragEnd / pointer.finally
canvas.dirty_bgcanvas = true;
```

- `_linkConnectorDrop()` 是 TS `private`，但运行时可用；其作用是注册 `pointer.onDragEnd = dropLinks` 与 `pointer.finally = reset`，并启动自动平移（`LGraphCanvas.ts:2113-2140`）。**缺此步会导致拖拽无法结束**（该风险已在源码阅读中发现）。
- `canvas.pointer` 在画布构造时创建一次（`LGraphCanvas.ts:838`），为长生命周期对象，这是方案 A 可行的前提。
- 调用前须检查 `linkConnector.isConnecting`，为真时提示用户并中止（避免抛错）。

**降级方案 B**：若方案 A 在实测中无法完成落点，则在画布上合成 `pointerdown → pointermove` 事件序列，让画布走原生 `processMouseDown` 路径。

**降级方案 C（最保守）**：菜单点击后打开节点搜索框，用户选定来源节点后由插件调用 `node.connect(...)` 自动建链。

> **P0 验证点**：编码前先用最小脚本验证方案 A 能否完成"起线 → 命中输出槽 → 落点成链 → 取消也可复位"完整闭环。验证不通过则降级，并同步更新本文档与 `DESIGN.md`。

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

---

## 6. 一对多赋值的实现细节（FR-5）

复用 PrimitiveNode 的原生行为，**不自研同步逻辑**：

1. **首次连接**：`_onFirstConnection` → `_createWidget`，从目标参数规格建 widget，并取目标当前值。
2. **追加连接**：`onConnectOutput` 回调中调用 `applyToGraph([{ target_id, target_slot }])`，把当前值写入新目标的 widget。
3. **值变更**：widget 的 `callback` 被 `useChainCallback` 链上 `applyToGraph()`，向全部已连接目标回写。
4. **规格合并**：`_mergeWidgetConfig` + `mergeIfValid` 在数值型参数间合并配置；合并结果中 `min`/`max` 取更严格者，并在 `mergeIfValid` 内对恢复后的 widget 值做越界钳制。
5. **下拉框**：选项取自 `outputs[0].widget[GET_CONFIG]()`，即**首个连接**目标的参数规格。多目标为同类型节点时选项天然一致；跨节点类型混连时以首个为准——**需在文档中向用户说明该边界**。

> 结论：Design FR-5「同一入参节点同时给多个同类型节点赋值」由内置节点原生满足，插件只需负责"复用而非重复创建"。

---

## 7. 兼容性与降级策略

### 7.1 启动期能力探测（`web/compat/capability.js`）

| 探测项 | 探测方式 | 缺失时行为 |
|---|---|---|
| 前端版本 | 读取前端暴露的版本信息 | 非 1.47.x 时提示"未验证版本"，功能仍尝试启用 |
| 菜单扩展点 | `LGraphNode.prototype.getExtraMenuOptions` 是否存在 | 缺失 → 整体禁用，控制台说明原因 |
| 入参节点 | `window.LiteGraph.registered_node_types.PrimitiveNode` | 缺失 → 禁用 FR-4/FR-5，FR-3 仍可用 |
| 起线能力 | `canvas.linkConnector?.dragNewFromInput` 是否为函数 | 缺失 → FR-3 降级为方案 C 或置灰 |
| 指针钩子 | `canvas.pointer` 与 `canvas._linkConnectorDrop` 是否存在 | 缺失 → FR-3 降级为方案 B/C |

### 7.2 降级显示

功能不可用时，对应菜单条目**置灰（`disabled: true`）**，并在条目文案或提示中说明原因，不做静默失效。

---

## 8. 风险与缓解

| 级别 | 风险 | 缓解 |
|---|---|---|
| P0 | 从菜单启动的起线缺少指针生命周期钩子，可能无法落点 | 编码前最小验证；三级降级方案（§5.4） |
| P1 | `_linkConnectorDrop` / `linkConnector` 为内部实现，版本升级易失效 | 收敛到 `compat` 层，集中访问 + 探测 + 降级 |
| P1 | 依赖 `PrimitiveNode` 的内部行为（惰性 widget、合并规则） | 只依赖其对外可观测行为，不自研同步；升级时以 AC 回归验证 |
| P2 | 子菜单无法分组，长参数列表可读性差 | 文案前缀 + 按节点定义顺序排列；必要时后续改用动态子菜单 |
| P2 | 菜单项位于「Extensions」分组 | 接受，作为既定交互 |
| P2 | 跨节点类型合并参数时下拉选项以首个连接为准 | 在文档与提示中说明；必要时限制为同节点类型内复用 |
| P2 | `socketless` 参数无法外置 | 不列入菜单并说明 |

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

### 9.2 回归点（前端升级时必测）

T-01、T-02、T-03、T-05、T-08。

### 9.3 手工验证清单

- 控制台无新增报错 / 警告（特别注意扩展触发的 deprecated 提示）。
- 与第三方扩展共存：同节点上另有一个扩展也挂了 `getExtraMenuOptions`，双方条目均正常。

---

## 10. 未决问题（Open Questions）

1. 是否将语义等价的参数（如 `seed` 与 `noise_seed`）纳入同一复用键？现方案按参数名严格匹配。
2. 入参节点标题最终格式（当前拟为 `入参·seed`），是否需要中英对照。
3. 已连线的内部参数槽被点击时，是替换现有连线还是拒绝操作。
4. `FLOAT` 与 `INT` 等类型不同但语义相同的参数是否需要互通。
5. 是否需要"一键外置该节点全部内部参数"的批量入口。

---

## 11. 附录：源码依据索引

前端包路径：`python/Lib/site-packages/comfyui_frontend_package/static/assets/*.js.map`（`sourcesContent` 内含原始源码）。

| 源文件 | 关键内容 |
|---|---|
| `src/lib/litegraph/src/LGraphCanvas.ts` | `:838` 指针对象创建；`:2113` `_linkConnectorDrop`；`:2865-2874` 输入槽拖拽分支；`:8553` 画布菜单聚合；`:8646` `node.getExtraMenuOptions` 调用；`:8751` 节点菜单入口 |
| `src/lib/litegraph/src/linkConnector.ts` | `:412` `dragNewFromInput`；`moveInputLink`、`dragNewFromOutput`、`dropLinks`、`reset` |
| `src/lib/litegraph/src/contextMenuCompat.ts` | 旧式 monkey-patch 兼容层与废弃告警 |
| `src/extensions/core/widgetInputs.ts` | `:31` `PrimitiveNode` 定义；`:509` `mergeIfValid`；`:519` `convertWidgetToInput` 废弃；`:564` `onInputDblClick` 范本 |
| `src/services/litegraphService.ts` | `addInputSocket` / `addInputWidget`（输入槽与 widget 共存）；`addNodeContextMenuHandler`；`getExtraOptionsForWidget` |
| `src/composables/graph/contextMenuConverter.ts` | `:428` 子菜单转换；分隔符丢弃；`buildStructuredMenu` 分组规则 |
| `src/composables/graph/useMoreOptionsMenu.ts` | 新版节点菜单聚合流程 |
| `src/stores/nodeDefStore.ts` | `_migrateDefaultInput`（required 输入槽恒存在）；`getInputSpecForWidget` |
| `src/renderer/utils/nodeTypeGuards.ts` | `isPrimitiveNode` |
| `ComfyUI/nodes.py:1580` | KSampler 输入定义 |
