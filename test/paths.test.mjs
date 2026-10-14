import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeProjectPath, fuzzyKey } from '../lib/paths.js';

test('纯 ASCII：冒号与每个反斜杠替换为 -，保留大小写', () => {
  assert.equal(encodeProjectPath('D:\\GC\\Code\\DWMServer'), 'D--GC-Code-DWMServer');
  assert.equal(encodeProjectPath('C:\\Users\\zwh\\.claude'), 'C--Users-zwh-.claude');
});

test('含中文：非 ASCII 字符逐个 → -，盘符转小写（AGENTS.md 实测案例）', () => {
  assert.equal(encodeProjectPath('D:\\GC\\ProjectFile\\水印\\DWMDataset'), 'd--GC-ProjectFile----DWMDataset');
});

test('编码幂等（编码结果再编码不变）', () => {
  const once = encodeProjectPath('D:\\GC\\ProjectFile\\水印\\DWMDataset');
  assert.equal(encodeProjectPath(once), once);
});

test('fuzzyKey 消化盘符大小写与分隔符漂移', () => {
  assert.equal(fuzzyKey('D--GC-Code-DWM'), fuzzyKey('d--gc-code-dwm'));
  assert.equal(fuzzyKey('d--GC-ProjectFile----DWMDataset'), fuzzyKey('D--GC-ProjectFile--DWMDataset'));
});
