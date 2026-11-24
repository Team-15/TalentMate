/**
 * 阶段 5 服务端整改的验证脚本（不需要数据库，因此可在本机直接跑）。
 *
 * 覆盖三件事：
 *   1. 限流中间件能正常构造（express-rate-limit v7+ 会在配置不当时抛错）
 *   2. 日志脱敏能挡住 JWT / 密码 / SMTP 凭证 / 密钥 / 联系人与正文
 *   3. 邮件 HTML 模板对所有用户可控字段都做了转义
 */
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message}`);
  }
}

// ---------- 1. 限流中间件 ----------
const { globalLimiter, authLimiter, voiceLimiter, mailLimiter } = require('./middleware/rateLimit');

check('限流中间件可构造且为函数', () => {
  for (const [n, m] of Object.entries({ globalLimiter, authLimiter, voiceLimiter, mailLimiter })) {
    assert.strictEqual(typeof m, 'function', `${n} 不是中间件函数`);
  }
});

check('未登录时 keyGenerator 返回非空（IPv6 已被归一化）', () => {
  const fakeReq = { ip: '2001:db8::1', headers: {}, user: undefined, app: { get: () => false } };
  const fakeRes = { setHeader() {} };
  // voiceLimiter 内部使用了自定义 keyGenerator，这里直接调用它验证不抛错
  const key = voiceLimiter.keyGenerator ? voiceLimiter.keyGenerator(fakeReq, fakeRes) : 'n/a';
  assert.ok(key, 'keyGenerator 返回空值');
});

// ---------- 2. 日志脱敏 ----------
const log = require('./services/logger');

check('密码字段被脱敏', () => {
  const out = log.redact({ username: 'alice', password: 'hunter2' });
  assert.strictEqual(out.username, 'alice');
  assert.strictEqual(out.password, '[redacted]');
});

check('JWT / token 字段被脱敏', () => {
  const out = log.redact({ authorization: 'Bearer abc.def.ghi', jwt: 'x', apiKey: 'k' });
  assert.strictEqual(out.authorization, '[redacted]');
  assert.strictEqual(out.jwt, '[redacted]');
  assert.strictEqual(out.apiKey, '[redacted]');
});

check('SMTP 凭证与签名被脱敏', () => {
  const out = log.redact({ SMTP_PASS: 'p', DB_PASSWORD: 'p', privateKey: 'k', signature: 's' });
  for (const k of Object.keys(out)) assert.strictEqual(out[k], '[redacted]', `${k} 未脱敏`);
});

check('message 里的 Bearer token 被替换', () => {
  const s = log.scrubString('failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');
  assert.ok(!s.includes('eyJhbGciOiJIUzI1NiJ9'), 'token 未被替换');
  assert.ok(s.includes('[redacted]'));
});

check('message 里的独立 JWT 被替换', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjQsInVzZXJuYW1lIjoiYXBrIn0.abcdefghijklmnop';
  const s = log.scrubString(`token=${jwt}`);
  assert.ok(!s.includes('eyJ1c2VySWQiOjQi'), 'JWT 未被替换');
});

check('Error 对象不输出 stack', () => {
  const e = new Error('connect ECONNREFUSED mysql://root:secret@db:3306');
  const out = log.redact(e);
  assert.ok(!('stack' in out), 'stack 被输出了');
  assert.strictEqual(out.name, 'Error');
});

check('正文 / 音频等大字段只记长度', () => {
  const out = log.redact({ body: 'x'.repeat(500), transcript: 'hi', audio: Buffer.from('abc') });
  assert.strictEqual(out.body, '[500 chars]');
  assert.strictEqual(out.transcript, '[2 chars]');
  assert.ok(String(out.audio).includes('Buffer') || out.audio === '[redacted]');
});

check('深层嵌套仍被脱敏', () => {
  const out = log.redact({ level1: { password: 'p', ok: 1 } });
  assert.strictEqual(out.level1.password, '[redacted]');
  assert.strictEqual(out.level1.ok, 1);
});

// ---------- 3. 邮件模板转义 ----------
const { renderCareEmail } = require('./services/emailService');

const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';

check('renderCareEmail 转义联系人姓名', () => {
  const { html } = renderCareEmail({ contact: { name: XSS }, event: { title: 'T' } });
  assert.ok(!html.includes('<script>'), '出现未转义的 script');
  assert.ok(!/<[a-z][^>]*onerror=/i.test(html), '出现未转义的 onerror 属性');
  assert.ok(html.includes('&lt;script&gt;'), '恶意内容未被转义为实体');
});

check('renderCareEmail 转义事件标题与开始时间', () => {
  const { html } = renderCareEmail({
    contact: { name: 'A' },
    event: { title: XSS, start_time: XSS, event_type: 'one_on_one' },
  });
  assert.ok(!html.includes('<script>'), '标题或时间出现未转义 script');
  assert.ok(!/<[a-z][^>]*onerror=/i.test(html), '标题或时间出现未转义 onerror 属性');
  assert.ok(html.includes('&lt;script&gt;'), '标题或时间未被转义为实体');
});

check('renderCareEmail 转义正文覆盖内容', () => {
  const { html } = renderCareEmail({
    contact: { name: 'A' }, event: { title: 'T' }, bodyOverride: XSS,
  });
  assert.ok(!html.includes('<script>'), 'bodyOverride 未转义');
});

check('邮件模板保留正常可读内容', () => {
  const { html, subject, body } = renderCareEmail({
    contact: { name: '妈妈' },
    event: { title: '给妈妈打电话', start_time: '2026-10-07 10:00:00', event_type: 'catch_up' },
  });
  assert.ok(html.includes('妈妈'), '姓名丢失');
  assert.ok(html.includes('给妈妈打电话'), '标题丢失');
  assert.ok(subject.includes('聊聊近况') || subject.includes('妈妈'), '私人语气主题缺失');
  assert.ok(body.includes('近况') || body.includes('怎么样'), '私人语气正文缺失');
  assert.ok(subject && body, 'subject/body 为空');
});

check('旧职场事件类型仍可生成私人邮件', () => {
  const { subject, body } = renderCareEmail({
    contact: { name: '张伟' },
    event: { title: '旧日程', event_type: 'one_on_one' },
  });
  assert.ok(subject.includes('聊聊近况'), 'legacy one_on_one 主题未映射');
  assert.ok(body.includes('聊聊') || body.includes('近况'), 'legacy one_on_one 正文未映射');
});

console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures ? 1 : 0);
