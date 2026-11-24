/**
 * APK UI / 生命周期自动化测试（在真实 WebView 内执行）
 * 用法: node ui-test.mjs
 * 前置: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 */
const PORT = 9222;

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  return ws;
}

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => reject(new Error('eval timeout')), 45000);
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (m.result?.exceptionDetails) {
        reject(new Error(m.result.exceptionDetails.exception?.description || 'exception'));
      } else {
        resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    }));
  });
}

let pass = 0; let fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${detail ? `  -> ${detail}` : ''}`); }
}

/** 安装全局错误采集器（只需一次） */
const INSTALL_ERR_HOOK = `
(()=>{
  if(!window.__errs){
    window.__errs=[];
    window.addEventListener('error',e=>window.__errs.push('error: '+(e.message||'')));
    window.addEventListener('unhandledrejection',e=>window.__errs.push('rejection: '+String(e.reason)));
  }
  return true;
})()`;

async function main() {
  const ws = await connect();
  await evaluate(ws, INSTALL_ERR_HOOK);

  console.log('=== A. 底部导航（四个 Tab）===');
  const tabs = [
    ['#/', '首页', ['关系概览', '今日安排', '需要关注的人', '快捷操作']],
    ['#/calendar', '日程', ['关怀', '本月']],
    ['#/contacts', '名册', ['关系名册']],
    ['#/insights', '洞察', ['关系洞察', '关怀概览']],
  ];
  for (const [hash, label, expects] of tabs) {
    await evaluate(ws, `location.hash='${hash}'; 'ok'`);
    await new Promise((r) => setTimeout(r, 2200));
    const body = await evaluate(ws, `document.body.innerText.replace(/\\s+/g,' ')`);
    const missing = expects.filter((e) => !body.includes(e));
    check(`Tab ${label} 渲染完整`, missing.length === 0, missing.length ? `缺少: ${missing.join(', ')}` : '');
    const active = await evaluate(ws, `(()=>{
      const nav=document.querySelector('.mobile-bottom-nav');
      if(!nav) return 'no-nav';
      const btns=[...nav.querySelectorAll('button')];
      const on=btns.filter(b=>b.getAttribute('aria-current')==='page').map(b=>b.getAttribute('aria-label'));
      return JSON.stringify({count:btns.length, active:on});
    })()`);
    const nav = JSON.parse(active);
    check(`Tab ${label} 底部导航 4 项且高亮正确`, nav.count === 4 && nav.active.length === 1,
      JSON.stringify(nav));
  }

  console.log('\n=== B. 布局与触摸目标 ===');
  {
    const r = await evaluate(ws, `(()=>{
      const de=document.documentElement;
      const horizontalScroll = de.scrollWidth > de.clientWidth + 1;
      // 底部导航是否遮挡最后一块内容
      const nav=document.querySelector('.mobile-bottom-nav');
      const navTop = nav ? nav.getBoundingClientRect().top : null;
      // 触控目标尺寸抽样
      const touch=[...document.querySelectorAll('.mobile-touch, .mobile-bottom-nav button')];
      const small=touch.filter(el=>{const b=el.getBoundingClientRect(); return b.height>0 && b.width>0 && (b.height<40||b.width<40);});
      return JSON.stringify({
        horizontalScroll,
        viewport: innerWidth+'x'+innerHeight,
        navTop: navTop===null?null:Math.round(navTop),
        touchCount: touch.length,
        tooSmall: small.length,
      });
    })()`);
    const v = JSON.parse(r);
    check('无横向滚动', v.horizontalScroll === false, `scrollWidth > clientWidth`);
    check('底部导航存在且位于视口内', v.navTop !== null && v.navTop < Number(v.viewport.split('x')[1]),
      JSON.stringify(v));
    check(`触控目标不小于 40px（抽样 ${v.touchCount} 个）`, v.tooSmall === 0, `${v.tooSmall} 个过小`);
  }

  console.log('\n=== C. 悬浮按钮规则 ===');
  for (const [hash, shouldShow] of [['#/', true], ['#/calendar', false], ['#/assistant', false], ['#/settings', true]]) {
    await evaluate(ws, `location.hash='${hash}'; 'ok'`);
    await new Promise((r) => setTimeout(r, 1800));
    const has = await evaluate(ws, `!!document.querySelector('.mobile-voice-fab')`);
    check(`${hash} 悬浮按钮${shouldShow ? '显示' : '隐藏'}`, has === shouldShow, `实际 ${has}`);
  }

  console.log('\n=== D. 二级页面与表单浮层 ===');
  {
    // 联系人详情
    const contactHash = await evaluate(ws, `(()=>{
      const t=localStorage.getItem('token');
      return fetch('http://49.232.160.212/api/contacts',{headers:{Authorization:'Bearer '+t}})
        .then(r=>r.json()).then(j=>{
          const c=(j.data||[])[0];
          if(!c) return 'none';
          location.hash='#/contacts/'+c.id;
          return String(c.id);
        });
    })()`);
    await new Promise((r) => setTimeout(r, 2500));
    const body = await evaluate(ws, `document.body.innerText.replace(/\\s+/g,' ')`);
    check('联系人详情页渲染', contactHash !== 'none' && body.includes('关系状态') && body.includes('互动时间线'),
      `contactId=${contactHash}`);
    check('联系人详情含三个主操作', body.includes('安排沟通') && body.includes('编辑资料') && body.includes('写邮件'));

    // 打开编辑浮层，用返回键关闭
    await evaluate(ws, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='编辑资料'); if(b) b.click(); return 'ok'})()`);
    await new Promise((r) => setTimeout(r, 1800));
    const opened = await evaluate(ws, `document.body.innerText.includes('头像颜色')`);
    check('编辑资料浮层可打开', opened === true);
  }

  console.log('\n=== E. 无 JS 错误 ===');
  {
    const errs = await evaluate(ws, `JSON.stringify(window.__errs||[])`);
    const list = JSON.parse(errs);
    check('WebView 内无未捕获 JS 错误', list.length === 0, list.slice(0, 3).join(' | '));
  }

  ws.close();
  console.log('\n========================================');
  console.log(`通过 ${pass} / 失败 ${fail}`);
  if (failures.length) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试异常: ' + e.message); process.exit(1); });
