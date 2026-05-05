/**
 * 格式化 ISO 日期字符串为本地化显示。
 * @param iso ISO 日期字符串
 * @param options.withTime 是否包含时间（默认 true）
 */
export function formatDate(
  iso: string,
  options?: { withTime?: boolean }
): string {
  const withTime = options?.withTime !== false;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return withTime
      ? d.toLocaleString('zh-CN')
      : d.toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

/**
 * 将消息数组序列化为可持久化的格式。
 * 补充缺失的 createdAt 字段为当前时间。
 */
export function serializeMessages(
  msgs: Array<{ id: string; role: string; content: string; createdAt?: string | Date }>
): Array<{ id: string; role: string; content: string; createdAt: string }> {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt instanceof Date
      ? m.createdAt.toISOString()
      : (m.createdAt || new Date().toISOString()),
  }));
}
