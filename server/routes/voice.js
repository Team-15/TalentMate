const express = require('express');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const asrService = require('../services/asr');
const intentParser = require('../services/intentParser');
const pool = require('../db'); // to be created
const { logInteraction } = require('../services/interactions');
const { voiceLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Configure multer for audio upload
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的音频格式'));
    }
  },
});

// POST /api/voice/recognize - Full voice recognition pipeline
// 语音识别消耗腾讯云 ASR + DeepSeek 额度，套用较严格的限流
router.post('/recognize', voiceLimiter, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '未收到音频文件' });
    }

    const audioPath = req.file.path;
    const userId = req.user.id;

    // Step 1: ASR - speech to text
    let transcript;
    try {
      transcript = await asrService.recognize(audioPath);
    } catch (asrErr) {
      console.error('ASR error:', asrErr);
      return res.status(500).json({ success: false, message: '语音识别失败，请重试' });
    }

    if (!transcript || transcript.trim().length === 0) {
      return res.json({ success: false, message: '未识别到语音内容，请再说一遍' });
    }

    // Step 2: Intent parsing via DeepSeek
    let intentResult;
    try {
      intentResult = await intentParser.parse(transcript);
    } catch (parseErr) {
      console.error('Intent parsing error:', parseErr);
      return res.status(500).json({ success: false, message: '网络延迟，请重试' });
    }

    if (!intentResult || intentResult.intent === 'unknown') {
      return res.json({
        success: false,
        message: '没理解您的意思，请再说一遍',
        data: { transcript },
      });
    }
    intentResult.rawTranscript = transcript;

    // Step 3: Execute based on intent
    const result = await executeIntent(userId, intentResult);

    res.json({
      success: true,
      message: result.message,
      data: {
        transcript,
        intent: intentResult,
        eventIds: result.eventIds,
        events: result.events,
        queryDate: result.queryDate,
        deleted: result.deleted || false,
        modified: result.modified || false,
        needsConfirm: result.needsConfirm || false,
        needsContactDisambiguation: result.needsContactDisambiguation || false,
        contactCandidates: result.contactCandidates || [],
        pendingIntent: result.pendingIntent || null,
        contact: result.contact || null,
      },
    });
  } catch (err) {
    console.error('Voice recognize error:', err);
    res.status(500).json({ success: false, message: '处理请求时出错，请稍后重试' });
  }
});

// POST /api/voice/resolve-contact - Continue a voice add flow after user chooses a contact.
router.post('/resolve-contact', async (req, res) => {
  try {
    const { contactId, pendingIntent } = req.body;
    if (!contactId || !pendingIntent) {
      return res.status(400).json({ success: false, message: '缺少联系人或待处理意图' });
    }
    const [contacts] = await pool.query('SELECT * FROM contacts WHERE id = ? AND user_id = ?', [contactId, req.user.id]);
    if (contacts.length === 0) {
      return res.status(404).json({ success: false, message: '联系人不存在' });
    }
    const result = await executeIntent(req.user.id, {
      ...pendingIntent,
      resolvedContactId: Number(contactId),
      resolvedContact: contacts[0],
    });
    res.json({
      success: true,
      message: result.message,
      data: {
        intent: pendingIntent,
        eventIds: result.eventIds,
        events: result.events,
        contact: contacts[0],
      },
    });
  } catch (err) {
    console.error('Resolve contact error:', err);
    res.status(500).json({ success: false, message: '联系人绑定失败' });
  }
});

/**
 * Execute business logic based on parsed intent.
 */
