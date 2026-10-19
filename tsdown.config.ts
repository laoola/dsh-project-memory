/**
 * client 半构建：产物直接输出为 web shell 的 lazy-CJS 注册体。
 * 宿主提供的模块（react 家族）经 factory 注入的 require 解析；模块副作用
 * 等 materialization 才执行（含样式注入）：
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...body...; return module.exports } })
 *
 * 配方对齐 dsh-taskboard tsdown.client.config.ts（只读参考实现）。
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  outDir: 'lib',
  clean: false,
  sourcemap: false,
  external: [/^@deepseek-ai\//, /^react(-dom)?(\/.*)?$/],
  target: 'chrome120',
  minify: true,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
    intro:
      'var module = { exports: {} }; var exports = module.exports; '
      + 'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    footer: 'return module.exports; } });',
  },
});
