/**
 * 参数同义组（复用键归并）——对应 DESIGN FR-5
 *
 * ⚠️ 规则（重要）：**只有人工确认语义等价的参数名才能放进同一组**，
 * 禁止按名称相似度自动归并。加组前必须核实两点：
 *   1. 两者在节点实现里是否传给同一个参数位；
 *   2. 输入规格（类型 / 范围）是否一致。
 *
 * 组内合并仍由原生 mergeInputSpec 校验；若规格不兼容，会自动落到
 * 「专用入参节点」机制（见 TECHNICAL §5.6），不会污染既有目标。
 */

const GROUPS = [
  {
    id: "noise-seed",
    members: ["seed", "noise_seed"],
    // 已核实（ComfyUI nodes.py）：
    //   KSampler.sample         → common_ksampler(model, seed, ...)
    //   KSamplerAdvanced.sample → common_ksampler(model, noise_seed, ...)
    //   两者规格逐字相同：INT, default 0, min 0, max 0xffffffffffffffff, control_after_generate
    // 注意：KSamplerAdvanced 在 add_noise=disable 时会忽略该种子，UI 需保留此提示。
    note: "生成噪声的种子",
  },
];

/** 参数名 -> 复用键（不在任何同义组内时，复用键即参数名本身） */
export function reuseKeyOf(paramName) {
  for (const group of GROUPS) {
    if (group.members.includes(paramName)) return group.id;
  }
  return paramName;
}

/** 参数所属的同义组（无则 null） */
export function synonymGroupOf(paramName) {
  return GROUPS.find((group) => group.members.includes(paramName)) ?? null;
}

/**
 * 两个参数名是否经同义组共用同一复用键。
 * 用于判断"命中的入参节点属于别的参数名"，即状态里的「共用」。
 */
export function isSameReuseKey(a, b) {
  return reuseKeyOf(a) === reuseKeyOf(b);
}
