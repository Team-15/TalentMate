/**
 * 关怀日程类型常量。
 * 桌面端（CalendarPanel）与手机端（MobileCalendarPage 等）共用，避免字典重复维护。
 *
 * 私人关系场景：catch_up / birthday / anniversary / festival / visit / thanks
 * 旧职场枚举在 eventTypeMeta / labelForEventType 中做展示兼容。
 */

export const EVENT_TYPE_OPTIONS = [
  { value: 'general', label: '普通日程' },
  { value: 'catch_up', label: '聊聊近况' },
  { value: 'birthday', label: '生日祝福' },
  { value: 'anniversary', label: '纪念日' },
  { value: 'festival', label: '节日问候' },
  { value: 'visit', label: '见面/拜访' },
  { value: 'thanks', label: '道谢/回礼' },
];

/** 每种类型的主色、浅底与文字色，用于卡片左侧色条与标签 */
export const EVENT_TYPE_META = {
  general: { label: '普通日程', color: '#64748B', bg: 'bg-slate-50', text: 'text-slate-600' },
  catch_up: { label: '聊聊', color: '#1677FF', bg: 'bg-blue-50', text: 'text-blue-600' },
  birthday: { label: '生日', color: '#EC4899', bg: 'bg-pink-50', text: 'text-pink-600' },
  anniversary: { label: '纪念日', color: '#10B981', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  festival: { label: '节日', color: '#F59E0B', bg: 'bg-amber-50', text: 'text-amber-600' },
  visit: { label: '见面', color: '#8B5CF6', bg: 'bg-violet-50', text: 'text-violet-600' },
  thanks: { label: '道谢', color: '#EF4444', bg: 'bg-red-50', text: 'text-red-600' },
  // legacy workplace types → personal display
  one_on_one: { label: '聊聊', color: '#1677FF', bg: 'bg-blue-50', text: 'text-blue-600' },
  interview: { label: '聊聊', color: '#F59E0B', bg: 'bg-amber-50', text: 'text-amber-600' },
  onboarding: { label: '纪念日', color: '#10B981', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  offer: { label: '道谢', color: '#8B5CF6', bg: 'bg-violet-50', text: 'text-violet-600' },
  followup: { label: '聊聊', color: '#EF4444', bg: 'bg-red-50', text: 'text-red-600' },
};

/** 月历格子里事件圆点/左侧色条的颜色序列 */
export const DOT_COLORS = ['#1677FF', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#EC4899'];

/** 关系圈选项 */
export const CONTACT_TYPE_OPTIONS = [
  { value: 'family', label: '家人' },
  { value: 'friend', label: '朋友' },
  { value: 'acquaintance', label: '熟人' },
];

export const CONTACT_TYPE_LABEL = {
  family: '家人',
  friend: '朋友',
  acquaintance: '熟人',
  // legacy
  employee: '朋友',
  candidate: '熟人',
};

export function contactTypeLabel(type) {
  return CONTACT_TYPE_LABEL[type] || '朋友';
}

export function eventTypeMeta(type) {
  return EVENT_TYPE_META[type] || EVENT_TYPE_META.general;
}

export function labelForEventType(type) {
  const found = EVENT_TYPE_OPTIONS.find((item) => item.value === type);
  if (found) return found.label;
  return EVENT_TYPE_META[type]?.label || '普通日程';
}
