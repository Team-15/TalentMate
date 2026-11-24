/**
 * Android 本地通知。
 *
 * 业务规则（对应方案 §13）：
 *   登录或 App 回到前台 → 取未来 7 天日程 → 按 reminder 计算提醒时间 → 安排通知
 *   修改日程 → 重建通知；删除日程 → 取消对应通知；退出登录 → 清除该用户通知
 *   已过期日程不创建通知；重复同步不产生重复通知
 *
 * 幂等做法：每次同步前先取消本 App 已排期的全部通知，再按当前数据重建。
 * 通知 id 由「事件 id + 开始时间」哈希得到，因此同一事件重复同步得到同一个 id，
 * 不会出现重复提醒；而事件改期后 id 变化，旧的那条已被统一取消。
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import dayjs from 'dayjs';
import { isNative, nativeLog } from './platform';

/** 只处理未来这些天内的日程 */
const SYNC_WINDOW_DAYS = 7;

/** 该 App 排期的通知统一用这个 id 区间，便于整体清理与去重 */
const ID_PREFIX = 710000000;

/**
 * 由事件计算稳定的数字通知 id。
 * Android 的 notification id 必须是 32 位整数，这里取模保证落在安全范围。
 */
function notificationId(event) {
  const seed = `${event.id}|${event.start_time}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  // 转成正数并加上前缀，避免与其他来源的 id 冲突
  return ID_PREFIX + (Math.abs(hash) % 100000);
}

/**
 * 拼通知正文。
 *
 * 日程标题本身常常已经包含联系人（例如「给妈妈打电话」），
 * 若再无脑拼一次联系人名字会出现「妈妈给妈妈打电话」这种重复，
 * 因此当标题里已出现联系人姓名时就不再额外拼接。
 */
function buildBody(reminder, event) {
  const title = String(event.title || '').trim();
  const contact = String(event.contact_name || '').trim();
  const prefix = `${reminder} 分钟后：`;

  if (contact && !title.includes(contact)) {
    return `${prefix}与${contact} · ${title}`;
  }
  return `${prefix}${title}`;
}

/** 只检查通知权限，不发起申请（用于需要「静默判断」的场景） */
export async function checkNotificationPermission() {
  if (!isNative) return { granted: false, reason: 'web' };
  try {
    const status = await LocalNotifications.checkPermissions();
    const granted = status.display === 'granted';
    return { granted, reason: granted ? undefined : 'denied' };
  } catch (err) {
    nativeLog('check permission error', err?.message);
    return { granted: false, reason: 'error' };
  }
}

/**
 * 主动申请通知权限。
 *
 * 只在「用户明确表达了要提醒」时才调用（例如设置页打开提醒开关、
 * 或新建了带提醒的日程）。绝对不要在 App 启动或登录时自动调用，
 * 否则会和首次引导、麦克风权限叠在一起连弹系统弹窗，
 * 用户很容易直接点拒绝 —— 方案 §10.10 明确要求避免这种情况。
 */
export async function requestNotificationPermission() {
  if (!isNative) return { granted: false, reason: 'web' };

  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') {
      status = await LocalNotifications.requestPermissions();
    }
    const granted = status.display === 'granted';
    nativeLog('notification permission (requested):', status.display);
    return { granted, reason: granted ? undefined : 'denied' };
  } catch (err) {
    nativeLog('notification permission error', err?.message);
    return { granted: false, reason: 'error' };
  }
}

/** 取消本 App 已排期的全部通知 */
export async function cancelAllNotifications() {
  if (!isNative) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending?.notifications?.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
      nativeLog(`cancelled ${pending.notifications.length} notifications`);
    }
  } catch (err) {
    nativeLog('cancelAll error', err?.message);
  }
}

/**
 * 把日程同步为本地通知。
 *
 * 注意：这里**不会**主动申请通知权限（见 requestNotificationPermission 的说明）。
 * 只有已经获得授权时才排期；未授权时同步返回并清掉旧排期，避免留下点不开的通知。
 *
 * @param {Array} events 日程列表（必须含 id / title / start_time / reminder）
 * @returns {{scheduled:number, skipped:number, permission:boolean}}
 */
export async function syncEventNotifications(events = []) {
  if (!isNative) return { scheduled: 0, skipped: 0, permission: false };

  const permission = await checkNotificationPermission();
  if (!permission.granted) {
    // 没有权限时清掉旧的，避免残留无效通知
    await cancelAllNotifications();
    return { scheduled: 0, skipped: events.length, permission: false };
  }

  const now = dayjs();
  const windowEnd = now.add(SYNC_WINDOW_DAYS, 'day');

  const notifications = [];
  let skipped = 0;

  events.forEach((ev) => {
    const reminder = Number(ev.reminder ?? 0);
    const start = dayjs(ev.start_time);

    // 未设置提醒 / 时间非法 → 跳过
    if (!reminder || reminder <= 0 || !start.isValid()) {
      skipped++;
      return;
    }
    // 只处理未来 7 天内，且提醒时刻尚未过去
    if (start.isBefore(now) || start.isAfter(windowEnd)) {
      skipped++;
      return;
    }

    const fireAt = start.subtract(reminder, 'minute');
    if (!fireAt.isAfter(now)) {
      // 提醒时间已过（例如刚创建了一个 5 分钟后开始、提前 10 分钟提醒的日程）
      skipped++;
      return;
    }

    notifications.push({
      id: notificationId(ev),
      title: 'TalentMate 提醒',
      body: buildBody(reminder, ev),
      schedule: { at: fireAt.toDate(), allowWhileIdle: true },
      // 点击通知后由 appLifecycle 读取 eventId 并跳转
      extra: { eventId: ev.id, startTime: ev.start_time },
      smallIcon: 'ic_stat_icon',
      channelId: 'talentmate-reminders',
    });
  });

  // 先清后建，保证幂等
  await cancelAllNotifications();

  if (notifications.length) {
    try {
      await LocalNotifications.createChannel({
        id: 'talentmate-reminders',
        name: '关怀提醒',
        description: '日程开始前的提醒通知',
        importance: 4,
        visibility: 1,
      }).catch(() => {});
      await LocalNotifications.schedule({ notifications });
      nativeLog(`scheduled ${notifications.length} notifications, skipped ${skipped}`);
    } catch (err) {
      nativeLog('schedule error', err?.message);
      return { scheduled: 0, skipped, permission: true };
    }
  } else {
    nativeLog(`scheduled 0 notifications, skipped ${skipped}`);
  }

  return { scheduled: notifications.length, skipped, permission: true };
}

/**
 * 注册「点击通知」监听：跳到对应日程。
 * @param {(eventId:number, startTime:string) => void} onOpen
 */
export async function registerNotificationTapHandler(onOpen) {
  if (!isNative) return () => {};
  try {
    const handle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action) => {
        const extra = action?.notification?.extra || {};
        nativeLog('notification tapped', extra);
        onOpen?.(extra.eventId, extra.startTime);
      },
    );
    return () => handle.remove();
  } catch (err) {
    nativeLog('register tap handler error', err?.message);
    return () => {};
  }
}
