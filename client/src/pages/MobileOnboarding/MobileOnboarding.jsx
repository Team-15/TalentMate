import React from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

/**
 * 手机端新手引导（方案 §10.10）。
 *
 * 三页：建立关系名册 → 查看关系温度 → 用语音安排互动。
 *
 * 权限策略：这里**不**申请麦克风或通知权限。
 * 按方案要求，只在用户真正开始使用对应能力时申请，
 * 避免首次启动连续弹出系统权限框导致用户直接拒绝。
 *   麦克风 → 在助手页点「开始录音」时申请（见 native/permissions.js）
 *   通知   → 首次同步日程提醒时申请（见 native/notifications.js）
 */
const PAGES = [
  {
    key: 'roster',
    title: '建立关系名册',
    desc: '把家人、朋友和熟人加进名册，之后的关怀安排都有据可依。',
    accent: '#1677FF',
    art: (
      <svg viewBox="0 0 120 120" className="w-32 h-32" fill="none" stroke="currentColor">
        <circle cx="46" cy="42" r="14" strokeWidth="3" />
        <path d="M22 92c0-13.3 10.7-24 24-24s24 10.7 24 24" strokeWidth="3" strokeLinecap="round" />
        <circle cx="86" cy="50" r="10" strokeWidth="3" />
        <path d="M70 92c0-8.8 7.2-16 16-16s16 7.2 16 16" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'insight',
    title: '查看关系温度',
    desc: '洞察页按紧急程度分组，谁太久没联系、谁已经安排好，一眼就能看到。',
    accent: '#F59E0B',
    art: (
      <svg viewBox="0 0 120 120" className="w-32 h-32" fill="none" stroke="currentColor">
        <path d="M22 92V62M46 92V42M70 92V54M94 92V32" strokeWidth="4" strokeLinecap="round" />
        <path d="M18 100h84" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'voice',
    title: '用语音安排互动',
    desc: '点底部的麦克风说一句「周末提醒我给妈妈打电话」，日程和邮件草稿会自动生成。',
    accent: '#10B981',
    art: (
      <svg viewBox="0 0 120 120" className="w-32 h-32" fill="none" stroke="currentColor">
        <rect x="48" y="24" width="24" height="40" rx="12" strokeWidth="3" />
        <path d="M36 56c0 13.3 10.7 24 24 24s24-10.7 24-24" strokeWidth="3" strokeLinecap="round" />
        <path d="M60 80v14M46 98h28" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * @param {boolean} open 是否展示
 * @param {() => void} onClose 关闭回调
 */
function MobileOnboarding({ open, onClose }) {
  const navigate = useNavigate();
  const [index, setIndex] = React.useState(0);

  if (!open) return null;

  const page = PAGES[index];
  const isLast = index === PAGES.length - 1;

  /** 关闭引导：本地标记已看过，并同步到服务端（失败不影响使用） */
  const finish = async (goto) => {
    localStorage.setItem('has_seen_tour', '1');
    try { await api.put('/api/auth/complete-tour'); } catch (_) { /* 忽略 */ }
    onClose?.();
    if (goto) navigate(goto);
  };

  const next = () => {
    if (isLast) { finish(); return; }
    setIndex((i) => i + 1);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#EEF3F8] flex flex-col"
      style={{
        paddingTop: 'max(20px, env(safe-area-inset-top))',
        paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
      }}
    >
      {/* 跳过 */}
      <div className="flex justify-end px-4 shrink-0">
        <button
          type="button"
          onClick={() => finish()}
          className="min-h-[44px] px-3 text-sm text-slate-400 border-0 bg-transparent cursor-pointer"
        >
          跳过
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div style={{ color: page.accent }} className="mb-8">{page.art}</div>
        <h2 className="text-xl font-semibold text-slate-900 mb-3">{page.title}</h2>
        <p className="text-sm text-slate-500 leading-relaxed max-w-[300px]">{page.desc}</p>
      </div>

      {/* 底部：指示点 + 按钮 */}
      <div className="px-8 shrink-0">
        <div className="flex items-center justify-center gap-2 mb-6">
          {PAGES.map((p, i) => (
            <button
              key={p.key}
              type="button"
              aria-label={`第 ${i + 1} 页`}
              onClick={() => setIndex(i)}
              className="p-1.5 border-0 bg-transparent cursor-pointer"
            >
              <span
                className="block rounded-full transition-all"
                style={{
                  width: i === index ? 20 : 8,
                  height: 8,
                  background: i === index ? page.accent : '#CBD5E1',
                }}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={next}
          className="w-full min-h-[50px] rounded-2xl text-white text-base font-medium border-0 cursor-pointer"
          style={{ background: page.accent }}
        >
          {isLast ? '开始使用' : '下一步'}
        </button>

        {isLast && (
          <button
            type="button"
            onClick={() => finish('/contacts?action=new')}
            className="w-full mt-3 min-h-[44px] rounded-2xl bg-transparent text-sm
              text-slate-500 border border-slate-200 cursor-pointer"
          >
            先去添加第一位联系人
          </button>
        )}
      </div>
    </div>
  );
}

export default MobileOnboarding;
