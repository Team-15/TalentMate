const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { logInteraction } = require('../services/interactions');

const router = express.Router();
router.use(authMiddleware);

const CHECK_IN_CHANNELS = {
  call: { title: '打了电话', label: '打电话了' },
  wechat: { title: '发了微信', label: '发微信了' },
  meet: { title: '见了面', label: '见面了' },
  other: { title: '联系过了', label: '刚刚联系过' },
};

const COLORS = ['#1677FF', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'];

/**
 * 人工关注等级。参与关怀热度加权（见 routes/insights.js）：
 *   high   重点联系人 —— 更早进入「需关注 / 高优先级」
 *   normal 普通
 *   low    低优先 —— 更晚提醒
 */
const CARE_LEVELS = ['high', 'normal', 'low'];

/** 把中文/别名统一成内部值；无法识别时原样返回，交给 validateContact 报错 */
function normalizeCareLevel(value) {
  const v = clean(value).toLowerCase();
  if (!v) return 'normal';
  if (['重点', '重点关注', '重点联系人', 'high'].includes(v)) return 'high';
  if (['低', '低优先', '低优先级', 'low'].includes(v)) return 'low';
  if (['普通', '一般', 'normal'].includes(v)) return 'normal';
  return v;
}

/**
 * 自定义阈值（天）。留空表示沿用等级推导出来的预设值。
 * 只接受正整数，其他一律当"未设置"，交给 validateContact 拦非法值。
 */
function normalizeDays(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

router.get('/', async (req, res) => {
  try {
    const { keyword, type } = req.query;
    let sql = 'SELECT * FROM contacts WHERE user_id = ?';
    const params = [req.user.id];
    if (keyword) {
      sql += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR department LIKE ? OR role LIKE ?)';
      const q = `%${keyword}%`;
      params.push(q, q, q, q, q);
    }
    if (type && type !== 'all') {
      sql += ' AND contact_type = ?';
      params.push(type);
    }
    sql += ' ORDER BY updated_at DESC, id DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Get contacts error:', err);
    res.status(500).json({ success: false, message: '获取名册失败' });
  }
});

/**
 * Append a relationship memory (does NOT reset heatmap days).
 * POST /api/contacts/:id/memories  { text: string }
 */
router.post('/:id/memories', async (req, res) => {
  try {
    const contactId = req.params.id;
    const text = clean(req.body?.text || req.body?.note);
    if (!text) {
      return res.status(400).json({ success: false, message: '请填写记忆内容' });
    }
    const [contactRows] = await pool.query(
      'SELECT id, name FROM contacts WHERE id = ? AND user_id = ?',
      [contactId, req.user.id]
    );
    if (contactRows.length === 0) {
      return res.status(404).json({ success: false, message: '联系人不存在' });
    }
    await logInteraction(pool, {
      userId: req.user.id,
      contactId: Number(contactId),
      eventId: null,
      actionType: 'memory',
      title: `关于 ${contactRows[0].name} 的记忆`,
      detail: text,
    });
    res.status(201).json({ success: true, message: '记忆已保存' });
  } catch (err) {
    console.error('Memory error:', err);
    res.status(500).json({ success: false, message: '保存记忆失败' });
  }
});

/**
 * One-tap check-in: record a real contact moment for heatmap.
 * POST /api/contacts/:id/check-in  { channel?: call|wechat|meet|other, note?: string }
 */
router.post('/:id/check-in', async (req, res) => {
  try {
    const contactId = req.params.id;
    const [contactRows] = await pool.query(
      'SELECT id, name FROM contacts WHERE id = ? AND user_id = ?',
      [contactId, req.user.id]
    );
    if (contactRows.length === 0) {
      return res.status(404).json({ success: false, message: '联系人不存在' });
    }
    const channel = String(req.body?.channel || 'other').toLowerCase();
    const meta = CHECK_IN_CHANNELS[channel] || CHECK_IN_CHANNELS.other;
    const note = clean(req.body?.note) || null;
    const title = `${meta.title} · ${contactRows[0].name}`;
    await logInteraction(pool, {
      userId: req.user.id,
      contactId: Number(contactId),
      eventId: null,
      actionType: 'reached_out',
      title,
      detail: note,
    });
    res.status(201).json({
      success: true,
      message: `已记录：${meta.label}`,
      data: { action_type: 'reached_out', channel: CHECK_IN_CHANNELS[channel] ? channel : 'other', title },
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ success: false, message: '记录联系失败' });
  }
});

