/**
 * 中文文案字典（TECHNICAL §5.9）
 *
 * 键名约定：<域>.<用途>
 * 与 en.js 的键集合必须完全一致，改一处须同步另一处。
 */

export const zh = {
  // 菜单
  "menu.title": "输入参数",

  // 分组
  "group.link": "可连线",
  "group.widget": "内部参数",

  // 参数状态（FR-6）
  "status.externalized": "已外置",
  "status.reusable": "可复用",
  "status.connected": "已连线",

  // 文案模板
  "label.item": "{name}（{group}）",
  "label.itemWithStatus": "{name}（{group}·{status}）",
  "label.unavailable": "{name}（不可用：{reason}）",

  // 阻断级原因（FR-7）
  "deny.noNode": "节点不存在",
  "deny.virtualNode": "虚拟节点，没有可外置的参数",
  "deny.subgraphNode": "暂不支持子图节点",
  "deny.noParams": "该节点没有输入参数",
  "deny.locked": "该参数槽已被锁定",
  "deny.noSocket": "该参数没有输入槽，无法外置",
  "deny.exoticWidget": "该参数类型暂不支持自动生成入参节点",
  "deny.busy": "已有连线正在进行，请先完成或按 Esc 取消",
  "deny.dragUnsupported": "当前前端版本不支持自动起线，请手动拖线",
  "deny.noPrimitiveNode": "未找到内置 Primitive 节点，无法创建入参节点",

  // 提示级（FR-7）
  "warn.valueClamped": "「{name}」的取值范围已与已有入参节点收敛，取值由 {from} 调整为 {to}",
  "warn.mergeRejected": "「{name}」与已有入参节点的类型或取值范围不兼容，已改为新建独立入参节点",

  // 操作失败原因（FR-7 说明级）
  "reason.noGraph": "画布未就绪",
  "reason.noSlot": "找不到该参数槽",
  "reason.noLiteGraph": "未找到 LiteGraph 全局对象",
  "reason.unsupported": "当前前端版本不支持该操作",
  "reason.noDropHook": "未能注册拖拽落点钩子",
  "reason.threw": "调用前端接口时出错，详见控制台",
  "reason.connectFailed": "连线未建立",
  "reason.unavailable": "该能力不可用",

  // 说明级 / 失败提示（FR-7）
  "error.connectFailed": "「{name}」连线失败，可尝试手动拖线",
  "error.createFailed": "为「{name}」创建入参节点失败：{reason}",
  "error.dragFailed": "「{name}」起线失败：{reason}",
  "error.sourceMenuFailed": "「{name}」无法打开来源选择菜单：{reason}",

  // 信息级（仅控制台）
  "info.loaded": "已加载",
  "info.created": "已为「{name}」创建入参节点",
  "info.reused": "已复用「{name}」的入参节点",
  "info.already": "「{name}」已外置，无需重复操作",
  "info.dragStarted": "已进入连线状态，请点击目标输出槽或按 Esc 取消",
  "info.channel": "提示通道：{channel}",
  "info.language": "语言：{lang}",
};
