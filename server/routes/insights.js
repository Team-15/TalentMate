const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

/**
 * 关注等级对频率的影响。
 *
 * 基准按关系圈分档：家人更紧、熟人更松；care_level 再做缩放。
 */
const CARE_WEIGHT = { high: 0.6, normal: 1, low: 1.5 };
const CARE_LABEL = { high: '重点联系人', normal: '', low: '低优先' };
const CIRCLE_LABEL = { family: '家人', friend: '朋友', acquaintance: '熟人' };

/** 关系圈默认频率（normal 等级） */
const CIRCLE_BASE = {
  family: { warn: 14, danger: 21 },
  friend: { warn: 30, danger: 45 },
  acquaintance: { warn: 60, danger: 90 },
};

/** 只有这些动作算「真实联系」——建日程/草稿不算 */
const REAL_INTERACTION_TYPES = ['reached_out', 'mail_sent'];

/** 旧职场类型兼容映射 */
function normalizeCircle(contactType) {
  if (contactType === 'family') return 'family';
  if (contactType === 'acquaintance' || contactType === 'candidate') return 'acquaintance';
  return 'friend';
}

/** 计算某个联系人的提醒频率；自定义值优先于等级预设 */
function thresholdsFor(contact) {
  const circle = normalizeCircle(contact.contact_type);
  const weight = CARE_WEIGHT[contact.care_level] ?? 1;
  const base = CIRCLE_BASE[circle] || CIRCLE_BASE.friend;

  let warnAt = Math.max(1, Math.round(base.warn * weight));
  let dangerAt = Math.max(warnAt + 1, Math.round(base.danger * weight));

  const cw = Number(contact.care_warn_days);
  const cd = Number(contact.care_danger_days);
  const customWarn = Number.isInteger(cw) && cw > 0;
  const customDanger = Number.isInteger(cd) && cd > 0;
  if (customWarn) warnAt = cw;
  if (customDanger) dangerAt = Math.max(warnAt + 1, cd);

  return { circle, warnAt, dangerAt, weight, custom: customWarn || customDanger };
}

router.get('/relationship-heatmap', async (req, res) => {
  try {
    const realTypes = REAL_INTERACTION_TYPES.map(() => '?').join(',');
    const [contacts] = await pool.query(
      `SELECT c.*,
              MAX(CASE WHEN l.action_type IN (${realTypes}) AND l.occurred_at <= NOW()
                       THEN l.occurred_at ELSE NULL END) AS last_real_at,
              MIN(CASE WHEN e.start_time > NOW() THEN e.start_time ELSE NULL END) AS next_event_at,
              COUNT(DISTINCT CASE WHEN e.start_time > NOW() THEN e.id END) AS upcoming_count
       FROM contacts c
       LEFT JOIN events e ON e.contact_id = c.id AND e.user_id = c.user_id
       LEFT JOIN interaction_logs l ON l.contact_id = c.id AND l.user_id = c.user_id
       WHERE c.user_id = ?
       GROUP BY c.id
       ORDER BY last_real_at IS NULL DESC, last_real_at ASC, c.updated_at DESC`,
      [...REAL_INTERACTION_TYPES, req.user.id]
    );

    const now = new Date();
    const data = contacts.map((contact) => {
      const lastRaw = contact.last_real_at || null;
      const last = lastRaw ? new Date(String(lastRaw).replace(' ', 'T')) : null;
      const next = contact.next_event_at ? new Date(String(contact.next_event_at).replace(' ', 'T')) : null;
      const hasUpcoming = !!next;
      const days = last ? Math.floor((now - last) / 86400000) : null;
      const { circle, warnAt, dangerAt, custom } = thresholdsFor(contact);

      // Care status from REAL interactions only — upcoming schedule does NOT override danger/warning
      let status = 'healthy';
      if (days === null) status = 'new';
      else if (days >= dangerAt) status = 'danger';
      else if (days >= warnAt) status = 'warning';
      else status = 'healthy';

      // For grouping: people who are fine but have upcoming go to "scheduled"
      let displayStatus = status;
      if ((status === 'healthy' || status === 'new') && hasUpcoming) {
        displayStatus = 'scheduled';
      }

      return {
        ...contact,
        last_interaction_at: lastRaw,
        next_event_at: contact.next_event_at,
        days_since_interaction: days,
        has_upcoming: hasUpcoming,
        status: displayStatus,
        care_status: status,
        warn_at: warnAt,
        danger_at: dangerAt,
        custom_thresholds: custom,
        reason: buildReason(contact, status, days, circle, next, hasUpcoming),
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Heatmap error:', err);
    res.status(500).json({ success: false, message: '获取关怀热力图失败' });
  }
});

/**
 * Birthday / anniversary suggestions for the next N days (default 7).
 * Does not create events — front-end shows suggestion cards.
 */
router.get('/upcoming-dates', async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    const [contacts] = await pool.query(
      `SELECT id, name, email, phone, contact_type, birthday, onboard_date, avatar_color, care_level
       FROM contacts
       WHERE user_id = ?
         AND (birthday IS NOT NULL OR onboard_date IS NOT NULL)`,
      [req.user.id]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const suggestions = [];

    for (const c of contacts) {
      for (const [field, kind, label] of [
        ['birthday', 'birthday', '生日'],
        ['onboard_date', 'anniversary', '相识纪念日'],
      ]) {
        if (!c[field]) continue;
        const next = nextOccurrence(c[field], today);
        if (!next) continue;
        const diff = Math.round((next - today) / 86400000);
        if (diff < 0 || diff > days) continue;
        suggestions.push({
          contact_id: c.id,
          name: c.name,
          avatar_color: c.avatar_color,
          contact_type: c.contact_type,
          care_level: c.care_level,
          kind,
          label,
          date: formatDate(next),
          days_until: diff,
          source_date: c[field],
        });
      }
    }

    suggestions.sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name, 'zh'));
    res.json({ success: true, data: suggestions });
  } catch (err) {
    console.error('Upcoming dates error:', err);
    res.status(500).json({ success: false, message: '获取生日/纪念日失败' });
  }
});

