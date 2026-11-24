/**
 * Email Service.
 * Sends reminder emails via nodemailer using SMTP configuration from .env.
 */
const nodemailer = require('nodemailer');

let transporter = null;

/**
 * Initialize the email transporter lazily.
 */
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: parseInt(process.env.SMTP_PORT, 10) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Fix: suppress IPv6 DNS lookup on newer Node.js versions
      dns: { family: 4 },
      connectionTimeout: 15000,
    });
  }
  return transporter;
}

/**
 * Send a reminder email for an event.
 * @param {string} to - Recipient email address
 * @param {string} eventTitle - Event title
 * @param {string} startTime - Event start time (formatted string)
 * @param {number} reminderMinutes - How many minutes before the event
 */
async function sendReminderEmail(to, eventTitle, startTime, reminderMinutes) {
  try {
    const transporter = getTransporter();
    // 该邮件同样会把用户可控内容拼进 HTML，必须转义后再插入，
    // 否则事件标题里若含 <script> / onerror 等内容会被直接渲染。
    const safeTitle = escapeHtml(eventTitle);
    const safeStart = escapeHtml(startTime);
    const safeReminder = escapeHtml(reminderMinutes);
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: `[TalentMate提醒] ${eventTitle}`,
      text: `您好！\n\n您有一个即将开始的安排：\n\n事项：${eventTitle}\n时间：${startTime}\n提前提醒：${reminderMinutes} 分钟\n\n祝您一切顺利！\n\n—— TalentMate 伴贤`,
      html: `
        <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
          <div style="background:linear-gradient(135deg,#1677FF,#0052D9);padding:28px 24px;text-align:center;">
            <span style="font-size:40px;">📅</span>
            <h1 style="color:#fff;font-size:20px;margin:8px 0 0;font-weight:600;">TalentMate 关怀提醒</h1>
          </div>
          <div style="padding:24px;">
            <p style="color:#1E293B;font-size:15px;margin:0 0 16px;">您好，您有一个即将开始的安排：</p>
            <div style="background:#F8FAFD;border-radius:12px;padding:16px;">
              <div style="margin-bottom:10px;">
                <span style="color:#94A3B8;font-size:12px;">事项</span><br>
                <span style="color:#1E293B;font-size:16px;font-weight:600;">${safeTitle}</span>
              </div>
              <div style="margin-bottom:10px;">
                <span style="color:#94A3B8;font-size:12px;">🕐 开始时间</span><br>
                <span style="color:#1E293B;font-size:15px;">${safeStart}</span>
              </div>
              <div>
                <span style="color:#94A3B8;font-size:12px;">⏰ 提前提醒</span><br>
                <span style="color:#1677FF;font-size:14px;font-weight:500;">${safeReminder} 分钟</span>
              </div>
            </div>
            <p style="color:#64748B;font-size:13px;margin:20px 0 0;">祝您一切顺利！</p>
          </div>
          <div style="background:#F5F7FA;padding:12px 24px;text-align:center;">
            <span style="color:#9CA3AF;font-size:11px;">—— TalentMate 伴贤</span>
          </div>
        </div>
      `,
    });
    console.log(`[Email] Reminder sent to ${to}: ${info.messageId}`);
  } catch (err) {
    console.error('[Email] Failed to send reminder:', err.message);
  }
}

