"""ComfyUI-BetterNode

为 ComfyUI 默认节点提供统一的「输入参数」外部输入入口。

本插件为**纯前端扩展**：不注册任何执行节点，仅通过 WEB_DIRECTORY 注入前端脚本，
在运行时以链式钩子挂载节点菜单项，**不修改 ComfyUI 核心或任何现有节点的源码**。

详细设计见同目录下 DESIGN.md 与 TECHNICAL.md。
"""

WEB_DIRECTORY = "./web"

# 本插件不提供任何后端节点
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
