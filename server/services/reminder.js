/**
 * Reminder Service.
 * Scans every 15 seconds for events needing reminders.
 *
 * Personal-care product rule: reminders always go to the USER (self).
 * Care emails to contacts are never auto-sent here — only via explicit send API.
 */
const { sendReminderEmail } = require('./emailService');

let pool = null;
let intervalId = null;

/**
 * Initialize the reminder scheduler.
 * Called once when the server starts.
 */
function initReminder(dbPool) {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  pool = dbPool || require('../db');
  console.log('[Reminder] Running startup check...');
  checkAndSendReminders();
  intervalId = setInterval(() => checkAndSendReminders(), 15000);
  console.log('[Reminder] Scheduler started (every 15 seconds)');
}

/**
 * Query events that need reminders and process them.
 */
async function checkAndSendReminders() {
  if (!pool) return;

  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const threshold = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    console.log('[Reminder] Threshold:', threshold);

    const [events] = await pool.query(`
      SELECT e.*, u.email, u.username,
             c.name AS contact_name, c.email AS contact_email
      FROM events e
      JOIN users u ON e.user_id = u.id
      LEFT JOIN contacts c ON c.id = e.contact_id AND c.user_id = e.user_id
      WHERE e.reminded = 0
        AND DATE_SUB(e.start_time, INTERVAL e.reminder MINUTE) <= ?
    `, [threshold]);

    console.log(`[Reminder] Scan found ${events.length} event(s)`);

    for (const event of events) {
      try {
        // Always remind the owner — never auto-email the contact.
        const title = event.contact_name
          ? `${event.title}（联系 ${event.contact_name}）`
          : event.title;
        console.log('[Reminder] Sending self reminder for:', event.title, 'to', event.email);
        if (event.email) {
          await sendReminderEmail(
            event.email,
            title,
            formatDateTimeStr(event.start_time),
            event.reminder
          );
        }

        // If bound to a contact and no mail yet, leave a draft slot for optional send-to-contact
        if (event.contact_id && (!event.mail_status || event.mail_status === 'none')) {
          await pool.query(
            `UPDATE events SET mail_status = 'draft' WHERE id = ? AND user_id = ?`,
            [event.id, event.user_id]
          );
        }

        await pool.query('UPDATE events SET reminded = 1 WHERE id = ?', [event.id]);
        console.log(`[Reminder] Processed event #${event.id}: "${event.title}" for user ${event.username}`);
      } catch (err) {
        console.error(`[Reminder] 事件 #${event.id} 提醒失败（不再重试）：${err.message}`);
        await pool.query('UPDATE events SET reminded = 1 WHERE id = ?', [event.id])
          .catch((e2) => console.error('[Reminder] 标记失败状态时出错:', e2.message));
      }
    }
  } catch (err) {
    console.error('[Reminder] Error checking reminders:', err);
  }
}

/**
 * Format a Date or date string to "YYYY-MM-DD HH:mm".
 */
function formatDateTimeStr(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

module.exports = { initReminder, checkAndSendReminders };
