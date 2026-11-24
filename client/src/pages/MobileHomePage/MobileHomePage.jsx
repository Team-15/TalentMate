import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin, message } from 'antd';
import dayjs from 'dayjs';
import MobileHeader from '../../components/MobileHeader';
import ContactActionBar from '../../components/ContactActionBar';
import { useAppData } from '../../hooks/useAppData';
import { greetingForNow } from '../../hooks/useVoiceAssistant';
import { heatmapLabel, heatmapStyle, sortHeatmap, summarizeHeatmap } from '../HomePage/heatmap';
import { eventTypeMeta } from '../HomePage/eventTypes';
import api from '../../services/api';

/**
 * MobileHomePage — 手机端首页。
 *
 * 只展示摘要（关系概览 / 今日安排 / 需要关注的人 / 快捷操作），
 * 完整数据在各自的 Tab 页里查看，避免一进 App 就加载整月日历与聊天面板。
 */
function MobileHomePage() {
  const navigate = useNavigate();
  const { username, todayEvents, contacts, heatmap, loading, refreshHeatmap, refreshEvents, refreshTodayEvents } = useAppData();
  const [suggestions, setSuggestions] = React.useState([]);
  const [festivals, setFestivals] = React.useState({ festivals: [], suggested_contacts: [] });

  const summary = React.useMemo(() => summarizeHeatmap(heatmap), [heatmap]);
  const attention = React.useMemo(
    () => sortHeatmap(heatmap).filter((item) => item.status === 'danger' || item.status === 'warning').slice(0, 4),
    [heatmap],
  );

  const refreshSuggestions = React.useCallback(() => {
    api.get('/api/insights/upcoming-dates', { params: { days: 7 } })
      .then((resp) => setSuggestions(resp.data?.data || []))
      .catch(() => setSuggestions([]));
    api.get('/api/insights/upcoming-festivals', { params: { days: 14 } })
      .then((resp) => setFestivals(resp.data?.data || { festivals: [], suggested_contacts: [] }))
      .catch(() => setFestivals({ festivals: [], suggested_contacts: [] }));
  }, []);

  React.useEffect(() => { refreshSuggestions(); }, [refreshSuggestions, contacts.length]);

  const createCareEvent = async (contactId, name, kind, date) => {
    try {
      const start = dayjs(date).hour(10).minute(0);
      const title = kind === 'birthday'
        ? `给${name}过生日`
        : kind === 'anniversary'
          ? `和${name}的纪念日`
          : `给${name}发节日问候`;
      await api.post('/api/events', {
        title,
        startTime: start.format('YYYY-MM-DD HH:mm'),
        endTime: start.add(30, 'minute').format('YYYY-MM-DD HH:mm'),
        reminder: 60,
        contactId,
        eventType: kind === 'anniversary' ? 'anniversary' : kind === 'birthday' ? 'birthday' : 'festival',
        mailStatus: 'none',
      });
      message.success('已安排提醒（只会提醒你自己）');
      refreshEvents();
      refreshTodayEvents();
      refreshHeatmap();
    } catch (err) {
      message.error(err?.response?.data?.message || '安排失败');
    }
  };

  return (
    <>
      <MobileHeader
        title={`${greetingForNow()}，${username}`}
        subtitle="今天也别忘了维护重要关系"
        right={(
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="设置"
            className="mobile-touch w-11 h-11 flex items-center justify-center rounded-full
              text-slate-500 active:bg-slate-100 border-0 bg-transparent cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        )}
      />

      <div className="px-4 pt-3 space-y-3">
        {/* 关系概览 */}
        <section className="bg-white rounded-2xl p-4 shadow-sm border border-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">关系概览</h2>
            <button
              type="button"
              onClick={() => navigate('/insights')}
              className="text-xs text-[#1677FF] border-0 bg-transparent cursor-pointer p-1"
            >
              查看洞察
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCell label="高优先级" value={summary.danger} tone="text-red-500" />
            <StatCell label="需关注" value={summary.warning} tone="text-amber-500" />
            <StatCell label="已安排" value={summary.scheduled} tone="text-blue-500" />
          </div>
        </section>

        {/* 今日安排 */}
        <section className="bg-white rounded-2xl p-4 shadow-sm border border-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">今日安排</h2>
            <button
              type="button"
              onClick={() => navigate('/calendar')}
              className="text-xs text-[#1677FF] border-0 bg-transparent cursor-pointer p-1"
            >
              全部日程
            </button>
          </div>

          {todayEvents.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">
              今天没有安排，点右下角麦克风可以语音安排
            </p>
          ) : (
            <ul className="space-y-2 list-none p-0 m-0">
              {todayEvents.slice(0, 4).map((ev) => {
                const meta = eventTypeMeta(ev.event_type);
                return (
                  <li
                    key={ev.id}
                    className="flex items-center gap-3 py-2 border-l-[3px] pl-3 rounded-r-lg"
                    style={{ borderLeftColor: meta.color }}
                  >
                    <span className="text-sm font-mono font-semibold text-slate-700 shrink-0 w-12">
                      {dayjs(ev.start_time).format('HH:mm')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-800 truncate">{ev.title}</span>
                      {ev.contact_name && (
                        <span className="block text-xs text-slate-400 truncate mt-0.5">
                          {ev.contact_name}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 即将到来的生日 / 纪念日 */}
        {suggestions.length > 0 && (
          <section className="bg-white rounded-2xl p-4 shadow-sm border border-white">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">即将到来</h2>
            <ul className="space-y-2 list-none p-0 m-0">
              {suggestions.slice(0, 5).map((s) => (
                <li key={`${s.kind}-${s.contact_id}`} className="flex items-center gap-3 py-1.5">
                  <span
                    className="w-9 h-9 rounded-full text-white text-sm font-semibold flex items-center justify-center shrink-0"
                    style={{ background: s.avatar_color || '#EC4899' }}
                  >
                    {(s.name || '?').slice(-1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800 truncate">
                      {s.name} · {s.label}
                    </span>
                    <span className="block text-xs text-slate-400 mt-0.5">
                      {s.days_until === 0 ? '就是今天' : `${s.days_until} 天后 · ${s.date}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => createCareEvent(s.contact_id, s.name, s.kind, s.date)}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-[#1677FF] text-white border-0 cursor-pointer"
                  >
                    提醒我
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 节日建议 */}
        {festivals.festivals?.length > 0 && (
          <section className="bg-white rounded-2xl p-4 shadow-sm border border-white">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">节日问候</h2>
            <p className="text-[11px] text-slate-400 mb-3">
              {festivals.festivals[0].name}
              {festivals.festivals[0].days_until === 0
                ? ' · 今天'
                : ` · ${festivals.festivals[0].days_until} 天后`}
            </p>
            {festivals.suggested_contacts?.length > 0 ? (
              <ul className="space-y-2 list-none p-0 m-0">
                {festivals.suggested_contacts.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <span className="text-sm text-slate-800 flex-1 truncate">{c.name}</span>
                    <button
                      type="button"
                      onClick={() => createCareEvent(
                        c.id,
                        c.name,
                        'festival',
                        festivals.festivals[0].date,
                      )}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] border border-slate-200 bg-white text-slate-600 cursor-pointer"
                    >
                      安排问候
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">把家人或重点联系人标出来后，这里会给出建议</p>
            )}
          </section>
        )}

        {/* 需要关注的人 */}
        <section className="bg-white rounded-2xl p-4 shadow-sm border border-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">需要关注的人</h2>
            <button
              type="button"
              onClick={() => navigate('/contacts')}
              className="text-xs text-[#1677FF] border-0 bg-transparent cursor-pointer p-1"
            >
              名册
            </button>
          </div>

          {loading && heatmap.length === 0 ? (
            <div className="py-6 flex justify-center"><Spin size="small" /></div>
          ) : attention.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">
              {contacts.length === 0 ? '名册还是空的，先添加联系人吧' : '目前没有需要特别关注的人'}
            </p>
          ) : (
            <ul className="space-y-3 list-none p-0 m-0">
              {attention.map((item) => (
                <li key={item.id} className="rounded-xl bg-slate-50/80 p-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/contacts/${item.id}`)}
                    className="w-full text-left flex items-center gap-3 border-0 bg-transparent cursor-pointer p-0"
                  >
                    <span
                      className="w-9 h-9 rounded-full text-white text-sm font-semibold flex items-center justify-center shrink-0"
                      style={{ background: item.avatar_color || '#1677FF' }}
                    >
                      {(item.name || '?').slice(-1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">{item.name}</span>
                        <span className={`px-1.5 py-0.5 rounded-full border text-[10px] shrink-0 ${heatmapStyle(item.status)}`}>
                          {heatmapLabel(item.status)}
                        </span>
                        {item.has_upcoming && (
                          <span className="px-1.5 py-0.5 rounded-full border text-[10px] shrink-0 bg-blue-50 text-blue-600 border-blue-100">
                            已安排
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-400 truncate mt-0.5">{item.reason}</span>
                    </span>
                    <Chevron />
                  </button>
                  <ContactActionBar
                    dense
                    contactId={item.id}
                    contactName={item.name}
                    phone={item.phone}
                    onDone={() => { refreshHeatmap(); refreshSuggestions(); }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 快捷操作 */}
        <section className="pb-2">
          <h2 className="text-sm font-semibold text-slate-800 mb-2 px-1">快捷操作</h2>
          <div className="grid grid-cols-3 gap-2">
            <QuickAction label="新建日程" onClick={() => navigate('/calendar?action=new')} />
            <QuickAction label="添加联系人" onClick={() => navigate('/contacts?action=new')} />
            <QuickAction label="语音安排" onClick={() => navigate('/assistant')} highlight />
          </div>
        </section>
      </div>
    </>
  );
}

function StatCell({ label, value, tone }) {
  return (
    <div className="text-center py-2 rounded-xl bg-slate-50/80">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function QuickAction({ label, onClick, highlight }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[56px] rounded-xl text-xs font-medium border cursor-pointer
        ${highlight
          ? 'bg-[#1677FF] text-white border-[#1677FF]'
          : 'bg-white text-slate-600 border-slate-100'}`}
    >
      {label}
    </button>
  );
}

function Chevron() {
  return (
    <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default MobileHomePage;