router.get('/:id/timeline', async (req, res) => {
  try {
    const contactId = req.params.id;
    const [contactRows] = await pool.query(
      'SELECT * FROM contacts WHERE id = ? AND user_id = ?',
      [contactId, req.user.id]
    );
    if (contactRows.length === 0) {
      return res.status(404).json({ success: false, message: '联系人不存在' });
    }

    const [logs] = await pool.query(
      `SELECT l.*, e.start_time, e.end_time, e.event_type, e.mail_status
       FROM interaction_logs l
       LEFT JOIN events e ON e.id = l.event_id
       WHERE l.user_id = ? AND l.contact_id = ?
         AND NOT (
           l.action_type IN ('event_created', 'event_updated', 'mail_draft')
           AND e.id IS NULL
         )
       ORDER BY l.occurred_at DESC, l.id DESC`,
      [req.user.id, contactId]
    );

    const [events] = await pool.query(
      `SELECT id, title, start_time AS occurred_at, event_type, mail_status
       FROM events
       WHERE user_id = ? AND contact_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM interaction_logs l
           WHERE l.event_id = events.id AND l.user_id = events.user_id
         )
       ORDER BY start_time DESC`,
      [req.user.id, contactId]
    );

    res.json({ success: true, data: { contact: contactRows[0], logs, events } });
  } catch (err) {
    console.error('Timeline error:', err);
    res.status(500).json({ success: false, message: '获取时间线失败' });
  }
});

/**
 * 查找同一用户下是否已存在该邮箱的联系人（邮箱大小写不敏感）。
 *
 * BUG-009：此前没有任何重复校验，姓名与邮箱完全相同的联系人也能源源不断地创建，
 * 语音候选列表因此出现无法区分的重复对象。
 * 规则（与测试报告的"联系人数据规则建议"一致）：
 *   - 同名、不同邮箱 → 允许，属于两个不同的人
 *   - 邮箱相同（含完全相同）→ 拒绝，属于同一身份
 *
 * @param {number} userId 当前用户
 * @param {string} email 待检查邮箱
 * @param {number|null} excludeId 更新时排除自身
 * @returns {Promise<object|null>} 已存在的联系人行
 */
async function findDuplicateByEmail(userId, email, excludeId = null) {
  if (!email) return null;
  let sql = 'SELECT id, name, email FROM contacts WHERE user_id = ? AND LOWER(email) = LOWER(?)';
  const params = [userId, email];
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return rows.length ? rows[0] : null;
}

/** 组装重复联系人的提示语，让用户知道撞的是哪一条 */
function duplicateMessage(existing) {
  const who = existing.name ? `「${existing.name}」` : '该';
  return `${who}邮箱已存在于名册中，请勿重复录入`;
}

