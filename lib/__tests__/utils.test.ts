import { describe, it, expect } from 'vitest';
import { formatDate, serializeMessages } from '../utils';

describe('formatDate', () => {
  it('格式化 ISO 日期字符串为本地化格式', () => {
    const result = formatDate('2025-01-15T10:30:00.000Z');
    expect(result).toContain('2025');
    expect(result).toContain('1');
  });

  it('带时间输出（默认 withTime=true）', () => {
    const result = formatDate('2025-03-01T08:00:00.000Z');
    // toLocaleString 应包含时间部分（冒号或时/分）
    expect(result).toMatch(/\d{1,2}:\d{2}|上午|下午/);
  });

  it('withTime=false 仅输出日期', () => {
    const result = formatDate('2025-03-01T08:00:00.000Z', { withTime: false });
    // toLocaleDateString 不应包含时间
    expect(result).not.toMatch(/\d{1,2}:\d{2}/);
    expect(result).toContain('2025');
  });

  it('无效输入返回原始字符串', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('空字符串返回空字符串', () => {
    expect(formatDate('')).toBe('');
  });
});

describe('serializeMessages', () => {
  it('将消息数组序列化为可保存格式，补充缺失的 createdAt', () => {
    const msgs = [
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi', createdAt: '2025-01-01T00:00:00Z' },
    ];
    const result = serializeMessages(msgs);
    expect(result).toEqual([
      { id: '1', role: 'user', content: 'hello', createdAt: expect.any(String) },
      { id: '2', role: 'assistant', content: 'hi', createdAt: '2025-01-01T00:00:00Z' },
    ]);
  });

  it('空数组返回空数组', () => {
    expect(serializeMessages([])).toEqual([]);
  });

  it('保留所有字段', () => {
    const msgs = [{ id: 'a', role: 'user', content: 'test', createdAt: '2025-06-01T12:00:00Z' }];
    const result = serializeMessages(msgs);
    expect(result[0]).toEqual({ id: 'a', role: 'user', content: 'test', createdAt: '2025-06-01T12:00:00Z' });
  });

  it('将 Date 对象转换为 ISO 字符串', () => {
    const date = new Date('2025-07-01T10:00:00Z');
    const msgs = [{ id: '1', role: 'assistant', content: 'ok', createdAt: date }];
    const result = serializeMessages(msgs);
    expect(result[0].createdAt).toBe(date.toISOString());
  });
});
