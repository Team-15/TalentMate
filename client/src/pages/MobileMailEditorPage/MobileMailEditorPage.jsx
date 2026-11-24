import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Input, Segmented, Spin, message } from 'antd';
import MobileHeader from '../../components/MobileHeader';
import { useAppData } from '../../hooks/useAppData';
import { useOverlayBackHandler } from '../../native/overlays';
import { sanitizeEmailHtml } from '../../utils/sanitizeEmail';
import api from '../../services/api';

/**
 * MobileMailEditorPage — 手机端邮件草稿编辑与预览。
 *
 * 替代桌面端 920px 双栏 Modal：改成全屏页，编辑 / 预览用 Tab 切换，
 * 保存按钮固定在底部安全区内。
 *
 * 两种进入方式：
 *   /mail/:eventId                     从日程卡片/当天列表进入，可保存草稿
 *   /mail/new?contactId=xx&from=contact 从联系人详情「写邮件」进入，仅预览
 *
 * 说明：后端 PUT /api/mail/events/:id/draft 以「日程」为草稿载体，
 * 联系人维度没有独立草稿表，因此从联系人进入时不提供保存，
 * 而是明确提示需要先有日程，避免出现「点了保存但没生效」的假象。
 *
 * 对应方案 §10.9：Tab 切换 / 保存固定在安全区 / 离开前提醒未保存 /
 * 预览失败保留内容 / 保存后返回来源页 / 预览 HTML 必须净化。
 */
