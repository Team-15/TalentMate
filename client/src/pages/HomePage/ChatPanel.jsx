import React, { useState, useRef } from 'react';
import { Button, message } from 'antd';
import { AudioOutlined, UserOutlined, LogoutOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import MailPreviewModal from './MailPreviewModal';
import { ensureMicrophonePermission, microphonePermissionMessage } from '../../native/permissions';

// Encode Float32 PCM samples to WAV (16-bit, mono, 16kHz)
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

const QUICK_COMMANDS = [
  { icon: '聊', label: '聊聊近况' },
  { icon: 'BD', label: '生日祝福' },
  { icon: '节', label: '节日问候' },
  { icon: '约', label: '约见面' },
];

/**
 * ChatPanel — right-side AI chat + voice input per PRD §4.4.
 */
function ChatPanel({ messages, onVoiceResult, username, onLogout, onRefresh, onContactsRefresh, micRef }) {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mailPreview, setMailPreview] = useState({ open: false, event: null, contact: null });
  const mediaRecorderRef = useRef(null);
  const chatEndRef = useRef(null);

  // Auto scroll to bottom when messages change or loading starts
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Start / stop recording — uses Web Audio API to produce WAV
  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    try {
      // 原生环境下先申请麦克风运行时权限，否则 getUserMedia 会直接失败
      const permission = await ensureMicrophonePermission();
      if (!permission.granted) {
        message.error(microphonePermissionMessage(permission.reason));
        return;
      }

      // 第二次取流同样可能挂住（例如设备被其他应用占用），加超时保证有反馈
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_res, rej) => setTimeout(() => {
          const e = new Error('TimeoutError');
          e.name = 'TimeoutError';
          rej(e);
        }, 10000)),
      ]);
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      const chunks = [];

      source.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      // Store cleanup function
      mediaRecorderRef.current = {
        stop: () => {
          processor.disconnect();
          source.disconnect();
          audioCtx.close();
          stream.getTracks().forEach((t) => t.stop());

          // Merge all chunks and encode to WAV
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const merged = new Float32Array(totalLength);
          let offset = 0;
          for (const c of chunks) { merged.set(c, offset); offset += c.length; }

          const wav = encodeWAV(merged, 16000);
          sendAudioToServer(wav);
        },
      };

      setRecording(true);
    } catch (err) {
      const name = err?.name;
      const reason = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'no-device'
          : name === 'TimeoutError' ? 'timeout'
            : undefined;
      message.error(microphonePermissionMessage(reason));
    }
  };

  // Upload WAV audio to backend
  const sendAudioToServer = async (blob) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('audio', blob, 'recording.wav');

    try {
      const { data } = await api.post('/api/voice/recognize', formData);
      onVoiceResult?.({
        transcript: data.data?.transcript || '',
        message: data.message || '已处理',
        intent: data.data?.intent || {},
        eventIds: data.data?.eventIds || [],
        events: data.data?.events || [],
        queryDate: data.data?.queryDate || null,
        deleted: data.data?.deleted || false,
        modified: data.data?.modified || false,
        needsConfirm: data.data?.needsConfirm || false,
        needsContactDisambiguation: data.data?.needsContactDisambiguation || false,
        contactCandidates: data.data?.contactCandidates || [],
        pendingIntent: data.data?.pendingIntent || null,
        contact: data.data?.contact || null,
      });
      onRefresh?.();
      onContactsRefresh?.();
    } catch (err) {
      message.error('语音识别失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const resolveContact = async (contact, pendingIntent) => {
    try {
      setLoading(true);
      const { data } = await api.post('/api/voice/resolve-contact', {
        contactId: contact.id,
        pendingIntent,
      });
      onVoiceResult?.({
        transcript: `选择联系人：${contact.name}`,
        message: data.message || '已绑定联系人并创建日程',
        intent: data.data?.intent || pendingIntent,
        eventIds: data.data?.eventIds || [],
        events: data.data?.events || [],
        contact: data.data?.contact || contact,
      });
      onRefresh?.();
      onContactsRefresh?.();
    } catch {
      message.error('绑定联系人失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header — AI assistant info + user/logout on the right */}
      <div className="px-5 py-4 border-b border-gray-100/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#1677FF] to-[#0052D9] flex items-center justify-center text-white text-sm font-bold">
            TM
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">关怀助手</h3>
            <p className="text-xs text-slate-400">安排联系与问候邮件草稿</p>
          </div>
        </div>
        {/* User menu */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            <UserOutlined className="mr-1" />{username || '用户'}
          </span>
          <Button
            type="text"
            size="small"
            icon={<LogoutOutlined />}
            onClick={onLogout}
            className="!text-slate-400 hover:!text-slate-600 !text-xs"
          >
            退出
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Empty state — hidden when loading (voice sent) or has messages */}
        {messages.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            {/* Empty state */}
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-sm mb-4">用语音安排一次有上下文的互动</p>

            {/* Quick command chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-[280px]">
              {QUICK_COMMANDS.map((cmd) => (
                <button
                  key={cmd.label}
                  onClick={() => {
                    const hints = {
                      '聊聊近况': '请说「周末提醒我给妈妈打电话」',
                      '生日祝福': '请说「下周一给王芳安排生日祝福」',
                      '节日问候': '请说「中秋节给小王发节日问候」',
                      '约见面': '请说「下周五约小李吃饭」',
                    };
                    onVoiceResult?.({ transcript: cmd.label, message: hints[cmd.label] || '', intent: {} });
                  }}
                  className="px-3 py-1.5 rounded-full bg-slate-100 text-xs text-slate-500
                             hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer border-0"
                >
                  {cmd.icon} {cmd.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Message bubbles */}
            {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  m.type === 'user'
                    ? 'bg-[#1677FF] text-white rounded-br-md'
                    : 'bg-slate-100 text-slate-700 rounded-bl-md'
                }`}
              >
                <div>{m.text}</div>

                {/* Modify confirmation buttons */}
                {m.needsContactDisambiguation && m.contactCandidates?.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-xs text-slate-400 mb-1">请选择具体联系人：</div>
                    {m.contactCandidates.map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => resolveContact(contact, m.pendingIntent)}
                        className="w-full text-left px-3 py-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs border-0 cursor-pointer transition flex items-center gap-3"
                      >
                        <span
                          className="w-7 h-7 rounded-full text-white flex items-center justify-center text-[11px] font-semibold shrink-0"
                          style={{ background: contact.avatar_color || '#1677FF' }}
                        >
                          {(contact.name || '?').slice(-1)}
                        </span>
                        <span className="flex-1">
                          <span className="block font-medium">{contact.name}</span>
                          <span className="block text-[11px] text-blue-400 mt-0.5">
                            {contact.department || contact.role || contact.email || '未填写更多信息'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {!m.needsContactDisambiguation && m.type === 'assistant' && m.events?.some((ev) => ev.contact_id || m.contact) && (
                  <div className="mt-2">
                    <button
                      onClick={() => setMailPreview({ open: true, event: m.events[0], contact: m.contact })}
                      className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-xs border-0 cursor-pointer transition"
                    >
                      预览邮件
                    </button>
                  </div>
                )}

                {m.confirmType === 'modify' && m.events?.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-xs text-slate-400 mb-1">选择要修改的事件：</div>
                    {m.events.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={async () => {
                          try {
                            const mod = m.modifyPayload?.events?.[0] || {};
                            // Merge newDate/newTime with original event's date
                            const datePart = mod.newDate || dayjs(ev.start_time).format('YYYY-MM-DD');
                            const timePart = mod.newTime || mod.startTime || dayjs(ev.start_time).format('HH:mm');
                            const body = { title: mod.title || ev.title, startTime: datePart + ' ' + timePart };

                            // endTime — newEndTime from DeepSeek prompt, or legacy mod.endTime
                            const endTimeVal = mod.newEndTime || mod.endTime;
                            if (endTimeVal) {
                              const endDatePart = mod.newDate || dayjs(ev.end_time || ev.start_time).format('YYYY-MM-DD');
                              body.endTime = endDatePart + ' ' + endTimeVal;
                            }
                            body.reminder = ev.reminder;
                            const resp = await api.put(`/api/events/${ev.id}`, body);
                            onVoiceResult?.({
                              transcript: '修改确认',
                              message: resp.data?.message || `✅ 已更新「${body.title}」`,
                              intent: {},
                              modified: true,
                            });
                            onRefresh?.();
                          } catch (err) {
                            console.error('Modify error:', err.response?.data || err.message);
                            message.error('修改失败：' + (err.response?.data?.message || err.message));
                          }
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100
                                   text-blue-600 text-xs border-0 cursor-pointer transition"
                      >
                        ✏️ 修改：{ev.title} ({dayjs(ev.start_time).format('MM/DD HH:mm')})
                      </button>
                    ))}
                  </div>
                )}

                {/* Delete confirmation buttons */}
                {m.confirmType === 'delete' && m.events?.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {m.events.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={async () => {
                          try {
                            await api.delete(`/api/events/${ev.id}`);
                            onVoiceResult?.({
                              transcript: '删除确认',
                              message: `已删除事件「${ev.title}」`,
                              intent: {},
                              deleted: true,
                              events: [ev],
                            });
                            onRefresh?.();
                          } catch {
                            message.error('删除失败');
                          }
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100
                                   text-red-600 text-xs border-0 cursor-pointer transition"
                      >
                        🗑️ 删除：{ev.title} ({dayjs(ev.start_time).format('MM/DD HH:mm')})
                      </button>
                    ))}
                  </div>
                )}

                {/* Query result: event list cards — only when no confirmType (pure display) */}
                {!m.confirmType && m.events?.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {m.events.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 text-xs"
                      >
                        <span className="text-slate-500 font-mono">
                          {dayjs(ev.start_time).format('HH:mm')}
                        </span>
                        <span className="text-slate-700 font-medium flex-1">{ev.title}</span>
                        {ev.reminder > 0 && (
                          <span className="text-amber-500">⏰{ev.reminder}min</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
            {/* Loading bubble — inside message list, follows last message */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-400 px-4 py-2.5 rounded-2xl rounded-bl-md text-sm">
                  <span className="animate-pulse">●●●</span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input area — voice-first, large centered mic button */}
      <div className="flex flex-col items-center justify-center pb-6 pt-2 border-t border-gray-100/80">
        {/* Large mic button */}
        <button
          onClick={toggleRecording}
          ref={micRef}
          className={`w-16 h-16 rounded-full flex items-center justify-center border-0 cursor-pointer shadow-lg transition-all
            ${recording
              ? 'bg-red-500 text-white shadow-[0_0_0_8px_rgba(239,68,68,0.15)] animate-pulse'
              : 'bg-[#1677FF] text-white hover:bg-[#0958D9]'
            }`}
        >
          <AudioOutlined className="text-2xl" />
        </button>

        {/* Hint text */}
        <p className="text-xs text-gray-400 mt-3">
          {recording ? '正在录音，再次点击停止...' : '点击麦克风，说出联系人、时间和关怀事项'}
        </p>
      </div>

      <MailPreviewModal
        open={mailPreview.open}
        event={mailPreview.event}
        contact={mailPreview.contact}
        onClose={() => setMailPreview({ open: false, event: null, contact: null })}
      />
    </div>
  );
}

export default ChatPanel;
