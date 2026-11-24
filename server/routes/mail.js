const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { renderCareEmail, sendCareHtmlEmail } = require('../services/emailService');
const { logInteraction } = require('../services/interactions');
const { mailLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(authMiddleware);

router.post('/preview', mailLimiter, async (req, res) => {
  try {
    const { eventId, contactId, event = {}, contact = {}, bodyOverride } = req.body;
    const data = await loadMailContext(req.user.id, eventId, contactId, event, contact);
    const preview = renderCareEmail({ event: data.event, contact: data.contact, bodyOverride });
    res.json({ success: true, data: preview });
  } catch (err) {
    console.error('Mail preview error:', err);
    res.status(500).json({ success: false, message: '生成邮件预览失败' });
  }
});

router.put('/events/:id/draft', async (req, res) => {
  try {
    const { subject, body } = req.body;
    const [events] = await pool.query(
      'SELECT id, contact_id FROM events WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (events.length === 0) {
      return res.status(404).json({ success: false, message: '事件不存在' });
    }

    await pool.query(
      `UPDATE events
       SET mail_subject = ?, mail_body_override = ?, mail_status = 'draft'
       WHERE id = ? AND user_id = ?`,
      [subject || null, body || null, req.params.id, req.user.id]
    );
    await logInteraction(pool, {
      userId: req.user.id,
      contactId: events[0].contact_id || null,
      eventId: req.params.id,
      actionType: 'mail_draft',
      title: subject || '邮件草稿已调整',
      detail: body || null,
    });
    res.json({ success: true, message: '邮件草稿已保存' });
  } catch (err) {
    console.error('Save mail draft error:', err);
    res.status(500).json({ success: false, message: '保存邮件草稿失败' });
  }
});

/**
 * Explicitly send care email TO the contact.
 * Reminder cron never does this — user must tap「发送给对方」.
 */
router.post('/events/:id/send', mailLimiter, async (req, res) => {
  try {
    const { subject, body } = req.body || {};
    const [rows] = await pool.query(
      `SELECT e.*, c.name AS contact_name, c.email AS contact_email,
              c.department AS contact_department, c.role AS contact_role
       FROM events e
       LEFT JOIN contacts c ON c.id = e.contact_id AND c.user_id = e.user_id
       WHERE e.id = ? AND e.user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '事件不存在' });
    }
    const event = rows[0];
    if (!event.contact_id) {
      return res.status(400).json({ success: false, message: '该日程未关联联系人，无法发送问候邮件' });
    }
    if (!event.contact_email) {
      return res.status(400).json({ success: false, message: '联系人未填写邮箱，无法发送。可先补邮箱，或改用「提醒我自己」' });
    }

    // Persist draft fields if provided, then render
    if (subject !== undefined || body !== undefined) {
      await pool.query(
        `UPDATE events
         SET mail_subject = COALESCE(?, mail_subject),
             mail_body_override = COALESCE(?, mail_body_override),
             mail_status = 'draft'
         WHERE id = ? AND user_id = ?`,
        [subject ?? null, body ?? null, event.id, req.user.id]
      );
      if (subject !== undefined) event.mail_subject = subject;
      if (body !== undefined) event.mail_body_override = body;
    }

    const preview = renderCareEmail({
      contact: {
        name: event.contact_name,
        email: event.contact_email,
        department: event.contact_department,
        role: event.contact_role,
      },
      event: {
        title: event.title,
        start_time: event.start_time,
        event_type: event.event_type,
        mail_subject: event.mail_subject,
        mail_body_override: event.mail_body_override,
      },
      bodyOverride: body !== undefined ? body : event.mail_body_override,
    });

    await sendCareHtmlEmail(event.contact_email, preview.subject, preview.body, preview.html);
    await pool.query(
      `UPDATE events SET mail_status = 'sent', mail_subject = ?, mail_body_override = ? WHERE id = ? AND user_id = ?`,
      [preview.subject, preview.body, event.id, req.user.id]
    );
    await logInteraction(pool, {
      userId: req.user.id,
      contactId: event.contact_id,
      eventId: event.id,
      actionType: 'mail_sent',
      title: preview.subject,
      detail: `问候邮件已发送至 ${event.contact_email}`,
    });

    res.json({ success: true, message: `已发送给 ${event.contact_name || event.contact_email}` });
  } catch (err) {
    console.error('Send mail error:', err);
    res.status(500).json({ success: false, message: err.message || '发送失败' });
  }
});

async function loadMailContext(userId, eventId, contactId, event, contact) {
  let finalEvent = event || {};
  let finalContact = contact || {};

  if (eventId) {
    const [events] = await pool.query('SELECT * FROM events WHERE id = ? AND user_id = ?', [eventId, userId]);
    if (events.length) finalEvent = events[0];
  }

  const resolvedContactId = contactId || finalEvent.contact_id;
  if (resolvedContactId) {
    const [contacts] = await pool.query('SELECT * FROM contacts WHERE id = ? AND user_id = ?', [resolvedContactId, userId]);
    if (contacts.length) finalContact = contacts[0];
  }

  return { event: finalEvent, contact: finalContact };
}

module.exports = router;