/**
 * Festival suggestion cards for the next N days.
 * Static list — no external calendar sync.
 */
router.get('/upcoming-festivals', async (req, res) => {
  try {
    const days = Math.min(45, Math.max(1, parseInt(req.query.days, 10) || 14));
    const year = new Date().getFullYear();
    const festivals = buildFestivalTable(year);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = festivals
      .map((f) => {
        const d = new Date(`${f.date}T00:00:00`);
        const diff = Math.round((d - today) / 86400000);
        return { ...f, days_until: diff };
      })
      .filter((f) => f.days_until >= 0 && f.days_until <= days)
      .sort((a, b) => a.days_until - b.days_until);

    // Suggest high-care contacts for festival greetings
    const [focus] = await pool.query(
      `SELECT id, name, avatar_color, contact_type, care_level
       FROM contacts
       WHERE user_id = ? AND (care_level = 'high' OR contact_type = 'family')
       ORDER BY care_level = 'high' DESC, contact_type = 'family' DESC, updated_at DESC
       LIMIT 8`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        festivals: upcoming,
        suggested_contacts: focus,
      },
    });
  } catch (err) {
    console.error('Upcoming festivals error:', err);
    res.status(500).json({ success: false, message: '获取节日建议失败' });
  }
});

function buildReason(contact, status, days, circle, next, hasUpcoming) {
  const tag = CARE_LABEL[contact.care_level] || '';
  const circleLabel = CIRCLE_LABEL[circle] || '';
  const withTag = (text) => (tag ? `${tag} · ${text}` : text);
  const upcomingBit = hasUpcoming && next ? `（已安排 ${formatShort(next)}）` : '';

  if (status === 'new') {
    return withTag(hasUpcoming ? `尚未记录真实联系${upcomingBit}` : '尚未记录真实联系');
  }
  if (status === 'healthy') {
    return withTag(`最近 ${days} 天内有联系${upcomingBit}`);
  }
  if (status === 'warning') {
    return withTag(
      circleLabel
        ? `${circleLabel} · ${days} 天未联系${upcomingBit}`
        : `${days} 天未联系${upcomingBit}`
    );
  }
  return withTag(
    circleLabel
      ? `${circleLabel} · ${days} 天未问候，建议安排联系${upcomingBit}`
      : `${days} 天未关怀，建议安排联系${upcomingBit}`
  );
}

function nextOccurrence(dateValue, today) {
  const raw = String(dateValue).slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!month || !day) return null;
  let candidate = new Date(today.getFullYear(), month - 1, day);
  candidate.setHours(0, 0, 0, 0);
  if (candidate < today) {
    candidate = new Date(today.getFullYear() + 1, month - 1, day);
    candidate.setHours(0, 0, 0, 0);
  }
  return candidate;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShort(date) {
  if (!date || Number.isNaN(date.getTime())) return '未来';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}/${d} ${h}:${min}`;
}

/** Small static festival table (solar dates). Covers common CN + western greetings. */
function buildFestivalTable(year) {
  return [
    { key: 'new_year', name: '元旦', date: `${year}-01-01` },
    { key: 'valentine', name: '情人节', date: `${year}-02-14` },
    { key: 'women', name: '妇女节', date: `${year}-03-08` },
    { key: 'labor', name: '劳动节', date: `${year}-05-01` },
    { key: 'youth', name: '青年节', date: `${year}-05-04` },
    { key: 'children', name: '儿童节', date: `${year}-06-01` },
    { key: 'mid_approx', name: '中秋（公历参考）', date: `${year}-09-17` },
    { key: 'national', name: '国庆节', date: `${year}-10-01` },
    { key: 'christmas', name: '圣诞节', date: `${year}-12-25` },
    // also next year's new year for late-December windows
    { key: 'new_year_next', name: '元旦', date: `${year + 1}-01-01` },
  ];
}

module.exports = router;
