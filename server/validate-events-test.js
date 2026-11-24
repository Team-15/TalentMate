/**
 * 单独验证 events.js 的字段校验逻辑（不启动服务、不连数据库）。
 * 从源文件抽取 EVENT_LIMITS 与 validateEventFields，包进 IIFE 求值。
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'routes', 'events.js'), 'utf8');

const limitsMatch = src.match(/const EVENT_LIMITS = \{[\s\S]*?\};/);

/** 用花括号配平定位函数整体（注意参数是解构对象，其 } 不是函数体结束） */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start === -1) return null;
  // 先跳过参数列表：从 name( 之后的第一个 '(' 开始配对，找到匹配的 ')'
  let i = source.indexOf('(', start);
  if (i === -1) return null;
  let paren = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '(') paren += 1;
    else if (source[i] === ')') {
      paren -= 1;
      if (paren === 0) { i += 1; break; }
    }
  }
  // 参数之后才是函数体
  const bodyStart = source.indexOf('{', i);
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let j = bodyStart; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  return null;
}

const fnBody = extractFunction(src, 'validateEventFields');
if (!limitsMatch || !fnBody) {
  console.error('抽取失败: limits=' + Boolean(limitsMatch) + ' fn=' + Boolean(fnBody));
  process.exit(1);
}

const factory = new Function(
  limitsMatch[0] + '\n' + fnBody + '\nreturn validateEventFields;'
);
const validateEventFields = factory();

const CASES = [
  ['正常日程', { title: '给妈妈打电话', startTime: '2026-10-08 10:00' }, true],
  ['标题恰好 200 字符', { title: 'x'.repeat(200), startTime: '2026-10-08 10:00' }, true],
  ['标题 201 字符', { title: 'x'.repeat(201), startTime: '2026-10-08 10:00' }, false],
  ['超长标题 1000 字符', { title: 'x'.repeat(1000), startTime: '2026-10-08 10:00' }, false],
  ['标题仅空格', { title: '   ', startTime: '2026-10-08 10:00' }, false],
  ['错误时间格式（斜杠）', { title: 'a', startTime: '2026/10/08 10:00' }, false],
  ['时间带秒', { title: 'a', startTime: '2026-10-08 10:00:30' }, true],
  ['时间带 T 分隔', { title: 'a', startTime: '2026-10-08T10:00' }, true],
  ['结束早于开始', { title: 'a', startTime: '2026-10-08 10:00', endTime: '2026-10-08 09:00' }, false],
  ['结束晚于开始', { title: 'a', startTime: '2026-10-08 10:00', endTime: '2026-10-08 11:00' }, true],
  ['提醒 0（关闭）', { title: 'a', startTime: '2026-10-08 10:00', reminder: 0 }, true],
  ['提醒 1440（上限）', { title: 'a', startTime: '2026-10-08 10:00', reminder: 1440 }, true],
  ['提醒 1441（超上限）', { title: 'a', startTime: '2026-10-08 10:00', reminder: 1441 }, false],
  ['提醒小数', { title: 'a', startTime: '2026-10-08 10:00', reminder: 1.5 }, false],
  ['提醒非数字', { title: 'a', startTime: '2026-10-08 10:00', reminder: 'abc' }, false],
  ['关怀类型超长', { title: 'a', startTime: '2026-10-08 10:00', eventType: 'x'.repeat(41) }, false],
  ['邮件主题超长', { title: 'a', startTime: '2026-10-08 10:00', mailSubject: 'x'.repeat(201) }, false],
  ['未传 reminder（走默认）', { title: 'a', startTime: '2026-10-08 10:00' }, true],
];

let pass = 0;
let fail = 0;
for (const [name, input, want] of CASES) {
  const result = validateEventFields(input);
  const ok = result.valid === want;
  if (ok) pass += 1; else fail += 1;
  const extra = result.valid ? '' : '：' + result.message;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (期望 ${want}，实际 ${result.valid}${extra})`);
}
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
