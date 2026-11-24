import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin } from 'antd';
import MobileHeader from '../../components/MobileHeader';
import ContactActionBar from '../../components/ContactActionBar';
import { useAppData } from '../../hooks/useAppData';
import {
  heatmapLabel, heatmapStyle, sortHeatmap, summarizeHeatmap,
} from '../HomePage/heatmap';

/** 分组顺序：越需要行动越靠前 */
const GROUPS = [
  { status: 'danger', title: '高优先级', hint: '长期未联系，建议尽快安排' },
  { status: 'warning', title: '需关注', hint: '接近关怀周期，值得留意' },
  { status: 'scheduled', title: '已安排', hint: '已有后续安排' },
  { status: 'new', title: '新联系人', hint: '还没有互动记录' },
  { status: 'healthy', title: '关系正常', hint: '保持当前节奏即可' },
];

/**
 * MobileInsightsPage — 手机端关系洞察。
 *
 * 以状态分组呈现关怀热力图，点击任意联系人进入其详情与时间线。
 * 相比桌面端的「热力图胶囊 + 弹窗」，这里改为纵向分组列表，更贴合窄屏。
 */
function MobileInsightsPage() {
  const navigate = useNavigate();
  const { heatmap, contacts, loading, refreshAll, refreshHeatmap } = useAppData();
  const [refreshing, setRefreshing] = React.useState(false);

  const summary = React.useMemo(() => summarizeHeatmap(heatmap), [heatmap]);
  const sorted = React.useMemo(() => sortHeatmap(heatmap), [heatmap]);

  const grouped = React.useMemo(() => {
    return GROUPS
      .map((g) => ({ ...g, items: sorted.filter((i) => i.status === g.status) }))
      .filter((g) => g.items.length > 0);
  }, [sorted]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshAll(); } finally { setRefreshing(false); }
  };

  return (
    <>
      <MobileHeader
        title="关系洞察"
        subtitle={`名册 ${contacts.length} 人`}
        right={(
          <button
            type="button"
            onClick={onRefresh}
            aria-label="刷新"
            disabled={refreshing}
            className="mobile-touch w-11 h-11 flex items-center justify-center rounded-full
              text-slate-500 border-0 bg-transparent cursor-pointer active:bg-slate-100
              disabled:opacity-50"
          >
            <svg className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0111.8-2.5L20 9M4 15l2.7 2.5A7 7 0 0018.5 15" />
            </svg>
          </button>
        )}
      />

      <div className="px-4 pt-3 space-y-3">
        {/* 概览 */}
        <section className="bg-white rounded-2xl p-4 shadow-sm border border-white">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">关怀概览</h2>
          <div className="grid grid-cols-2 gap-2">
            <SummaryCell label="高优先级" value={summary.danger} className="bg-red-50 text-red-600" />
            <SummaryCell label="需关注" value={summary.warning} className="bg-amber-50 text-amber-600" />
            <SummaryCell label="已安排" value={summary.scheduled} className="bg-blue-50 text-blue-600" />
            <SummaryCell label="关系正常" value={summary.healthy} className="bg-emerald-50 text-emerald-600" />
          </div>
        </section>

        {loading && heatmap.length === 0 ? (
          <div className="py-16 flex justify-center"><Spin /></div>
        ) : grouped.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📊</div>
            <p className="text-sm text-slate-500">还没有可分析的关系数据</p>
            <p className="text-xs text-slate-400 mt-2">先在名册中添加联系人</p>
            <button
              type="button"
              onClick={() => navigate('/contacts')}
              className="mt-4 px-4 py-2.5 rounded-xl bg-[#1677FF] text-white text-sm border-0 cursor-pointer"
            >
              去名册
            </button>
          </div>
        ) : (
          grouped.map((group) => (
            <section key={group.status} className="bg-white rounded-2xl p-4 shadow-sm border border-white">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded-full border text-[11px] ${heatmapStyle(group.status)}`}>
                  {heatmapLabel(group.status)}
                </span>
                <span className="text-xs text-slate-400">{group.items.length} 人</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">{group.hint}</p>

              <ul className="space-y-2 list-none p-0 m-0">
                {group.items.map((item) => (
                  <li key={item.id} className="rounded-xl bg-slate-50/60 p-2.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/contacts/${item.id}`)}
                      className="w-full text-left flex items-center gap-3 py-1 border-0
                        bg-transparent cursor-pointer rounded-lg"
                    >
                      <span
                        className="w-9 h-9 rounded-full text-white text-sm font-semibold flex items-center justify-center shrink-0"
                        style={{ background: item.avatar_color || '#1677FF' }}
                      >
                        {(item.name || '?').slice(-1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="block text-sm font-medium text-slate-800 truncate">{item.name}</span>
                          {item.has_upcoming && group.status !== 'scheduled' && (
                            <span className="px-1.5 py-0.5 rounded-full border text-[10px] shrink-0 bg-blue-50 text-blue-600 border-blue-100">
                              已安排
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-400 truncate mt-0.5">
                          {item.reason || [item.department, item.role].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {(group.status === 'danger' || group.status === 'warning' || group.status === 'new') && (
                      <ContactActionBar
                        dense
                        contactId={item.id}
                        contactName={item.name}
                        phone={item.phone}
                        onDone={() => refreshHeatmap()}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function SummaryCell({ label, value, className }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 flex items-center justify-between ${className}`}>
      <span className="text-xs">{label}</span>
      <span className="text-lg font-bold">{value}</span>
    </div>
  );
}

export default MobileInsightsPage;
