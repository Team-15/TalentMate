import React from 'react';
import { Empty, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import api from '../../services/api';

function TimelinePanel({ contact }) {
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    if (!contact?.id) return;
    setLoading(true);
    api.get(`/api/contacts/${contact.id}/timeline`)
      .then((resp) => setData(resp.data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [contact?.id]);

  if (!contact) {
    return <div className="h-full flex items-center justify-center"><Empty description="从名册或热力图选择一个人" /></div>;
  }

  const logs = data?.logs || [];
  const events = data?.events || [];
  const merged = [
    ...logs.map((log) => ({ ...log, source: 'log' })),
    ...events.map((event) => ({ ...event, source: 'event', action_type: event.event_type || 'event', detail: event.mail_status })),
  ].sort((a, b) => new Date(String(b.occurred_at).replace(' ', 'T')) - new Date(String(a.occurred_at).replace(' ', 'T')));

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 shrink-0">
        <span
          className="w-10 h-10 rounded-full text-white flex items-center justify-center font-semibold"
          style={{ background: contact.avatar_color || '#1677FF' }}
        >
          {(contact.name || '?').slice(-1)}
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-800">{contact.name} 的互动时间线</h2>
          <p className="text-xs text-slate-400 mt-0.5">{contact.department || contact.role || contact.email || '暂无更多信息'}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="h-full flex items-center justify-center"><Spin /></div>
        ) : merged.length === 0 ? (
          <Empty description="暂无互动记录" />
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-[9px] top-1 bottom-1 w-px bg-slate-100" />
            {merged.map((item, idx) => (
              <div key={`${item.source}-${item.id}-${idx}`} className="relative pb-6">
                <span className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-blue-50" />
                <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-800">{item.title}</h3>
                    <Tag className="!m-0">{labelFor(item.action_type)}</Tag>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{dayjs(item.occurred_at).format('YYYY年M月D日 HH:mm')}</p>
                  {item.detail && <p className="text-xs text-slate-500 mt-3 leading-relaxed">{item.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function labelFor(type) {
  const map = {
    event_created: '日程',
    event_updated: '更新',
    event_cancelled: '已取消',
    mail_draft: '邮件草稿',
    mail_sent: '邮件已发',
    reached_out: '已联系',
    memory: '记忆',
    catch_up: '聊聊',
    birthday: '生日',
    anniversary: '纪念日',
    festival: '节日',
    visit: '见面',
    thanks: '道谢',
    one_on_one: '聊聊',
    interview: '聊聊',
    onboarding: '纪念日',
    offer: '道谢',
    followup: '聊聊',
  };
  return map[type] || '互动';
}

export default TimelinePanel;