router.post('/', async (req, res) => {
  try {
    const payload = normalizeContact(req.body, req.user.id);
    const validation = validateContact(payload);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    // BUG-009：邮箱重复直接拒绝，避免重复提交与人工重复录入产生同一身份
    const duplicate = await findDuplicateByEmail(req.user.id, payload.email);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_CONTACT',
        message: duplicateMessage(duplicate),
        data: { id: duplicate.id, name: duplicate.name },
      });
    }
    const [result] = await pool.query(
      `INSERT INTO contacts
       (user_id, name, email, phone, contact_type, department, role, birthday, onboard_date, avatar_color, care_level, care_warn_days, care_danger_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.user_id,
        payload.name,
        payload.email,
        payload.phone,
        payload.contact_type,
        payload.department,
        payload.role,
        payload.birthday,
        payload.onboard_date,
        payload.avatar_color,
        payload.care_level,
        payload.care_warn_days,
        payload.care_danger_days,
        payload.notes,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM contacts WHERE id = ? AND user_id = ?', [result.insertId, req.user.id]);
    res.status(201).json({ success: true, message: '联系人已添加', data: rows[0] });
  } catch (err) {
    console.error('Create contact error:', err);
    res.status(500).json({ success: false, message: '添加联系人失败' });
  }
});

router.post('/import-csv', async (req, res) => {
  try {
    const csv = req.body.csv || '';
    const rows = parseCsv(csv);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'CSV 内容为空' });
    }

    let inserted = 0;
    let skipped = 0;
    let duplicated = 0;
    for (const row of rows) {
      const payload = normalizeContact(row, req.user.id);
      const validation = validateContact(payload);
      if (!validation.valid) {
        skipped += 1;
        continue;
      }
      // 与手动新增使用同一套规则：邮箱已存在就跳过，而不是插入一条重复身份
      if (await findDuplicateByEmail(req.user.id, payload.email)) {
        duplicated += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO contacts
         (user_id, name, email, phone, contact_type, department, role, birthday, onboard_date, avatar_color, care_level, care_warn_days, care_danger_days, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.user_id,
          payload.name,
          payload.email,
          payload.phone,
          payload.contact_type,
          payload.department,
          payload.role,
          payload.birthday,
          payload.onboard_date,
          payload.avatar_color,
          payload.care_level,
          payload.care_warn_days,
          payload.care_danger_days,
          payload.notes,
        ]
      );
      inserted += 1;
    }
    const notes = [];
    if (skipped) notes.push(`跳过 ${skipped} 行无效数据`);
    if (duplicated) notes.push(`跳过 ${duplicated} 条已存在联系人`);
    res.json({
      success: true,
      message: `已导入 ${inserted} 位联系人${notes.length ? `，${notes.join('，')}` : ''}`,
      data: { inserted, skipped, duplicated },
    });
  } catch (err) {
    console.error('Import contacts error:', err);
    res.status(500).json({ success: false, message: '导入失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const payload = normalizeContact(req.body, req.user.id);
    const validation = validateContact(payload);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }
    // 更新时排除自身，避免"只改备注但邮箱不变"被自己的旧记录判为重复
    const duplicate = await findDuplicateByEmail(req.user.id, payload.email, req.params.id);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_CONTACT',
        message: duplicateMessage(duplicate),
        data: { id: duplicate.id, name: duplicate.name },
      });
    }
    const [result] = await pool.query(
      `UPDATE contacts
       SET name = ?, email = ?, phone = ?, contact_type = ?, department = ?, role = ?,
           birthday = ?, onboard_date = ?, avatar_color = ?, care_level = ?,
           care_warn_days = ?, care_danger_days = ?, notes = ?
       WHERE id = ? AND user_id = ?`,
      [
        payload.name,
        payload.email,
        payload.phone,
        payload.contact_type,
        payload.department,
        payload.role,
        payload.birthday,
        payload.onboard_date,
        payload.avatar_color,
        payload.care_level,
        payload.care_warn_days,
        payload.care_danger_days,
        payload.notes,
        req.params.id,
        req.user.id,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '联系人不存在' });
    }
    const [rows] = await pool.query('SELECT * FROM contacts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true, message: '联系人已更新', data: rows[0] });
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ success: false, message: '更新联系人失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE events SET contact_id = NULL WHERE user_id = ? AND contact_id = ?', [req.user.id, req.params.id]);
    const [result] = await pool.query('DELETE FROM contacts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '联系人不存在' });
    }
    res.json({ success: true, message: '联系人已删除' });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ success: false, message: '删除联系人失败' });
  }
});

function normalizeContact(body, userId) {
  const name = body.name || body['姓名'];
  const type = body.contactType || body.contact_type || body.type || body['类型'] || body['关系圈'];
  const contactType = normalizeContactType(clean(type));
  return {
    user_id: userId,
    name: clean(name),
    email: clean(body.email || body['邮箱']) || null,
    phone: clean(body.phone || body.mobile || body['电话'] || body['手机']) || null,
    contact_type: contactType || 'friend',
    // department 语义：关系圈/怎么认识；兼容旧 CSV「部门」列
    department: clean(
      body.department || body.circle || body['关系圈'] || body['怎么认识'] || body['部门']
    ) || null,
    // role 语义：称呼/备注角色；兼容旧 CSV「岗位/职位」列
    role: clean(
      body.role || body.position || body['称呼'] || body['备注角色'] || body['岗位'] || body['职位']
    ) || null,
    birthday: clean(body.birthday || body['生日']) || null,
    // onboard_date 语义：相识日/纪念日；兼容旧「入职时间」
    onboard_date: clean(
      body.onboardDate || body.onboard_date || body.metDate || body['相识日'] || body['纪念日'] || body['入职时间']
    ) || null,
    avatar_color: clean(body.avatarColor || body.avatar_color) || COLORS[Math.floor(Math.random() * COLORS.length)],
    care_level: normalizeCareLevel(body.careLevel || body.care_level || body['关注等级']),
    care_warn_days: normalizeDays(body.careWarnDays ?? body.care_warn_days ?? body['需关注天数']),
    care_danger_days: normalizeDays(body.careDangerDays ?? body.care_danger_days ?? body['高优先级天数']),
    notes: clean(body.notes || body['备注']) || null,
  };
}

/**
 * 关系圈：family / friend / acquaintance。
 * 兼容旧职场枚举：employee→friend，candidate→acquaintance。
 */
function normalizeContactType(value) {
  if (!value) return '';
  const v = String(value).trim().toLowerCase();
  if (['家人', 'family'].includes(v) || value === '家人') return 'family';
  if (['朋友', 'friend'].includes(v) || value === '朋友') return 'friend';
  if (['熟人', 'acquaintance'].includes(v) || value === '熟人') return 'acquaintance';
  // legacy workplace types
  if (['员工', 'employee'].includes(v) || value === '员工') return 'friend';
  if (['候选人', 'candidate'].includes(v) || value === '候选人') return 'acquaintance';
  return v;
}

function validateContact(payload) {
  if (!payload.name) return { valid: false, message: '姓名为必填项' };
  // Email is optional for personal contacts; validate format only when present
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return { valid: false, message: '邮箱格式不正确' };
  }
  if (!['family', 'friend', 'acquaintance'].includes(payload.contact_type)) {
    return { valid: false, message: '类型必须是家人、朋友或熟人' };
  }
  if (!CARE_LEVELS.includes(payload.care_level)) {
    return { valid: false, message: '关注等级必须是「重点 / 普通 / 低」之一' };
  }

  // 自定义阈值：可只填一个，但填了就必须是 1–365 的整数，且「高优先级」要大于「需关注」
  const w = payload.care_warn_days;
  const d = payload.care_danger_days;
  for (const [v, label] of [[w, '需关注天数'], [d, '高优先级天数']]) {
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 365)) {
      return { valid: false, message: `${label}必须是 1–365 的整数，留空表示用预设值` };
    }
  }
  if (w !== null && d !== null && d <= w) {
    return { valid: false, message: '「高优先级天数」必须大于「需关注天数」' };
  }

  return { valid: true };
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseCsv(csv) {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    return row;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

module.exports = router;