async function executeIntent(userId, intentResult) {
  const { intent, queryKeywords, queryDate } = intentResult;
  const events = intentResult.events || [];

  switch (intent) {
    case 'add': {
      if (events.length === 0) {
        return { message: '未识别到事件信息，请再说一遍' };
      }
      const contactResolution = await resolveContact(userId, intentResult);
      if (contactResolution.needsContactDisambiguation) {
        return {
          message: `找到${contactResolution.candidates.length}位「${contactResolution.contactName}」，请选择具体对象`,
          needsContactDisambiguation: true,
          contactCandidates: contactResolution.candidates,
          pendingIntent: intentResult,
        };
      }
      const contact = contactResolution.contact;
      let contactId = contact?.id || null;
      // 校验联系人是否真的存在：voice 结果可能被缓存（resolvedContactId），
      // 而联系人可能已被删除 —— 直接拿旧 id 去建日程会触发外键约束失败，
      // 整个请求以 500 结束。这里退化为「无关联日程」，而不是让用户看到服务器错误。
      if (contactId) {
        const [alive] = await pool.query(
          'SELECT id FROM contacts WHERE id = ? AND user_id = ?',
          [contactId, userId]
        );
        if (alive.length === 0) {
          console.warn(`[Voice] contact ${contactId} 不存在或不属于用户 ${userId}，改为不关联联系人`);
          contactId = null;
        }
      }
      const eventType = normalizeEventType(intentResult.eventType || events[0]?.eventType || inferEventType(events[0]?.title || ''));

      const insertedIds = [];
      const insertedEvents = [];
      for (const ev of events) {
        console.log('[Voice] ADD event:', { userId, ...ev });
        const [result] = await pool.query(
          `INSERT INTO events
           (user_id, title, start_time, end_time, reminder, contact_id, event_type, mail_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, ev.title, ev.startTime, ev.endTime || null, ev.reminderMinutes || 10, contactId, eventType, contactId ? 'draft' : 'none']
        );
        insertedIds.push(result.insertId);
        const eventRecord = {
          id: result.insertId,
          user_id: userId,
          title: ev.title,
          start_time: ev.startTime,
          end_time: ev.endTime || null,
          reminder: ev.reminderMinutes || 10,
          contact_id: contactId,
          event_type: eventType,
          mail_status: contactId ? 'draft' : 'none',
          contact_name: contact?.name || null,
          contact_email: contact?.email || null,
          contact_department: contact?.department || null,
          contact_role: contact?.role || null,
          contact_avatar_color: contact?.avatar_color || null,
        };
        insertedEvents.push(eventRecord);
        if (contactId) {
          await logInteraction(pool, {
            userId,
            contactId,
            eventId: result.insertId,
            actionType: 'event_created',
            title: ev.title,
            detail: `语音创建 ${eventType} 日程`,
            occurredAt: ev.startTime,
          });
        }
        console.log('[Voice] INSERT result:', result.insertId);
      }
      // Immediately trigger reminder check after voice creation
      const { checkAndSendReminders } = require('../services/reminder');
      setTimeout(() => checkAndSendReminders(), 600);

      const titles = events.map(e => {
        const d = new Date(e.startTime?.replace(' ', 'T') || '');
        const timeStr = d instanceof Date && !isNaN(d) ? d.toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
        return `「${e.title}」${timeStr}`;
      }).join('、');
      const detail = events.length === 1 && titles.includes('09:00')
        ? '（未指定时间，默认上午9点）'
        : '';
      const contactText = contact ? `，已绑定「${contact.name}」` : '';
      return { message: `已添加${events.length}个事件：${titles}${detail}${contactText}`, eventIds: insertedIds, events: insertedEvents, contact };
    }

    case 'delete': {
      const search = await buildEventSearch(userId, intentResult);
      const [events] = await pool.query(search.sql, search.params);

      if (events.length === 0) {
        return { message: '没有找到相关事件', events: [] };
      }

      if (events.length === 1) {
        const ev = events[0];
        if (ev.contact_id) {
          await pool.query(
            `DELETE FROM interaction_logs
             WHERE user_id = ? AND event_id = ? AND action_type IN ('event_created', 'event_updated', 'mail_draft')`,
            [userId, ev.id]
          );
          await logInteraction(pool, {
            userId,
            contactId: ev.contact_id,
            eventId: ev.id,
            actionType: 'event_cancelled',
            title: `已取消：${ev.title}`,
            detail: `语音取消，原定时间：${ev.start_time}`,
          });
        }
        await pool.query('DELETE FROM events WHERE id = ? AND user_id = ?', [ev.id, userId]);
        console.log('[Voice] DELETED event:', { id: ev.id, title: ev.title });
        return { message: `已删除事件「${ev.title}」`, events: [], deleted: true };
      }

      return { message: `找到${events.length}个匹配事件，请选择删除`, events, deleted: false, needsConfirm: true };
    }

    case 'query': {
      let sql = 'SELECT * FROM events WHERE user_id = ?';
      const params = [userId];

      if (queryDate) {
        sql += ' AND DATE(start_time) = ?';
        params.push(queryDate);
      } else if (queryKeywords) {
        sql += ' AND title LIKE ?';
        params.push(`%${queryKeywords}%`);
      }

      sql += ' ORDER BY start_time ASC';

      const [events] = await pool.query(sql, params);

      if (events.length === 0) {
        return { message: queryDate ? `${queryDate}没有安排` : '没有找到相关事件', events: [], queryDate };
      }

      const summary = events.map(ev => {
        const time = new Date(ev.start_time).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' });
        return `${time} ${ev.title}`;
      }).join('；');

      return { message: `${queryDate || `匹配"${queryKeywords}"`}共${events.length}个事件：${summary}`, events, queryDate: queryDate || null };
    }

    case 'modify': {
      const search = await buildEventSearch(userId, intentResult);
      const [found] = await pool.query(search.sql, search.params);

      if (found.length === 0) {
        return { message: '没有找到相关事件', events: [] };
      }

      if (found.length === 1) {
        const ev = found[0];
        const mod = events[0] || {};

        console.log('[Voice] MODIFY - old event:', JSON.stringify({ id: ev.id, title: ev.title, start_time: ev.start_time, end_time: ev.end_time }));
        console.log('[Voice] MODIFY - new data:', JSON.stringify(mod));

        // === DATE/TIME DECOUPLING ===
        // Parse original event time into date + time components
        const oldDt = new Date(ev.start_time);
        const oldDate = oldDt.getFullYear() + '-' +
          String(oldDt.getMonth() + 1).padStart(2, '0') + '-' +
          String(oldDt.getDate()).padStart(2, '0');
        const oldTime = String(oldDt.getHours()).padStart(2, '0') + ':' +
          String(oldDt.getMinutes()).padStart(2, '0');

        const newTitle = mod.title || ev.title;

        // Independent fallback: newDate stays null if not provided
        const newDate = mod.newDate || null;
        const newTime = mod.newTime || null;
        const newEndTime = mod.newEndTime || null;

        // Merge: use new value if provided, otherwise keep original
        const finalDate = newDate || oldDate;
        const finalTime = newTime || oldTime;

        // Handle legacy startTime format (DeepSeek might still use it)
        let finalStart = mod.startTime || null;
        if (!finalStart && (newDate || newTime)) {
          finalStart = finalDate + ' ' + finalTime + ':00';
        } else if (!finalStart) {
          finalStart = oldDate + ' ' + oldTime + ':00';
        }

        // Double-channel endTime merge (newEndTime from DeepSeek)
        const oldEnd = ev.end_time ? new Date(ev.end_time) : null;
        let finalEnd = null;
        if (newEndTime) {
          // Channel A: user explicitly specified new end time
          finalEnd = finalDate + ' ' + newEndTime + ':00';
        } else if (mod.endTime) {
          // Legacy support: mod.endTime as "HH:mm" or full datetime
          if (/^\d{2}:\d{2}$/.test(mod.endTime)) {
            finalEnd = finalDate + ' ' + mod.endTime + ':00';
          } else {
            finalEnd = mod.endTime;
          }
        } else if (oldEnd) {
          // Preserve original duration: shift end by same delta as start
          const oldStartMs = oldDt.getTime();
          const oldEndMs = oldEnd.getTime();
          const durationMs = oldEndMs - oldStartMs;
          const newStartDt = new Date(finalStart.replace(' ', 'T'));
          const newEndDt = new Date(newStartDt.getTime() + durationMs);
          finalEnd = newEndDt.getFullYear() + '-' +
            String(newEndDt.getMonth() + 1).padStart(2, '0') + '-' +
            String(newEndDt.getDate()).padStart(2, '0') + ' ' +
            String(newEndDt.getHours()).padStart(2, '0') + ':' +
            String(newEndDt.getMinutes()).padStart(2, '0') + ':00';
        }

        console.log('[Voice] MODIFY - final:', { newTitle, finalDate, finalTime, finalStart, finalEnd });

        await pool.query(
          'UPDATE events SET title=?, start_time=?, end_time=? WHERE id=? AND user_id=?',
          [newTitle, finalStart, finalEnd, ev.id, userId]
        );

        // Re-SELECT updated record
        const [updated] = await pool.query('SELECT * FROM events WHERE id=? AND user_id=?', [ev.id, userId]);
        const updatedEv = updated[0];
        console.log('[Voice] MODIFY - updated:', { id: updatedEv.id, title: updatedEv.title, start_time: updatedEv.start_time });

        // Strict: only consider title changed if newTitle differs from original
        const titleChanged = !!(mod.title && mod.title !== ev.title);
        const dateChanged = newDate !== null;
        const timeChanged = newTime !== null || mod.startTime !== undefined;

        let desc = '';
        if (titleChanged && timeChanged) {
          desc = `标题改为「${mod.title}」，时间改为${finalDate} ${finalTime}`;
        } else if (timeChanged || dateChanged) {
          desc = `时间改为${finalDate} ${finalTime}`;
        } else if (titleChanged) {
          desc = `标题改为「${mod.title}」`;
        } else {
          desc = '已更新';
        }
        return { message: `已将「${ev.title}」的${desc}`, modified: true, events: [updatedEv] };
      }

      return { message: `找到${found.length}个匹配事件，请选择修改`, events: found, needsConfirm: true };
    }

    default:
      return { message: '无法处理该意图', events: [] };
  }
}

async function buildEventSearch(userId, intentResult) {
  const firstEvent = intentResult.events?.[0] || {};
  const eventType = normalizeEventType(intentResult.eventType || firstEvent.eventType || inferEventType(intentResult.queryKeywords || firstEvent.title || ''));
  const contactName = cleanContactName(
    intentResult.contactName ||
    firstEvent.contactName ||
    extractContactName(intentResult.queryKeywords || firstEvent.title || '')
  );
  const keyword = normalizeSearchKeyword(intentResult.queryKeywords || firstEvent.title || '', contactName);

  let sql = `
    SELECT e.*, c.name AS contact_name, c.email AS contact_email,
           c.department AS contact_department, c.role AS contact_role,
           c.avatar_color AS contact_avatar_color, c.contact_type
    FROM events e
    LEFT JOIN contacts c ON c.id = e.contact_id AND c.user_id = e.user_id
    WHERE e.user_id = ?`;
  const params = [userId];

  const shouldUseQueryDate = intentResult.queryDate && hasExplicitDatePhrase(intentResult.rawTranscript || '');
  if (shouldUseQueryDate) {
    sql += ' AND DATE(e.start_time) = ?';
    params.push(intentResult.queryDate);
  }

  const [contacts] = contactName
    ? await pool.query(
        `SELECT * FROM contacts
         WHERE user_id = ? AND (name = ? OR name LIKE ?)
         ORDER BY name = ? DESC, updated_at DESC`,
        [userId, contactName, `%${contactName}%`, contactName]
      )
    : [[]];

  const conditions = [];
  if (contacts.length === 1) {
    conditions.push('e.contact_id = ?');
    params.push(contacts[0].id);
  } else if (contactName) {
    conditions.push('(c.name LIKE ? OR e.title LIKE ?)');
    params.push(`%${contactName}%`, `%${contactName}%`);
  }

  if (eventType !== 'general') {
    const typeSearch = eventTypeCondition(eventType);
    conditions.push(typeSearch.sql);
    params.push(...typeSearch.params);
  } else if (keyword) {
    conditions.push('e.title LIKE ?');
    params.push(`%${keyword}%`);
  }

  if (conditions.length > 0) {
    sql += ` AND ${conditions.join(' AND ')}`;
  } else if (intentResult.queryKeywords) {
    sql += ' AND e.title LIKE ?';
    params.push(`%${intentResult.queryKeywords}%`);
  } else if (!shouldUseQueryDate) {
    sql += ' AND 1 = 0';
  }

  sql += ' ORDER BY e.start_time DESC';
  return { sql, params };
}

async function resolveContact(userId, intentResult) {
  if (intentResult.resolvedContactId && intentResult.resolvedContact) {
    return { contact: intentResult.resolvedContact };
  }

  const firstEvent = intentResult.events?.[0] || {};
  const contactName = cleanContactName(
    intentResult.contactName || firstEvent.contactName || extractContactName(firstEvent.title || '')
  );
  if (!contactName) return { contact: null };

  const [exact] = await pool.query(
    `SELECT * FROM contacts
     WHERE user_id = ? AND (name = ? OR name LIKE ?)
     ORDER BY name = ? DESC, updated_at DESC`,
    [userId, contactName, `%${contactName}%`, contactName]
  );

  if (exact.length === 1) return { contact: exact[0], contactName };
  if (exact.length > 1) return { needsContactDisambiguation: true, candidates: exact, contactName };
  return { contact: null, contactName };
}

function extractContactName(title) {
  const patterns = [
    /给(.+?)(?:打电话|发消息|发邮件|安排|创建|加|送|约)/,
    /和(.+?)(?:的)?(?:聊聊|近况|见面|吃饭|聚会|拜访|沟通)/,
    /约(.+?)(?:吃饭|见面|聚会|出来)/,
    /(.+?)(?:的)?(?:生日|纪念日|节日问候|道谢)/,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function cleanContactName(name) {
  return String(name || '')
    .replace(/[，。,.！!？?]/g, '')
    .replace(/^(我|帮我|安排|创建|添加|和|给)/, '')
    .trim();
}

function normalizeSearchKeyword(keyword, contactName) {
  let value = String(keyword || '')
    .replace(/[，。,.！!？?]/g, '')
    .replace(/(取消|删除|不去了|不进行|不要|把|将|的|和|与)/g, '')
    .trim();
  if (contactName) value = value.replace(new RegExp(escapeRegExp(contactName), 'g'), '').trim();
  return value;
}

function eventTypeCondition(eventType) {
  const map = {
    catch_up: ['聊聊', '近况', '打电话', '沟通'],
    birthday: ['生日'],
    anniversary: ['纪念日', '周年'],
    festival: ['节日', '春节', '中秋', '元旦', '圣诞'],
    visit: ['见面', '拜访', '吃饭', '聚会'],
    thanks: ['道谢', '谢谢', '回礼'],
    // legacy
    one_on_one: ['聊聊', '近况', '沟通', '1对1', '一对一'],
    interview: ['聊聊'],
    onboarding: ['纪念日', '周年'],
    offer: ['联系'],
    followup: ['跟进', '聊聊'],
  };
  const keywords = map[eventType] || [];
  return {
    sql: `(e.event_type = ?${keywords.map(() => ' OR e.title LIKE ?').join('')})`,
    params: [eventType, ...keywords.map((keyword) => `%${keyword}%`)],
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExplicitDatePhrase(text) {
  return /(今天|今日|明天|明日|后天|大后天|昨天|昨日|本周|这周|下周|上周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]|\d{1,2}[日号])/.test(String(text || ''));
}

function inferEventType(text) {
  if (/生日/.test(text)) return 'birthday';
  if (/纪念日|结婚纪念|相识纪念/.test(text)) return 'anniversary';
  if (/节日|春节|中秋|元旦|圣诞/.test(text)) return 'festival';
  if (/见面|拜访|吃饭|聚会|约/.test(text)) return 'visit';
  if (/道谢|谢谢|回礼/.test(text)) return 'thanks';
  if (/聊聊|近况|打电话|聊聊天|沟通|1对1|一对一/.test(text)) return 'catch_up';
  // legacy workplace phrases → personal equivalents
  if (/面试|录用|offer|跟进|入职/i.test(text)) return 'catch_up';
  return 'general';
}

/** 新枚举 + 旧职场值映射到新值，保证读写兼容 */
function normalizeEventType(value) {
  const legacy = {
    one_on_one: 'catch_up',
    interview: 'catch_up',
    onboarding: 'anniversary',
    offer: 'thanks',
    followup: 'catch_up',
  };
  const mapped = legacy[value] || value;
  const allowed = new Set(['general', 'catch_up', 'birthday', 'anniversary', 'festival', 'visit', 'thanks']);
  return allowed.has(mapped) ? mapped : 'general';
}

module.exports = router;
