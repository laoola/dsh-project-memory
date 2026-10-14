/**
 * Claude Code 记忆罗盘路径编码（照抄实测规则，PRD 决策 2）。
 *
 * 规则（来自 ~/.dsh/AGENTS.md 全局约定的实测差异）：
 * - 项目绝对路径中的 `:` 和每个 `\`（及 `/`，防御性）替换为 `-`；
 * - 纯 ASCII 路径到此为止（保持大小写），例：
 *     D:\GC\Code\DWMServer → D--GC-Code-DWMServer
 * - 含中文/非 ASCII 字符的路径：所有非可打印 ASCII 字符各替换为 `-`，
 *   且盘符转小写，例：
 *     D:\GC\ProjectFile\水印\DWMDataset → d--GC-ProjectFile----DWMDataset
 *     （“水印” 2 字 → `--`；前后各一个原分隔符 → 共 4 个 `-`）
 */

/** 判断路径是否含非 ASCII 字符（决定是否启用小写盘符规则）。 */
function hasNonAscii(s) {
  return /[^\u0000-\u007F]/.test(s);
}

/**
 * 把项目绝对路径编码为 Claude Code projects 目录下的目录名。
 * @param {string} projectPath 项目绝对路径
 * @returns {string} 编码后的目录名（不含尾部分隔符）
 */
export function encodeProjectPath(projectPath) {
  const raw = String(projectPath ?? '');
  const nonAscii = hasNonAscii(raw);
  let out = raw.replace(/:/g, '-').replace(/[\\/]/g, '-');
  if (nonAscii) {
    // 非“可打印 ASCII”（含空格以外的控制符、全角、CJK 等）→ '-'
    out = out.replace(/[^\u0021-\u007E]/g, '-');
    // 实测：非 ASCII 路径盘符转小写（首字符为盘符）
    out = out.charAt(0).toLowerCase() + out.slice(1);
  }
  return out;
}

/**
 * 模糊匹配键：去掉所有非字母数字并转小写。
 * 用于消化实测中的编码漂移（盘符大小写、中文字符数不一致等）。
 * @param {string} s
 * @returns {string}
 */
export function fuzzyKey(s) {
  return String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}
