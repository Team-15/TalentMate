import React, { useMemo, useState } from 'react';
import { Calendar, Segmented, DatePicker, Modal, Form, Input, InputNumber, Button, message, Popconfirm, Select, Tag } from 'antd';
import { LeftOutlined, RightOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import api from '../../services/api';
import HeatmapStrip from './HeatmapStrip';
import MailPreviewModal from './MailPreviewModal';
import { EVENT_TYPE_OPTIONS, EVENT_TYPE_META, DOT_COLORS } from './eventTypes';

dayjs.locale('zh-cn');

function CalendarPanel({ events, contacts = [], selectedDate, onDateChange, viewMode, onViewModeChange, onRefresh, heatmap = [], onSelectContact }) {
  const current = dayjs(selectedDate);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [dayModalDate, setDayModalDate] = useState(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [mailPreview, setMailPreview] = useState({ open: false, event: null, contact: null });

  // Debug: log all events when they change
  React.useEffect(() => {
    console.log('[CalendarPanel] Total events:', events.length, events.map(e => e.title + '@' + e.start_time));
  }, [events]);

  const goPrev = () => onDateChange(current.subtract(1, 'month').toDate());
  const goNext = () => onDateChange(current.add(1, 'month').toDate());
  const handleMonthPick = (date) => { if (date) onDateChange(date.toDate()); };

  const todayEvents = useMemo(() => {
    const ds = current.format('YYYY-MM-DD');
    return events.filter((ev) => dayjs(ev.start_time).format('YYYY-MM-DD') === ds);
  }, [events, current]);

  // --- All events sorted, for Agenda continuous timeline ---
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [events]);

  // --- CRUD handlers ---
  const openAdd = () => {
    setEditingEvent(null);
    form.resetFields();
    form.setFieldsValue({ startTime: dayjs(), endTime: dayjs().add(1, 'hour'), reminder: 10, eventType: 'general' });
    setModalOpen(true);
  };

  const openEdit = (ev) => {
    setEditingEvent(ev);
    form.setFieldsValue({
      title: ev.title,
      startTime: dayjs(ev.start_time),
      endTime: ev.end_time ? dayjs(ev.end_time) : undefined,
      reminder: ev.reminder,
      contactId: ev.contact_id || undefined,
      eventType: ev.event_type || 'general',
    });
    setModalOpen(true);
  };

  // Open day-detail modal from month cell click
  const handleDayClick = (date) => {
    setDayModalDate(date.toDate());
    setDayModalOpen(true);
  };

  // Filter events for the day modal
  const dayModalEvents = useMemo(() => {
    if (!dayModalDate) return [];
    const ds = dayjs(dayModalDate).format('YYYY-MM-DD');
    return events.filter((ev) => dayjs(ev.start_time).format('YYYY-MM-DD') === ds);
  }, [events, dayModalDate]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/api/events/${id}`);
      message.success('已删除');
      onRefresh?.();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payload = {
        title: values.title,
        startTime: values.startTime.format('YYYY-MM-DD HH:mm'),
        endTime: values.endTime ? values.endTime.format('YYYY-MM-DD HH:mm') : null,
        reminder: values.reminder ?? 10,
        contactId: values.contactId || null,
        eventType: values.eventType || 'general',
        mailStatus: values.contactId ? 'draft' : 'none',
      };

      if (editingEvent) {
        await api.put(`/api/events/${editingEvent.id}`, payload);
        message.success('已更新');
      } else {
        await api.post('/api/events', payload);
        message.success('已添加');
      }
      setModalOpen(false);
      onRefresh?.();
    } catch (err) {
      if (err.errorFields) return; // form validation
      message.error('操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // Group sorted events by date for agenda timeline (today + future only)
  const groupedEvents = useMemo(() => {
    const todayStr = dayjs().format('YYYY-MM-DD');
    const map = {};
    sortedEvents.forEach((ev) => {
      const d = dayjs(ev.start_time).format('YYYY-MM-DD');
      // Only show today and future events
      if (d < todayStr) return;
      if (!map[d]) map[d] = [];
      map[d].push(ev);
    });
    return Object.entries(map).map(([date, evts]) => ({ date: dayjs(date), isToday: date === todayStr, events: evts }));
  }, [sortedEvents]);

  // Calendar cell render
  const cellRender = (date) => {
    const ds = typeof date.format === 'function' ? date.format('YYYY-MM-DD') : dayjs(date).format('YYYY-MM-DD');
    const dayEvts = events.filter((ev) => {
      const d = dayjs(ev.start_time).format('YYYY-MM-DD');
      return d === ds;
    });
    if (!dayEvts.length) return null;
    console.log(`[Calendar] Date: ${ds}, Events: ${dayEvts.length}, First: ${dayEvts[0].title}`);
    return (
      <ul className="list-none p-0 m-0 text-[10px] leading-tight">
        {dayEvts.slice(0, 2).map((ev, i) => (
          <li key={ev.id} className="truncate pl-1.5 border-l-2 mb-0.5"
            style={{ borderColor: DOT_COLORS[i % DOT_COLORS.length] }}>
            {ev.title}
          </li>
        ))}
        {dayEvts.length > 2 && <li className="text-[#1677FF] pl-1.5">+{dayEvts.length - 2}</li>}
      </ul>
    );
  };

  // --- Agenda view: continuous multi-day timeline ---
  const renderAgenda = () => {
    if (groupedEvents.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 h-full py-12 text-slate-400">
          <span className="text-4xl mb-3">📭</span>
          <span className="text-sm">暂无关怀安排</span>
        </div>
      );
    }

    return (
      <div className="overflow-y-auto h-full py-2 px-6">
        {groupedEvents.map((group, gi) => {
          const lastIdx = group.events.length - 1;
          return (
            <div key={group.date.format('YYYY-MM-DD')} className={gi > 0 ? 'mt-2' : ''}>
              {/* Date header */}
              <div className="flex items-center gap-3 mt-2 mb-6">
                <span className={`text-xs font-semibold whitespace-nowrap ${group.isToday ? 'text-red-400' : 'text-gray-500'}`}>
                  {group.isToday ? '● 今天,' : '●'} {group.date.format('M月D日 dddd')}
                </span>
                <div className={`flex-1 h-px ${group.isToday ? 'bg-red-100' : 'bg-gray-100'}`} />
              </div>

              {/* Events for this date */}
              {group.events.map((ev, idx) => {
                const start = dayjs(ev.start_time).format('HH:mm');
                const end = ev.end_time ? dayjs(ev.end_time).format('HH:mm') : null;
                const isPast = dayjs(ev.start_time).isBefore(dayjs());
                const duration = ev.end_time ? Math.round((new Date(ev.end_time) - new Date(ev.start_time)) / 60000) : 60;
                const typeMeta = EVENT_TYPE_META[ev.event_type || 'general'] || EVENT_TYPE_META.general;

                return (
                  <div key={ev.id} className="group flex items-start gap-3">
                    <div className="w-16 shrink-0 text-right pt-[20px]">
                      <div className="text-sm font-semibold text-gray-700 font-mono leading-tight">{start}</div>
                      {end && <div className="text-xs text-gray-400 font-mono mt-0.5 leading-tight">{end}</div>}
                    </div>
                    <div className="flex flex-col items-center shrink-0 pt-[26px]">
                      <div className={`w-2.5 h-2.5 rounded-full ring-4 ring-indigo-50 ${isPast ? 'bg-slate-300' : 'bg-indigo-500'}`} />
                      {idx < lastIdx && <div className="w-[1.5px] bg-gray-100 flex-1 min-h-[50px] my-0.5" />}
                    </div>
                    <div className="flex-1 mb-2 group/card bg-white rounded-xl p-3.5 border border-slate-100 hover:border-blue-100 hover:shadow-sm transition-all duration-200 cursor-pointer border-l-4"
                      style={{ borderLeftColor: typeMeta.color }}>
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] ${typeMeta.bg} ${typeMeta.text}`}>{typeMeta.label}</span>
                            {ev.mail_status && ev.mail_status !== 'none' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-50 text-slate-500">
                                {ev.mail_status === 'sent' ? '邮件已发' : '邮件草稿'}
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-semibold text-gray-800 mt-2 truncate">{ev.title}</h4>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200">
                          {ev.contact_id && (
                            <button onClick={() => setMailPreview({ open: true, event: ev, contact: findContact(contacts, ev) })} className="text-slate-400 hover:text-slate-700 border border-slate-100 bg-white rounded-md cursor-pointer px-2 py-0.5 text-xs">邮件</button>
                          )}
                          <button onClick={() => openEdit(ev)} className="text-gray-300 hover:text-indigo-500 border-0 bg-transparent cursor-pointer p-0.5"><EditOutlined className="text-xs" /></button>
                          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(ev.id)} okText="删除" cancelText="取消">
                            <button className="text-gray-300 hover:text-red-400 border-0 bg-transparent cursor-pointer p-0.5"><DeleteOutlined className="text-xs" /></button>
                          </Popconfirm>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                        {ev.contact_name && (
                          <span className="inline-flex items-center gap-1.5 text-slate-500">
                            <span
                              className="w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center"
                              style={{ background: ev.contact_avatar_color || '#1677FF' }}
                            >
                              {(ev.contact_name || '?').slice(-1)}
                            </span>
                            {ev.contact_name}
                          </span>
                        )}
                        {end && <span>持续 {duration} 分钟</span>}
                        {ev.reminder > 0 && (
                          <span className="inline-flex items-center gap-1 bg-gray-100/80 text-gray-500 px-2 py-0.5 rounded-full">⏰ {ev.reminder}分钟前</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Top navigation — date + view switcher */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-1">
          {viewMode === 'month' ? (
            <>
              <button onClick={goPrev} className="p-1.5 rounded-full hover:bg-slate-100 transition">
                <LeftOutlined className="text-slate-400 text-sm" />
              </button>
              <DatePicker value={current} onChange={handleMonthPick} picker="month" variant="borderless" allowClear={false} suffixIcon={null} format="YYYY年 M月"
                className="[&_input]:!text-base [&_input]:!font-semibold [&_input]:!text-slate-800 [&_input]:!w-[105px] [&_input]:!text-center hover:bg-gray-50 rounded-lg cursor-pointer" />
              <button onClick={goNext} className="p-1.5 rounded-full hover:bg-slate-100 transition">
                <RightOutlined className="text-slate-400 text-sm" />
              </button>
            </>
          ) : (
            <h2 className="text-base font-semibold text-slate-800">关怀列表</h2>
          )}
        </div>

        {/* View switcher + Add button */}
        <div className="flex items-center gap-3">
          <Segmented
            value={viewMode}
            onChange={onViewModeChange}
            options={[
              { label: '本月', value: 'month' },
              { label: '关怀', value: 'agenda' },
            ]}
            className="!rounded-full"
          />
          <button
            onClick={openAdd}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-[#1677FF] text-white
                       hover:bg-[#0958D9] transition border-0 cursor-pointer shadow-sm"
          >
            <PlusOutlined className="text-sm" />
          </button>
        </div>
      </div>

      <HeatmapStrip items={heatmap} onSelect={onSelectContact} />

      {/* Content area — flex-1 + min-h-0 for shrink, overflow-y-auto for scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {viewMode === 'month' ? (
          <Calendar
            value={current}
            onSelect={handleDayClick}
            onChange={(d) => onDateChange(d.toDate())}
            cellRender={cellRender}
            fullscreen
            headerRender={() => null}
          />
        ) : (
          renderAgenda()
        )}
      </div>

      {/* Day Detail Popover — fully custom, no Ant Design chrome */}
      <Modal
        title={null}
        footer={null}
        closeIcon={null}
        open={dayModalOpen}
        onCancel={() => setDayModalOpen(false)}
        width={440}
        className="[&_.ant-modal-content]:!rounded-2xl [&_.ant-modal-content]:!p-6 [&_.ant-modal-content]:!bg-white/95 [&_.ant-modal-content]:!backdrop-blur-md [&_.ant-modal-content]:!border [&_.ant-modal-content]:!border-gray-100 [&_.ant-modal-content]:!shadow-[0_20px_60px_rgba(0,0,0,0.08)]"
      >
        {/* Custom header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-bold text-lg text-slate-800">
            {dayModalDate ? dayjs(dayModalDate).format('YYYY年M月D日 dddd') : ''}
          </h2>
          <button onClick={() => setDayModalOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition border-0 bg-transparent cursor-pointer text-lg">&times;</button>
        </div>

        {/* Event list */}
        {dayModalEvents.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <span className="text-4xl block mb-3">🎉</span>
            <span className="text-sm">今天没有安排，好好放松一下吧</span>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-72 overflow-y-auto mb-4">
            {dayModalEvents.map((ev) => {
              const time = dayjs(ev.start_time).format('HH:mm');
              const end = ev.end_time ? dayjs(ev.end_time).format('HH:mm') : null;
              const typeMeta = EVENT_TYPE_META[ev.event_type || 'general'] || EVENT_TYPE_META.general;
              return (
                <div key={ev.id} className="group bg-white border border-slate-100 rounded-xl p-4 flex justify-between items-center hover:border-blue-100 hover:shadow-sm transition-all duration-200 border-l-4"
                  style={{ borderLeftColor: typeMeta.color }}>
                  <div>
                    <div className="font-semibold text-gray-800 text-sm">{ev.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{time}{end && <span> - {end}</span>}</div>
                    {(ev.contact_name || (ev.event_type && ev.event_type !== 'general') || (ev.mail_status && ev.mail_status !== 'none')) && (
                      <div className="flex gap-1 mt-2">
                        {ev.contact_name && <Tag className="!m-0">{ev.contact_name}</Tag>}
                        {ev.event_type && ev.event_type !== 'general' && <Tag color="blue" className="!m-0">{typeMeta.label}</Tag>}
                        {ev.mail_status && ev.mail_status !== 'none' && <Tag className="!m-0">{ev.mail_status === 'sent' ? '邮件已发' : '邮件草稿'}</Tag>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {ev.contact_id && (
                      <button onClick={() => setMailPreview({ open: true, event: ev, contact: findContact(contacts, ev) })} className="text-slate-400 hover:text-slate-700 border border-slate-100 bg-white rounded-md cursor-pointer px-2 py-0.5 text-xs">邮件</button>
                    )}
                    <button onClick={() => { openEdit(ev); setDayModalOpen(false); }} className="text-gray-300 hover:text-indigo-500 border-0 bg-transparent cursor-pointer p-0.5"><EditOutlined className="text-xs" /></button>
                    <Popconfirm title="确认删除？" onConfirm={() => handleDelete(ev.id)} okText="删除" cancelText="取消">
                      <button className="text-gray-300 hover:text-red-400 border-0 bg-transparent cursor-pointer p-0.5"><DeleteOutlined className="text-xs" /></button>
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Notion-style dashed add button */}
        <button
          onClick={() => {
            setDayModalOpen(false);
            setTimeout(() => {
              setEditingEvent(null);
              form.resetFields();
              form.setFieldsValue({ startTime: dayjs(dayModalDate), endTime: dayjs(dayModalDate).add(1, 'hour'), reminder: 10, eventType: 'general' });
              setModalOpen(true);
            }, 200);
          }}
          className="w-full py-3 border border-dashed border-gray-200 hover:border-indigo-400 hover:text-indigo-600 rounded-xl text-sm text-gray-400 flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
            <PlusOutlined /> 添加关怀安排
        </button>
      </Modal>

      {/* Event Add/Edit Modal */}
      <Modal
        title={editingEvent ? '编辑关怀安排' : '添加关怀安排'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText={editingEvent ? '保存' : '添加'}
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="title" label="事项标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：给妈妈打电话、约小王吃饭" />
          </Form.Item>
          <Form.Item name="startTime" label="开始时间" rules={[{ required: true, message: '请选择时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" className="!w-full" />
          </Form.Item>
          <Form.Item name="endTime" label="结束时间（可选）">
            <DatePicker showTime format="YYYY-MM-DD HH:mm" className="!w-full" />
          </Form.Item>
          <Form.Item name="reminder" label="提前提醒（分钟）">
            <InputNumber min={0} max={1440} className="!w-full" placeholder="默认10分钟" />
          </Form.Item>
          <Form.Item name="contactId" label="关联联系人（可选）">
            <Select
              allowClear
              showSearch
              placeholder="选择名册中的家人、朋友或熟人"
              optionFilterProp="label"
              options={contacts.map((contact) => ({
                value: contact.id,
                label: `${contact.name}${contact.department ? ` / ${contact.department}` : ''}${contact.role ? ` / ${contact.role}` : ''}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="eventType" label="关怀类型">
            <Select options={EVENT_TYPE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      <MailPreviewModal
        open={mailPreview.open}
        event={mailPreview.event}
        contact={mailPreview.contact}
        onClose={() => setMailPreview({ open: false, event: null, contact: null })}
      />
    </div>
  );
}

function findContact(contacts, event) {
  return contacts.find((contact) => contact.id === event.contact_id) || {
    id: event.contact_id,
    name: event.contact_name,
    email: event.contact_email,
    department: event.contact_department,
    role: event.contact_role,
    avatar_color: event.contact_avatar_color,
  };
}

export default CalendarPanel;
