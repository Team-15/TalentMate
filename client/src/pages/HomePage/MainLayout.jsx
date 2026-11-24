import React from 'react';
import { useNavigate } from 'react-router-dom';
import { message, Tour, Segmented, Modal } from 'antd';
import CalendarPanel from './CalendarPanel';
import ChatPanel from './ChatPanel';
import DirectoryPanel from './DirectoryPanel';
import TimelinePanel from './TimelinePanel';
import api from '../../services/api';
import { useAppData } from '../../hooks/useAppData';
import { applyVoiceResult } from '../../hooks/useVoiceAssistant';
import { clearReminderPreference } from '../../native/reminderPref';

/**
 * MainLayout — 桌面端双栏工作台（浏览器访问时使用）。
 *
 * 数据状态已上移到 <AppDataProvider>，与手机端共用同一套请求与缓存逻辑，
 * 这里只负责桌面布局、视图切换与新手引导。
 *
 * 手机端请见 src/layouts/MobileShell.jsx。
 */
function MainLayout() {
  const navigate = useNavigate();

  const {
    events, contacts, heatmap, messages, selectedDate, username,
    setMessages, setSelectedDate, setEvents,
    refreshEvents, refreshContacts, refreshHeatmap, refreshTodayEvents,
  } = useAppData();

  const [viewMode, setViewMode] = React.useState('month');
  const [workspaceMode, setWorkspaceMode] = React.useState('calendar');
  const [selectedContact, setSelectedContact] = React.useState(null);
  const [isTourOpen, setIsTourOpen] = React.useState(false);

  const calendarRef = React.useRef(null);
  const micRef = React.useRef(null);

  // 首次进入时自动展示新手引导
  React.useEffect(() => {
    const seen = localStorage.getItem('has_seen_tour') === '1';
    if (!seen) setTimeout(() => setIsTourOpen(true), 800);
  }, []);

  const handleVoiceResult = React.useCallback((result) => {
    applyVoiceResult(result, {
      setMessages,
      setEvents,
      refreshEvents,
      refreshHeatmap,
      refreshTodayEvents,
      setSelectedDate,
    });
  }, [setMessages, setEvents, refreshEvents, refreshHeatmap, refreshTodayEvents, setSelectedDate]);

  const openTimeline = (contact) => {
    setSelectedContact(contact);
    setWorkspaceMode('timeline');
  };

  const handleLogout = () => {
    // 与手机端一致：先二次确认，避免误触退出
    Modal.confirm({
      title: '确认退出登录？',
      okText: '退出',
      cancelText: '取消',
      onOk: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        // 这两个是账号级状态，不清会让下一个登录的人在同一个浏览器里
        // 跳过新手引导、沿用上一个人的提醒偏好
        localStorage.removeItem('has_seen_tour');
        clearReminderPreference();
        message.success('已退出登录');
        navigate('/login');
      },
    });
  };

  return (
    <div className="min-h-screen bg-[#EEF3F8] p-4 md:p-5 lg:p-6">
      <div className="max-w-[1500px] mx-auto h-[calc(100vh-2rem)] md:h-[calc(100vh-2.5rem)] lg:h-[calc(100vh-3rem)] flex flex-col gap-4">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold">TM</span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900 leading-tight">TalentMate 伴贤</h1>
              <p className="text-xs text-slate-500 mt-0.5">语音驱动的私人关系关怀工作台</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
            <span className="px-3 py-1.5 rounded-full bg-white border border-slate-100">名册 {contacts.length}</span>
            <span className="px-3 py-1.5 rounded-full bg-white border border-slate-100">关怀日程 {events.length}</span>
          </div>
        </div>

        {/* Responsive dual-panel */}
        <div className="flex flex-col lg:flex-row gap-5 min-h-0 flex-1">
        {/* Left: Calendar Panel */}
        <div ref={calendarRef} className="w-full lg:w-[60%] xl:w-[65%] flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-white/80 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <Segmented
              value={workspaceMode}
              onChange={setWorkspaceMode}
              options={[
                { label: '日历', value: 'calendar' },
                { label: '名册', value: 'directory' },
                { label: '时间线', value: 'timeline' },
              ]}
              className="!rounded-full"
            />
            <span className="text-xs text-slate-400">关系管理视图</span>
          </div>
          <div className="flex-1 min-h-0">
            {workspaceMode === 'calendar' && (
              <CalendarPanel
                events={events}
                contacts={contacts}
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={() => { refreshEvents(); refreshHeatmap(); refreshTodayEvents(); }}
                heatmap={heatmap}
                onSelectContact={openTimeline}
              />
            )}
            {workspaceMode === 'directory' && (
              <DirectoryPanel
                contacts={contacts}
                heatmap={heatmap}
                onRefresh={() => { refreshContacts(); refreshHeatmap(); }}
                onSelect={openTimeline}
              />
            )}
            {workspaceMode === 'timeline' && <TimelinePanel contact={selectedContact} />}
          </div>
        </div>

        {/* Right: Chat Panel */}
        <div className="w-full lg:w-[40%] xl:w-[35%] lg:min-w-[380px] lg:max-w-[450px] flex flex-col bg-white rounded-2xl shadow-sm border border-white/80 h-full">
          <ChatPanel
            messages={messages}
            onVoiceResult={handleVoiceResult}
            username={username}
            onLogout={handleLogout}
            onRefresh={() => { refreshEvents(); refreshTodayEvents(); }}
            onContactsRefresh={() => { refreshContacts(); refreshHeatmap(); }}
            micRef={micRef}
          />
        </div>
        </div>
      </div>

      {/* Ant Design Tour — guided onboarding */}
      <Tour
        open={isTourOpen}
        onClose={async () => {
          setIsTourOpen(false);
          localStorage.setItem('has_seen_tour', '1');
          try { await api.put('/api/auth/complete-tour'); } catch (_) {}
        }}
        steps={[
          {
            title: '关系关怀看板',
            description: '左侧统一管理日历、名册、个人互动时间线和关怀热力图。',
            target: () => calendarRef.current,
          },
          {
            title: '用语音安排关怀',
            description: '点击麦克风，直接说：「周末提醒我给妈妈打电话」。',
            target: () => micRef.current,
          },
        ]}
      />
    </div>
  );
}

export default MainLayout;
