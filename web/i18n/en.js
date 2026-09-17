/**
 * English message dictionary (TECHNICAL §5.9)
 *
 * Key naming: <domain>.<purpose>
 * The key set must match zh.js exactly — keep both files in sync.
 */

export const en = {
  // Menu
  "menu.title": "Input Parameters",

  // Parameter status (FR-6 reuse detail)
  "status.externalized": "externalized",
  "status.reusable": "reusable",
  "status.targets": "×{count}",
  "status.shared": "shared via group",

  // Label templates
  "label.item": "{name}",
  "label.itemWithStatus": "{name} · {status}",
  "label.unavailable": "{name} (unavailable: {reason})",

  // Batch externalize (FR-9)
  "action.externalizeAll": "Externalize all ({count} pending)",

  // Blocking reasons (FR-7)
  "deny.noNode": "node not found",
  "deny.virtualNode": "virtual node has no externalizable parameters",
  "deny.subgraphNode": "subgraph nodes are not supported yet",
  "deny.noParams": "this node has no input parameters",
  "deny.locked": "this slot is locked",
  "deny.noSocket": "this parameter has no input slot and cannot be externalized",
  "deny.exoticWidget": "this parameter type cannot be auto-converted into an input node",
  "deny.noPrimitiveNode": "the built-in Primitive node was not found; cannot create an input node",

  // Warnings (FR-7)
  "warn.valueClamped": "\"{name}\" had its range narrowed by the existing input node; value changed from {from} to {to}",
  "warn.mergeRejected": "\"{name}\" is not type/range compatible with the existing input node; a dedicated input node was created instead",
  "warn.batchFailed": "{count} parameter(s) failed during batch externalize; see the console",

  // Operation failure reasons (FR-7)
  "reason.noGraph": "the canvas is not ready",
  "reason.noSlot": "the parameter slot was not found",
  "reason.noLiteGraph": "the global LiteGraph object was not found",
  "reason.noDropHook": "could not register the link-drop handler",
  "reason.threw": "the frontend API threw an error; see the console",
  "reason.connectFailed": "the link was not created",

  // Errors (FR-7)
  "error.connectFailed": "failed to connect \"{name}\"; try dragging the link manually",
  "error.createFailed": "failed to create an input node for \"{name}\": {reason}",

  // Info (console only)
  "info.loaded": "loaded",
  "info.created": "created an input node for \"{name}\"",
  "info.reused": "reused the existing input node for \"{name}\"",
  "info.already": "\"{name}\" is already externalized; nothing to do",
  "info.batchResult": "batch externalize done: {created} created, {reused} reused, {skipped} skipped",
  "info.channel": "notification channel: {channel}",
  "info.language": "language: {lang}",
};
