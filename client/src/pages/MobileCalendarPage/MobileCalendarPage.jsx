import React from 'react';
import {
  DatePicker, Drawer, Form, Input, InputNumber, Select, Button,
  Modal, message, Calendar, Segmented, Dropdown,
} from 'antd';
import { PlusOutlined, LeftOutlined, RightOutlined, MoreOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import MobileHeader from '../../components/MobileHeader';
import { useAppData } from '../../hooks/useAppData';
import { useOverlayBackHandler } from '../../native/overlays';
import { isNative } from '../../native/platform';
import {
  checkNotificationPermission, requestNotificationPermission,
} from '../../native/notifications';
import { isReminderEnabled } from '../../native/reminderPref';
import {
  EVENT_TYPE_OPTIONS, DOT_COLORS, eventTypeMeta,
} from '../HomePage/eventTypes';
import api from '../../services/api';

dayjs.locale('zh-cn');

/**
 * MobileCalendarPage — 手机端日程页。
 *
 * 两种模式：
 *   关怀 —— 按日期分组的列表（手机默认，一屏信息密度更高）
 *   本月 —— 月历，格子里只显示圆点与超出数量，点日期弹出当天 Bottom Sheet
 *
 * 添加/编辑使用全屏 Drawer，日期与时间拆开选择，避免小屏弹出键盘后难以操作。
 */
function MobileCalendarPage() {
  const { events, contacts, selectedDate, setSelectedDate, refreshEvents, refreshTodayEvents, refreshHeatmap } = useAppData();

  const [viewMode, setViewMode] = React.useState('agenda');
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingEvent, setEditingEvent] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [daySheetDate, setDaySheetDate] = React.useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 表单是否有未保存的改动（TC-075：离开前必须确认）
  const dirtyRef = React.useRef(false);
  // 同步提交锁。不能用 state —— 双击时两次点击都会在 setState 生效前读到旧值，
  // 于是同一个 handler 跑两遍（BUG-007 的重复写入就是这个原因）。
  const submitLockRef = React.useRef(false);

  // Android 返回键：先关浮层，再返回上一页
  useOverlayBackHandler(editorOpen, () => requestCloseEditor());
  useOverlayBackHandler(!!daySheetDate, () => setDaySheetDate(null));

  const current = dayjs(selectedDate);

  // ---- 新增 / 编辑 ----
  const openAdd = React.useCallback((presetDate, presetContactId) => {
    setEditingEvent(null);
    form.resetFields();
    dirtyRef.current = false;
    const base = presetDate ? dayjs(presetDate) : dayjs();
    form.setFieldsValue({
      startDate: base,
      startTime: base.format('HH:mm'),
      endDate: base.add(1, 'hour'),
      endTime: base.add(1, 'hour').format('HH:mm'),
      reminder: 10,
      eventType: 'general',
      contactId: presetContactId ? Number(presetContactId) : undefined,
    });
    setEditorOpen(true);
  }, [form]);

  // BUG-001：首页「新建日程」与联系人详情「安排沟通」都是导航到 /calendar?action=new，
  // 但这里此前完全没有读取 query，用户点击后只落到日程页，新建表单不会打开。
  React.useEffect(() => {
    if (searchParams.get('action') !== 'new') return;
    const contactId = searchParams.get('contactId');
    openAdd(undefined, contactId);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (ev) => {
    setEditingEvent(ev);
    dirtyRef.current = false;
    const start = dayjs(ev.start_time);
    const end = ev.end_time ? dayjs(ev.end_time) : null;
    form.setFieldsValue({
      title: ev.title,
      startDate: start,
      startTime: start.format('HH:mm'),
      endDate: end,
      endTime: end ? end.format('HH:mm') : null,
      reminder: ev.reminder ?? 10,
      contactId: ev.contact_id || undefined,
      eventType: ev.event_type || 'general',
    });
    setEditorOpen(true);
  };

  /** 关闭编辑器；有未保存改动时先确认（TC-075） */
  const requestCloseEditor = () => {
    if (!dirtyRef.current) {
      setEditorOpen(false);
      return;
    }
    Modal.confirm({
      title: '放弃未保存的修改？',
      content: '当前修改还没有保存，离开后将丢失。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        dirtyRef.current = false;
        setEditorOpen(false);
      },
    });
  };

  const submit = async () => {
    // 同步锁：第二次点击直接返回，避免重复创建（BUG-007 同类问题）
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const start = dayjs(`${v.startDate.format('YYYY-MM-DD')} ${v.startTime}`, 'YYYY-MM-DD HH:mm');
      const end = v.endDate && v.endTime
        ? dayjs(`${v.endDate.format('YYYY-MM-DD')} ${v.endTime}`, 'YYYY-MM-DD HH:mm')
        : null;

      const payload = {
        title: v.title,
        startTime: start.format('YYYY-MM-DD HH:mm'),
        endTime: end ? end.format('YYYY-MM-DD HH:mm') : null,
        // 0 是合法值（不提醒）；只有留空才用默认 10，不能写 `?? 10` 之外的 `|| 10`
        reminder: (v.reminder === undefined || v.reminder === null || v.reminder === '') ? 10 : v.reminder,
        contactId: v.contactId || null,
        eventType: v.eventType || 'general',
        mailStatus: v.contactId ? 'draft' : 'none',
      };

      if (editingEvent) {
        await api.put(`/api/events/${editingEvent.id}`, payload);
        message.success('已更新');
      } else {
        await api.post('/api/events', payload);
        message.success('已添加');
      }
      dirtyRef.current = false;
      setEditorOpen(false);
      refreshEvents();
      refreshTodayEvents();
      refreshHeatmap();

      // 用户刚设置了「提前提醒」，这正是申请通知权限的合适时机：
      // 意图明确、上下文清楚，而不是一启动就弹系统框（方案 §10.10）。
      if (isNative && payload.reminder > 0 && isReminderEnabled()) {
        const perm = await checkNotificationPermission();
        if (!perm.granted) {
          const asked = await requestNotificationPermission();
          if (asked.granted) {
            message.success('已开启提醒通知');
          }
        }
      }
    } catch (err) {
      if (err?.errorFields) return; // 表单校验失败
      message.error('保存失败，请重试');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/api/events/${id}`);
      message.success('已删除');
      refreshEvents();
      refreshTodayEvents();
      refreshHeatmap();
    } catch {
      message.error('删除失败');
    }
  };

  // ---- 列表数据：今天及以后，按日期分组 ----
  const grouped = React.useMemo(() => {
    const todayStr = dayjs().format('YYYY-MM-DD');
    const map = new Map();
    [...events]
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .forEach((ev) => {
        const d = dayjs(ev.start_time).format('YYYY-MM-DD');
        if (d < todayStr) return;
        if (!map.has(d)) map.set(d, []);
        map.get(d).push(ev);
      });
    return [...map.entries()].map(([date, list]) => ({
      date,
      isToday: date === todayStr,
      events: list,
    }));
  }, [events]);

  const daySheetEvents = React.useMemo(() => {
    if (!daySheetDate) return [];
    const ds = dayjs(daySheetDate).format('YYYY-MM-DD');
    return events
      .filter((ev) => dayjs(ev.start_time).format('YYYY-MM-DD') === ds)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [events, daySheetDate]);

  /** 月历格子：只画圆点 + 超出数量，不放标题（窄屏放不下） */
  const cellRender = (date) => {
    const ds = typeof date.format === 'function' ? date.format('YYYY-MM-DD') : dayjs(date).format('YYYY-MM-DD');
    const dayEvts = events.filter((ev) => dayjs(ev.start_time).format('YYYY-MM-DD') === ds);
    if (!dayEvts.length) return null;
    return (
      <div className="flex flex-wrap gap-0.5 justify-center pt-0.5">
        {dayEvts.slice(0, 3).map((ev, i) => (
          <span
            key={ev.id}
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: DOT_COLORS[i % DOT_COLORS.length] }}
          />
        ))}
        {dayEvts.length > 3 && (
          <span className="text-[9px] text-[#1677FF] leading-none">+{dayEvts.length - 3}</span>
        )}
      </div>
    );
  };

  return (
    <>
      <MobileHeader
        title="日程"
        subtitle={`${current.format('YYYY年M月')} · 共 ${events.length} 项`}
        right={(
          <button
            type="button"
            onClick={() => openAdd()}
            aria-label="添加日程"
            className="mobile-touch w-11 h-11 flex items-center justify-center rounded-full
              bg-[#1677FF] text-white border-0 cursor-pointer active:opacity-80"
          >
            <PlusOutlined />
          </button>
        )}
      />

      <div className="px-4 pt-2">
        {/* 模式切换 + 月份切换 */}
        <div className="flex items-center justify-between mb-2">
          <Segmented
            value={viewMode}
            onChange={setViewMode}
            options={[
              { label: '关怀', value: 'agenda' },
              { label: '本月', value: 'month' },
            ]}
            className="!rounded-full"
          />
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setSelectedDate(current.subtract(1, 'month').toDate())}
              className="mobile-touch w-11 h-11 flex items-center justify-center rounded-full
                text-slate-500 border-0 bg-transparent cursor-pointer active:bg-slate-100"
            >
              <LeftOutlined className="text-xs" />
            </button>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setSelectedDate(current.add(1, 'month').toDate())}
              className="mobile-touch w-11 h-11 flex items-center justify-center rounded-full
                text-slate-500 border-0 bg-transparent cursor-pointer active:bg-slate-100"
            >
              <RightOutlined className="text-xs" />
            </button>
          </div>
        </div>
      </div>

      {/* 关怀列表 */}
      {viewMode === 'agenda' && (
        <div className="px-4 pb-4">
          {grouped.length === 0 ? (
            <EmptyBlock text="暂无关怀安排" hint="点右上角 ＋ 或右下角麦克风安排一次沟通" />
          ) : (
            grouped.map((group) => (
              <section key={group.date} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold ${group.isToday ? 'text-red-400' : 'text-slate-500'}`}>
                    {group.isToday ? '● 今天 · ' : ''}{dayjs(group.date).format('M月D日 dddd')}
                  </span>
                  <span className="flex-1 h-px bg-slate-200/70" />
                </div>
                <div className="space-y-2">
                  {group.events.map((ev) => (
                    <EventCard
                      key={ev.id}
                      event={ev}
                      onEdit={() => openEdit(ev)}
                      onDelete={() => handleDelete(ev.id)}
                      onMail={() => navigate(`/mail/${ev.id}`)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {/* 月历 */}
      {viewMode === 'month' && (
        <div className="px-2 pb-2">
          <div className="mobile-calendar bg-white rounded-2xl shadow-sm border border-white overflow-hidden">
            <Calendar
              value={current}
              onSelect={(d) => setDaySheetDate(d.toDate())}
              onChange={(d) => setSelectedDate(d.toDate())}
              cellRender={cellRender}
              fullscreen
              headerRender={() => null}
            />
          </div>
          <p className="text-[11px] text-slate-400 text-center mt-2">
            点击日期查看当天安排
          </p>
        </div>
      )}

      {/* 当天详情 Bottom Sheet */}
      <Drawer
        placement="bottom"
        open={!!daySheetDate}
        onClose={() => setDaySheetDate(null)}
        height="auto"
        className="mobile-sheet"
        styles={{ body: { padding: '0 16px calc(16px + var(--safe-bottom))' } }}
        closable={false}
      >
        <div className="pt-1">
          <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-4" />
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-800">
              {daySheetDate ? dayjs(daySheetDate).format('M月D日 dddd') : ''}
            </h3>
            <button
              type="button"
              onClick={() => setDaySheetDate(null)}
              aria-label="关闭"
              className="mobile-touch w-11 h-11 flex items-center justify-center rounded-full
                text-slate-400 border-0 bg-transparent cursor-pointer active:bg-slate-100"
            >
              ✕
            </button>
          </div>

          {daySheetEvents.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">这天还没有安排</p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {daySheetEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  compact
                  onEdit={() => { setDaySheetDate(null); openEdit(ev); }}
                  onDelete={() => handleDelete(ev.id)}
                  // 这里原来引用了一个不存在的 setMailPreview/findContact，
                  // 从月历 Bottom Sheet 点「邮件草稿」会直接抛 ReferenceError。
                  onMail={() => navigate(`/mail/${ev.id}`)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => { const d = daySheetDate; setDaySheetDate(null); openAdd(d); }}
            className="w-full mt-3 py-3 border border-dashed border-slate-200 rounded-xl
              text-sm text-slate-500 bg-transparent cursor-pointer active:bg-slate-50
              flex items-center justify-center gap-2"
          >
            <PlusOutlined /> 添加关怀安排
          </button>
        </div>
      </Drawer>

      {/* 全屏编辑 Drawer */}
      <Drawer
        placement="right"
        width="100%"
        open={editorOpen}
        onClose={requestCloseEditor}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <MobileHeader
          title={editingEvent ? '编辑关怀安排' : '添加关怀安排'}
          onBack={requestCloseEditor}
          right={(
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-3 h-11 rounded-lg bg-[#1677FF] text-white text-sm font-medium
                border-0 cursor-pointer disabled:opacity-60"
            >
              {submitting ? '保存中' : '保存'}
            </button>
          )}
        />

        <div className="mobile-content px-4">
          <Form
            form={form}
            layout="vertical"
            className="pt-2"
            onValuesChange={() => { dirtyRef.current = true; }}
          >
            <Form.Item name="title" label="事项标题" rules={[{ required: true, message: '请输入标题' }]}>
              <Input placeholder="例如：给妈妈打电话" size="large" />
            </Form.Item>

            <div className="grid grid-cols-2 gap-3">
              <Form.Item name="startDate" label="开始日期" rules={[{ required: true, message: '请选择日期' }]}>
                <DatePicker className="!w-full" size="large" inputReadOnly />
              </Form.Item>
              <Form.Item name="startTime" label="开始时间" rules={[{ required: true, message: '请选择时间' }]}>
                <TimeField />
              </Form.Item>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Form.Item name="endDate" label="结束日期">
                <DatePicker className="!w-full" size="large" inputReadOnly />
              </Form.Item>
              <Form.Item name="endTime" label="结束时间">
                <TimeField />
              </Form.Item>
            </div>

            <Form.Item name="contactId" label="关联联系人">
              <Select
                allowClear
                showSearch
                size="large"
                placeholder="选择名册中的家人、朋友或熟人"
                optionFilterProp="label"
                options={contacts.map((c) => ({
                  value: c.id,
                  label: `${c.name}${c.department ? ` / ${c.department}` : ''}`,
                }))}
              />
            </Form.Item>

            <Form.Item name="eventType" label="关怀类型">
              <Select options={EVENT_TYPE_OPTIONS} size="large" />
            </Form.Item>

            <Form.Item name="reminder" label="提前提醒（分钟）">
              <InputNumber min={0} max={1440} className="!w-full" size="large" placeholder="默认 10 分钟" />
            </Form.Item>
          </Form>
        </div>
      </Drawer>
    </>
  );
}

/**
 * 时间选择：改用原生 <input type="time">。
 *
 * BUG-005：原来用 antd 的 DatePicker（picker="time"）在 Drawer 里弹出滚轮，
 * Android WebView 中小时/分钟两列无法上下滑动，表现为"点开就卡死"，
 * 直接阻断关怀安排的创建与编辑。
 * 原生时间控件交给系统弹窗渲染，滚动由系统保证，不再受 WebView 触摸/滚动容器影响。
 * 表单里存的仍是 "HH:mm" 字符串，提交拼接口径不变。
 */
function TimeField({ value, onChange }) {
  return (
    <input
      type="time"
      step={300}
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value || null)}
      className="w-full h-10 rounded-lg border border-[#d9d9d9] bg-white px-3 text-sm
        text-slate-800 leading-tight box-border
        focus:border-[#1677FF] focus:outline-none"
    />
  );
}

/** 日程卡片：编辑/删除/邮件都做成常显按钮，不依赖 hover */
function EventCard({ event, onEdit, onDelete, onMail, compact }) {
  const meta = eventTypeMeta(event.event_type);
  const start = dayjs(event.start_time).format('HH:mm');
  const end = event.end_time ? dayjs(event.end_time).format('HH:mm') : null;

  return (
    <div
      className="bg-white rounded-xl border border-slate-100 shadow-sm"
      style={{ borderLeft: `4px solid ${meta.color}` }}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${meta.bg} ${meta.text}`}>
                {meta.label}
              </span>
              {event.mail_status && event.mail_status !== 'none' && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-500">
                  {event.mail_status === 'sent' ? '邮件已发' : '邮件草稿'}
                </span>
              )}
            </div>
            <h4 className="text-sm font-semibold text-slate-800 mt-1.5">{event.title}</h4>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              {start}{end && ` – ${end}`}
              {event.reminder > 0 && <span className="ml-2 font-sans">⏰ 提前{event.reminder}分钟</span>}
            </p>
            {event.contact_name && (
              <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
                <span
                  className="w-4 h-4 rounded-full text-white text-[9px] flex items-center justify-center shrink-0"
                  style={{ background: event.contact_avatar_color || '#1677FF' }}
                >
                  {(event.contact_name || '?').slice(-1)}
                </span>
                {event.contact_name}
              </p>
            )}
          </div>

          {/*
            常显的操作菜单，不依赖 hover。
            BUG-002：原来用 absolute 定位 + 卡片 overflow-hidden，菜单被裁在卡片里，
            「邮件草稿」入口点不到（TC-093 因此 BLOCKED）。
            改用 antd Dropdown（默认挂到 body 的 portal，会自动避让屏幕边缘），
            不再受任何父容器的 overflow 影响。
          */}
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'edit', label: '编辑' },
                ...(event.contact_id ? [{ key: 'mail', label: '邮件草稿' }] : []),
                { type: 'divider' },
                { key: 'delete', label: '删除', danger: true },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent?.stopPropagation?.();
                if (key === 'edit') onEdit();
                else if (key === 'mail') onMail();
                else if (key === 'delete') {
                  Modal.confirm({
                    title: '确认删除？',
                    okText: '删除',
                    cancelText: '取消',
                    okButtonProps: { danger: true },
                    onOk: onDelete,
                  });
                }
              },
            }}
          >
            <button
              type="button"
              aria-label="更多操作"
              className="shrink-0 mobile-touch w-11 h-11 flex items-center justify-center rounded-full
                text-slate-400 border-0 bg-transparent cursor-pointer active:bg-slate-100"
            >
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

function EmptyBlock({ text, hint }) {
  return (
    <div className="py-14 text-center">
      <div className="text-4xl mb-3">📭</div>
      <p className="text-sm text-slate-500">{text}</p>
      {hint && <p className="text-xs text-slate-400 mt-2">{hint}</p>}
    </div>
  );
}

export default MobileCalendarPage;
