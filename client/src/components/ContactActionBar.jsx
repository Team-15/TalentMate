import React from 'react';
import { message, Modal, Input } from 'antd';
import dayjs from 'dayjs';
import api from '../services/api';

/**
 * Inline actions for a contact: remind-me + one-tap check-in.
 * Used on home attention list, insights rows, and contact detail.
 */
export default function ContactActionBar({
  contactId,
  contactName,
  phone,
  onDone,
  dense = false,
}) {
  const [busy, setBusy] = React.useState(false);

  const checkIn = async (channel) => {
    if (!contactId || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/api/contacts/${contactId}/check-in`, { channel });
      message.success(data.message || '已记录');
      onDone?.();
    } catch (err) {
      message.error(err?.response?.data?.message || '记录失败');
    } finally {
      setBusy(false);
    }
  };

  const checkInWithNote = () => {
    let note = '';
    Modal.confirm({
      title: `记录与「${contactName || '联系人'}」的联系`,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="可选：聊了什么、约定下次做什么"
          onChange={(e) => { note = e.target.value; }}
        />
      ),
      okText: '记下了（算一次联系）',
      cancelText: '取消',
      onOk: async () => {
        setBusy(true);
        try {
          const { data } = await api.post(`/api/contacts/${contactId}/check-in`, {
            channel: 'other',
            note: note || undefined,
          });
          message.success(data.message || '已记录');
          onDone?.();
        } catch (err) {
          message.error(err?.response?.data?.message || '记录失败');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const saveMemory = () => {
    let text = '';
    Modal.confirm({
      title: `关于「${contactName || '联系人'}」的记忆`,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="例如：喜欢喝乌龙茶；孩子今年中考"
          onChange={(e) => { text = e.target.value; }}
        />
      ),
      okText: '保存记忆',
      cancelText: '取消',
      onOk: async () => {
        if (!text.trim()) {
          message.warning('请填写内容');
          return Promise.reject();
        }
        setBusy(true);
        try {
          const { data } = await api.post(`/api/contacts/${contactId}/memories`, { text });
          message.success(data.message || '记忆已保存');
          onDone?.();
        } catch (err) {
          message.error(err?.response?.data?.message || '保存失败');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const remindMe = async () => {
    if (!contactId || busy) return;
    setBusy(true);
    try {
      const start = dayjs().add(1, 'day').hour(10).minute(0).second(0);
      const end = start.add(30, 'minute');
      await api.post('/api/events', {
        title: `提醒我联系${contactName || ''}`,
        startTime: start.format('YYYY-MM-DD HH:mm'),
        endTime: end.format('YYYY-MM-DD HH:mm'),
        reminder: 30,
        contactId,
        eventType: 'catch_up',
        mailStatus: 'none',
      });
      message.success('已安排：明天提醒你联系');
      onDone?.();
    } catch (err) {
      message.error(err?.response?.data?.message || '安排失败');
    } finally {
      setBusy(false);
    }
  };

  const dial = () => {
    if (!phone) {
      message.info('还没有填写电话');
      return;
    }
    window.location.href = `tel:${phone}`;
  };

  const btn = dense
    ? 'px-2 py-1 rounded-lg text-[11px] border border-slate-200 bg-white text-slate-600 cursor-pointer disabled:opacity-50'
    : 'flex-1 min-h-[40px] rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-600 cursor-pointer disabled:opacity-50';

  return (
    <div className={`flex flex-wrap gap-1.5 ${dense ? '' : 'mt-2'}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={btn} disabled={busy} onClick={() => checkIn('call')}>打电话了</button>
      <button type="button" className={btn} disabled={busy} onClick={() => checkIn('wechat')}>发微信了</button>
      <button type="button" className={btn} disabled={busy} onClick={checkInWithNote}>联系打卡</button>
      <button type="button" className={btn} disabled={busy} onClick={saveMemory}>记记忆</button>
      <button type="button" className={btn} disabled={busy} onClick={remindMe}>提醒我联系</button>
      {phone && (
        <button type="button" className={btn} onClick={dial}>拨号</button>
      )}
    </div>
  );
}
