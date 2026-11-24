/**
 * Intent Parser Service.
 * Calls DeepSeek API to parse natural language into structured intent JSON.
 * Falls back to chrono-node for time extraction if DeepSeek returns invalid time format.
 */
const OpenAI = require('openai');
const chrono = require('chrono-node');

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

const SYSTEM_PROMPT = `You are a calendar intent parser. Parse the user's Chinese speech into a JSON object.

Output ONLY valid JSON, no markdown wrapping, no extra text:

{
  "intent": "add" | "delete" | "query" | "modify" | "unknown",
  "events": [
    {
      "title": "event title",
      "startTime": "YYYY-MM-DD HH:mm",
      "endTime": "YYYY-MM-DD HH:mm",
      "reminderMinutes": 10
    }
  ],
  "queryKeywords": "",
  "queryDate": "YYYY-MM-DD",
  "contactName": "",
  "eventType": "general" | "catch_up" | "birthday" | "anniversary" | "festival" | "visit" | "thanks"
}

Rules:
- If the user mentions MULTIPLE events (e.g. "下午2点和5点开会"), create multiple objects in the "events" array.
- If the user mentions a person, fill contactName. Example: "给妈妈打电话" -> contactName="妈妈"; "约小王吃饭" -> contactName="小王".
- Classify personal relationship care events into eventType:
  聊聊/近况/打电话/聊聊天 -> catch_up; 生日 -> birthday; 纪念日/结婚纪念/相识纪念 -> anniversary;
  节日/春节/中秋/元旦/圣诞 -> festival; 见面/拜访/吃饭/聚会 -> visit; 道谢/谢谢/回礼 -> thanks; otherwise general.

--- INTENT: add ---
"明天下午3点开会" → intent="add", events[0]={title:"开会",startTime:"(tomorrow) 15:00"}
"周末提醒我给妈妈打电话" → intent="add", contactName="妈妈", eventType="catch_up", events[0]={title:"给妈妈打电话",startTime:"(weekend) 10:00"}
"下周五约小王吃饭" → intent="add", contactName="小王", eventType="visit", events[0]={title:"约小王吃饭",startTime:"(next Friday) 18:00"}
"下周一给王芳安排生日祝福" → intent="add", contactName="王芳", eventType="birthday", events[0]={title:"给王芳生日祝福",startTime:"(next Monday) 09:00"}

--- INTENT: delete ---
"今天不打游戏了" → intent="delete", queryKeywords="打游戏", queryDate="(today)"
"删除明天的会议" → intent="delete", queryKeywords="会议", queryDate="(tomorrow)"
Pattern: 不/取消/删除 + keyword. "不打X了" = delete X.

--- INTENT: modify ---
"明天不打游戏了，要去开会，在12点"
  → intent="modify", queryKeywords="打游戏", queryDate="(tomorrow)"
  → events[0]={title:"开会",newDate:"(tomorrow)",newTime:"12:00"}

"把开会改成打游戏" → intent="modify", queryKeywords="开会", events[0]={title:"打游戏"}
"将明天的开会变成上班" → intent="modify", queryKeywords="开会", queryDate="(tomorrow)", events[0]={title:"上班"}
"把明天的开会改到今天"
  → intent="modify", queryKeywords="开会", queryDate="(tomorrow)"
  → events[0]={newDate:"(today)"}   ← only date changes, time stays
"会议改到下午5点" → intent="modify", queryKeywords="会议", events[0]={newTime:"17:00"}

Pattern: "不X了, 要Y" / "把X改成Y" / "X变Y" → modify(X→Y)
- queryKeywords = the ORIGINAL event keyword (before change)
- events[0] contains ONLY what changes

"把今晚9点到11点的开会时间改成早上9点到早上10点"
  → intent="modify", queryKeywords="开会", queryDate="(today)"
  → events[0]={newTime:"09:00",newEndTime:"10:00"}

--- CRITICAL: MODIFY date/time decoupling ---
For modify intent, use newDate, newTime, and newEndTime SEPARATELY:
- newDate = "YYYY-MM-DD" — ONLY if user explicitly changes the date
- newTime = "HH:mm" — ONLY if user explicitly changes the START time
- newEndTime = "HH:mm" — ONLY if user explicitly mentions a NEW END time (e.g. "到10点", "到下午6点", "5点到6点")
- ALL default to null when not mentioned
- "改到今天" → newDate="(today)", newTime=null, newEndTime=null
- "改到下午5点" → newDate=null, newTime="17:00", newEndTime=null
- "改成早上9点到早上10点" → newDate=null, newTime="09:00", newEndTime="10:00"
- "改到今天下午2点到下午4点" → newDate="(today)", newTime="14:00", newEndTime="16:00"
- NEVER fill any field user didn't mention — null means "don't change"
- If you fill a made-up time, the system will BREAK.

For delete: "不X了" is a delete of X, not an add or modify.
For intent "add": default missing time to 09:00, date to today, endTime to startTime+1h, reminder to 10min.
All times in 24-hour format.`;

/**
 * Parse a transcript into structured intent.
 * @param {string} transcript - The recognized speech text
 * @returns {Promise<object|null>} - Parsed intent object or null on failure
 */
async function parse(transcript) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nowStr = `${todayStr} ${timeStr}`;

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Current time is ${nowStr}. Parse: "${transcript}"`,
      },
    ],
    temperature: 0.1,
    max_tokens: 500,
  });

  const rawContent = response.choices[0].message.content.trim();

  // Extract JSON from possible markdown code blocks
  let jsonStr = rawContent;
  const codeBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('Failed to parse DeepSeek response as JSON:', rawContent);
    return null;
  }

  // Normalize: support both old single-event and new multi-event format
  if (!parsed.events && parsed.title) {
    // Legacy single-event format → wrap in events array
    parsed.events = [{
      title: parsed.title,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      reminderMinutes: parsed.reminderMinutes || 10,
    }];
  }

  // Validate & fix time for each event
  if (parsed.events && parsed.intent === 'add') {
    // Fallback for ADD intent only: never fill time for modify/delete
    parsed.events = parsed.events.map((ev) => {
      let { startTime, endTime, reminderMinutes } = ev;

      if (!startTime || !isValidDateTime(startTime)) {
        const fallback = new Date(now.getTime() + 60 * 60 * 1000);
        startTime = formatDateTime(fallback);
      } else if (!isValidDateTime(startTime)) {
        const chronoResult = chrono.parseDate(startTime, now);
        if (chronoResult) startTime = formatDateTime(chronoResult);
      }

      if (endTime && !isValidDateTime(endTime)) {
        if (isValidDateTime(startTime)) {
          const s = new Date(startTime.replace(' ', 'T'));
          s.setHours(s.getHours() + 1);
          endTime = formatDateTime(s);
        }
      }

      return { title: ev.title, startTime, endTime, reminderMinutes: reminderMinutes || 10 };
    });
  }

  console.log('[IntentParser] Parsed:', JSON.stringify(parsed));

  return parsed;
}

/**
 * Check if a date-time string matches the expected format.
 */
function isValidDateTime(str) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(str);
}

/**
 * Format a Date object to "YYYY-MM-DD HH:mm".
 */
function formatDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

module.exports = { parse };