function MobileMailEditorPage() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { events, contacts, refreshEvents } = useAppData();

  const isNew = eventId === 'new';
  const numericId = isNew ? null : Number(eventId);

  const [tab, setTab] = React.useState('edit');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [previewHtml, setPreviewHtml] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  // 记录最近一次保存/加载的内容，用于判断是否有未保存改动
  const [savedSnapshot, setSavedSnapshot] = React.useState({ subject: '', body: '' });
  const [discardOpen, setDiscardOpen] = React.useState(false);

  /** 从联系人详情进入时带过来的联系人 */
  const contactIdParam = Number(searchParams.get('contactId')) || null;
  const fromContact = searchParams.get('from') === 'contact';

  /** 返回来源页：联系人详情进入则回联系人，否则回日程 */
  const backTo = fromContact && contactIdParam ? `/contacts/${contactIdParam}` : '/calendar';

  // 从已有数据里取事件与联系人，避免额外请求
  const event = React.useMemo(
    () => (numericId ? events.find((e) => e.id === numericId) || null : null),
    [events, numericId],
  );

  const targetContact = React.useMemo(() => {
    if (event?.contact_id) return contacts.find((c) => c.id === event.contact_id) || null;
    if (contactIdParam) return contacts.find((c) => c.id === contactIdParam) || null;
    return null;
  }, [contacts, event, contactIdParam]);

  /** 只有绑定到具体日程时才允许保存（后端草稿以日程为载体） */
  const canSave = !!numericId;

  const dirty = subject !== savedSnapshot.subject || body !== savedSnapshot.body;

  // 首次加载：拉取预览（后端会用模板生成初始主题与正文）
  React.useEffect(() => {
    setLoading(true);
    setLoadError(false);
    const payload = numericId
      ? { eventId: numericId }
      : { contactId: contactIdParam };
    api.post('/api/mail/preview', payload)
      .then((resp) => {
        const data = resp.data?.data || {};
        setSubject(data.subject || '');
        setBody(data.body || '');
        setSavedSnapshot({ subject: data.subject || '', body: data.body || '' });
        setPreviewHtml(data.html || '');
      })
      .catch(() => {
        // 生成失败也要保留用户可输入的空表单，不能白屏
        setLoadError(true);
        message.error('邮件预览生成失败，你仍可手动编辑');
      })
      .finally(() => setLoading(false));
  }, [numericId, contactIdParam]);

  /** 刷新预览：带上用户改过的主题与正文 */
  const refreshPreview = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/api/mail/preview', {
        eventId: numericId || undefined,
        contactId: numericId ? undefined : contactIdParam,
        bodyOverride: body,
        event: event ? { ...event, mail_subject: subject } : { mail_subject: subject },
        contact: targetContact || undefined,
      });
      setPreviewHtml(data?.data?.html || '');
    } catch {
      // 失败时不动 subject / body，用户输入得以保留
      message.error('预览刷新失败，已保留你的编辑内容');
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.put(`/api/mail/events/${numericId}/draft`, { subject, body });
      setSavedSnapshot({ subject, body });
      message.success('邮件草稿已保存');
      refreshEvents();
      navigate(backTo, { replace: true });
    } catch {
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const [sending, setSending] = React.useState(false);
  const canSendToContact = canSave && !!(targetContact?.email || event?.contact_email);

  const sendToContact = async () => {
    if (!canSave) return;
    if (!canSendToContact) {
      message.warning('联系人未填写邮箱，无法发送给对方');
      return;
    }
    setSending(true);
    try {
      await api.put(`/api/mail/events/${numericId}/draft`, { subject, body });
      const { data } = await api.post(`/api/mail/events/${numericId}/send`, { subject, body });
      setSavedSnapshot({ subject, body });
      message.success(data.message || '已发送给对方');
      refreshEvents();
      navigate(backTo, { replace: true });
    } catch (err) {
      message.error(err?.response?.data?.message || '发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  /** 离开前若有未保存内容，先确认 */
  const requestLeave = React.useCallback(() => {
    if (dirty && canSave) {
      setDiscardOpen(true);
      return;
    }
    navigate(backTo);
  }, [dirty, canSave, navigate, backTo]);

  // Android 返回键：
  // 1) 若确认弹层已打开，只关闭它（handler 后注册者优先，因此放在下面）
  // 2) 若有未保存内容，弹确认而不是直接离开
  // 3) 否则交给 Shell 正常回退
  useOverlayBackHandler(dirty && canSave && !discardOpen, () => setDiscardOpen(true));
  useOverlayBackHandler(discardOpen, () => setDiscardOpen(false));

  const recipientName = targetContact?.name || event?.contact_name || '未关联联系人';

  if (loading && !subject && !body) {
    return (
      <>
        <MobileHeader title="邮件草稿" onBack={() => navigate(backTo)} />
        <div className="py-24 flex justify-center"><Spin /></div>
      </>
    );
  }

  return (
    <>
      <MobileHeader
        title="邮件草稿"
        subtitle={`收件人：${recipientName}`}
        onBack={requestLeave}
        right={canSave ? (
          <button
            type="button"
            onClick={saveDraft}
            disabled={saving}
            className="px-3.5 h-11 rounded-lg bg-[#1677FF] text-white text-sm font-medium
              border-0 cursor-pointer disabled:opacity-50"
          >
            {saving ? '保存中' : '保存'}
          </button>
        ) : (
          <span className="text-xs text-slate-400 px-2">仅预览</span>
        )}
      />

      <div className="px-4 pt-3">
        {/* 收件人（只读展示） */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3.5 mb-3">
          <p className="text-[11px] text-slate-400 mb-1">收件人</p>
          <p className="text-sm text-slate-800 font-medium">{recipientName}</p>
          {targetContact?.email && (
            <p className="text-xs text-slate-400 mt-0.5">{targetContact.email}</p>
          )}
          {!canSave && (
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              邮件草稿需要绑定到一条日程。这里可以先生成并预览内容，
              如需保存请从日程卡片的「邮件草稿」进入。
            </p>
          )}
          {canSave && !event?.contact_id && (
            <p className="text-[11px] text-amber-500 mt-1.5">
              该日程未关联联系人，保存后仅作为草稿记录
            </p>
          )}
        </div>

        {/* 编辑 / 预览 切换 */}
        <div className="flex items-center justify-between mb-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { label: '编辑', value: 'edit' },
              { label: '预览', value: 'preview' },
            ]}
            className="!rounded-full"
          />
          {tab === 'preview' && (
            <button
              type="button"
              onClick={refreshPreview}
              disabled={loading}
              className="text-xs text-[#1677FF] border-0 bg-transparent cursor-pointer py-2 px-2
                disabled:opacity-50"
            >
              {loading ? '生成中…' : '刷新预览'}
            </button>
          )}
        </div>

        {loadError && (
          <div className="mb-3 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-xs text-amber-600">
              未能生成默认内容，你可以直接手动填写主题与正文。
            </p>
          </div>
        )}

        {/* 编辑 */}
        {tab === 'edit' && (
          <div className="space-y-3 pb-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3.5">
              <label className="text-[11px] text-slate-400 block mb-1.5">主题</label>
              <Input
                size="large"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="邮件主题"
              />
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3.5">
              <label className="text-[11px] text-slate-400 block mb-1.5">正文</label>
              <Input.TextArea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                autoSize={{ minRows: 10, maxRows: 22 }}
                placeholder="邮件正文"
              />
            </div>
            <p className="text-[11px] text-slate-400 px-1">
              正文以纯文本保存。日程提醒只会发给你自己；点「发送给对方」才会把问候邮件发出去。
            </p>
            {canSave && (
              <button
                type="button"
                onClick={sendToContact}
                disabled={sending || !canSendToContact}
                className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-medium
                  border-0 cursor-pointer disabled:opacity-50"
              >
                {sending ? '发送中…' : canSendToContact ? '发送给对方' : '联系人无邮箱，无法发送'}
              </button>
            )}
          </div>
        )}

        {/* 预览 */}
        {tab === 'preview' && (
          <div className="bg-slate-100 rounded-2xl p-3 pb-4">
            {loading ? (
              <div className="py-16 flex justify-center"><Spin /></div>
            ) : previewHtml ? (
              <div
                className="bg-white rounded-xl overflow-hidden"
                // 已通过 sanitizeEmailHtml 净化：剥离 script / 事件属性 / javascript: / iframe
                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(previewHtml) }}
              />
            ) : (
              <p className="text-xs text-slate-400 py-12 text-center">
                暂无预览内容，点右上角「刷新预览」生成
              </p>
            )}
          </div>
        )}
      </div>

      {/* 离开确认 */}
      {discardOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDiscardOpen(false)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
            <h3 className="text-base font-semibold text-slate-800 mb-2">放弃未保存的修改？</h3>
            <p className="text-xs text-slate-500 mb-4">
              你的主题与正文改动尚未保存，返回后将丢失。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDiscardOpen(false)}
                className="flex-1 min-h-[46px] rounded-xl bg-slate-100 text-slate-600 text-sm
                  font-medium border-0 cursor-pointer"
              >
                继续编辑
              </button>
              <button
                type="button"
                onClick={() => { setDiscardOpen(false); navigate(backTo); }}
                className="flex-1 min-h-[46px] rounded-xl bg-red-500 text-white text-sm
                  font-medium border-0 cursor-pointer"
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default MobileMailEditorPage;
