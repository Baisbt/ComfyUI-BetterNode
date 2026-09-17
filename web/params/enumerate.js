/**
 * 参数枚举（对应 DESIGN FR-2 / TECHNICAL §5.3）
 *
 * 分类判据（已在前端 comfyui_frontend_package 1.47.12 源码中核实）：
 *   input.widget 存在   -> 内部编辑参数（本版本 widget 与 socket 共存，输入槽已由核心创建）
 *   input.widget 不存在 -> 可连线参数
 */

/** 控件类联动 widget 的默认名（如 seed 附带的 control_after_generate） */
const CONTROL_WIDGET_NAME = "control_after_generate";

/**
 * 判断某个 widget 是否为"控件类联动 widget"。
 * 这类 widget 只服务于宿主 widget 的取值模式，不属于用户可外置的参数。
 */
function isControlWidget(node, widget) {
  if (!widget) return false;
  if (widget.name === CONTROL_WIDGET_NAME) return true;

  for (const candidate of node.widgets ?? []) {
    if (candidate === widget) continue;
    if (Array.isArray(candidate.linkedWidgets) && candidate.linkedWidgets.includes(widget)) {
      return true;
    }
  }
  return false;
}

/**
 * 枚举节点的全部输入参数（按节点定义顺序，不重排）。
 *
 * @param {object} node 画布上的节点实例
 * @returns {Array<{name:string,label:string,kind:'link'|'widget',slotType:string,input:object,widget:object|undefined,index:number}>}
 */
export function enumerateParams(node) {
  const params = [];
  const inputs = node.inputs ?? [];

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const widget = input.widget
      ? (node.widgets ?? []).find((w) => w.name === input.widget.name)
      : undefined;

    // 排除控件类联动 widget，避免菜单出现噪声条目
    if (isControlWidget(node, widget)) continue;

    params.push({
      name: input.name,
      label: widget?.label || input.label || input.name,
      kind: widget ? "widget" : "link",
      slotType: input.type,
      input,
      widget,
      index,
    });
  }

  return params;
}