function renderCareEmail({ contact = {}, event = {}, bodyOverride = null }) {
  const name = contact.name || '伙伴';
  const eventType = event.event_type || event.eventType || 'general';
  const startTime = event.start_time || event.startTime || '';
  const title = event.title || '沟通安排';
  const subject = event.mail_subject || buildCareSubject(eventType, title, name);
  const body = bodyOverride || event.mail_body_override || buildCareBody(eventType, name, title, startTime);

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #eef2f7;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
      <div style="background:#0f172a;padding:28px 30px;color:#fff;">
        <div style="font-size:13px;opacity:.72;letter-spacing:.04em;text-transform:uppercase;">TalentMate</div>
        <h1 style="font-size:22px;margin:10px 0 0;line-height:1.35;">${escapeHtml(subject)}</h1>
      </div>
      <div style="padding:28px 30px;color:#1e293b;">
        <p style="font-size:16px;margin:0 0 18px;">${escapeHtml(name)}，你好：</p>
        <div style="font-size:15px;line-height:1.8;white-space:pre-line;">${escapeHtml(body)}</div>
        <div style="margin-top:24px;padding:16px 18px;background:#f8fafc;border-radius:12px;border:1px solid #edf2f7;">
          <div style="font-size:12px;color:#64748b;margin-bottom:5px;">安排事项</div>
          <div style="font-size:16px;font-weight:600;color:#0f172a;">${escapeHtml(title)}</div>
          ${startTime ? `<div style="font-size:13px;color:#475569;margin-top:8px;">时间：${escapeHtml(startTime)}</div>` : ''}
        </div>
        <p style="font-size:13px;color:#64748b;margin:24px 0 0;">祝一切顺利。</p>
      </div>
      <div style="background:#f8fafc;padding:14px 30px;color:#94a3b8;font-size:12px;">由 TalentMate 自动生成，可在发送前人工微调。</div>
    </div>
  `;

  return { subject, body, html };
}

function buildCareSubject(eventType, title, name) {
  const map = {
    catch_up: `${name}，想和你聊聊近况`,
    birthday: `${name}，生日快乐`,
    anniversary: `${name}，纪念日快乐`,
    festival: `${name}，节日问候`,
    visit: `${name}，想约你见面`,
    thanks: `${name}，想说声谢谢`,
    // legacy workplace types → personal-friendly subjects
    one_on_one: `${name}，想和你聊聊近况`,
    interview: `${name}，想和你聊一聊`,
    onboarding: `${name}，纪念日问候`,
    offer: `${name}，想和你联系一下`,
    followup: `${name}，想和你聊聊近况`,
  };
  return map[eventType] || title;
}

function buildCareBody(eventType, name, title, startTime) {
  const timeText = startTime ? `时间暂定为 ${startTime}。` : '具体时间我们可以再约。';
  const map = {
    catch_up: `好久没好好聊聊了，想听听你最近过得怎么样，也跟你说说我这边的近况。\n${timeText}`,
    birthday: `今天是属于你的日子。祝你生日快乐，一切顺利，也谢谢你一直以来的陪伴。`,
    anniversary: `今天是一个值得被记住的日子。想和你一起回味这段时光，也送上我的祝福。\n${timeText}`,
    festival: `节日到了，想专门跟你打个招呼，祝你平安喜乐、事事顺心。\n${timeText}`,
    visit: `想约你见面叙叙旧，吃顿饭或随便走走都行。\n${timeText}`,
    thanks: `想专门跟你说一声谢谢。你的帮助和陪伴对我很重要，希望有机会当面再谢一次。\n${timeText}`,
    one_on_one: `好久没好好聊聊了，想听听你最近过得怎么样。\n${timeText}`,
    interview: `想和你找个时间聊一聊近况。\n${timeText}`,
    onboarding: `今天是一个值得被记住的日子，想专门送上问候。\n${timeText}`,
    offer: `想和你联系一下，看看最近过得怎么样。\n${timeText}`,
    followup: `想跟进一下我们之前聊过的事，也顺便听听你近况。\n${timeText}`,
  };
  return map[eventType] || `关于「${title}」，想跟你确认一下安排。\n${timeText}`;
}

/**
 * Explicitly send a care email (HTML) to a contact.
 * Used only when the user taps「发送给对方」— never by the reminder cron.
 */
async function sendCareHtmlEmail(to, subject, text, html) {
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
  });
  console.log(`[Email] Care mail sent to ${to}: ${info.messageId}`);
  return info;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { sendReminderEmail, renderCareEmail, sendCareHtmlEmail };
