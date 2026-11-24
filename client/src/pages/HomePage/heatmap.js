/**
 * 关怀热力图状态常量。
 * 数据来自 GET /api/insights/relationship-heatmap，每项至少包含：
 *   { id, name, status, reason, days_since_interaction, avatar_color, department, role, email }
 */

export const HEATMAP_STATUS_STYLE = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  danger: 'bg-red-50 text-red-700 border-red-100',
  new: 'bg-slate-50 text-slate-600 border-slate-100',
};

export const HEATMAP_STATUS_LABEL = {
  danger: '高优先级',
  warning: '需关注',
  scheduled: '已安排',
  new: '新联系人',
  healthy: '正常',
};

/** 排序优先级：越紧急越靠前 */
export const HEATMAP_PRIORITY = {
  danger: 0,
  warning: 1,
  scheduled: 2,
  new: 3,
  healthy: 4,
};

/**
 * 人工关注等级。
 *
 * 与后端 insights.js 的 CARE_WEIGHT 对应：重点联系人的提醒阈值更低，
 * 因此更早变成「需关注 / 高优先级」；这里负责展示与同状态下的排序。
 */
export const CARE_LEVEL_LABEL = {
  high: '重点关注',
  normal: '',
  low: '低优先',
};

export const CARE_LEVEL_STYLE = {
  high: 'bg-orange-50 text-orange-600 border-orange-100',
  normal: 'bg-slate-50 text-slate-500 border-slate-100',
  low: 'bg-slate-50 text-slate-400 border-slate-100',
};

export const CARE_LEVEL_OPTIONS = [
  { value: 'high', label: '重点关注' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低优先' },
];

const CARE_SORT = { high: 0, normal: 1, low: 2 };

export function careLevelLabel(level) {
  return CARE_LEVEL_LABEL[level] || '';
}

export function careLevelStyle(level) {
  return CARE_LEVEL_STYLE[level] || CARE_LEVEL_STYLE.normal;
}

export function heatmapStyle(status) {
  return HEATMAP_STATUS_STYLE[status] || HEATMAP_STATUS_STYLE.new;
}

export function heatmapLabel(status) {
  return HEATMAP_STATUS_LABEL[status] || '未知';
}

/** 按紧急度 + 关注等级 + 未沟通天数排序，返回新数组 */
export function sortHeatmap(items = []) {
  return [...items].sort((a, b) => {
    const p = (HEATMAP_PRIORITY[a.status] ?? 9) - (HEATMAP_PRIORITY[b.status] ?? 9);
    if (p !== 0) return p;
    // 同一状态下，人工标记为「重点」的排前面
    const c = (CARE_SORT[a.care_level] ?? 1) - (CARE_SORT[b.care_level] ?? 1);
    if (c !== 0) return c;
    return (b.days_since_interaction ?? -1) - (a.days_since_interaction ?? -1);
  });
}

/** 统计各状态数量 */
export function summarizeHeatmap(items = []) {
  const count = (status) => items.filter((item) => item.status === status).length;
  return {
    danger: count('danger'),
    warning: count('warning'),
    // 已安排：displayStatus=scheduled，或 danger/warning 但已有未来日程
    scheduled: items.filter((item) => item.status === 'scheduled' || item.has_upcoming).length,
    new: count('new'),
    healthy: count('healthy'),
    /** 高优先级 + 需关注 */
    attention: count('danger') + count('warning'),
  };
}
