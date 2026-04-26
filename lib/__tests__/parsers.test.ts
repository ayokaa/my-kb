import { describe, it, expect } from 'vitest';
import { parseNote, stringifyNote } from '../parsers';
import type { Note } from '../types';

const sampleNote = `---
id: rag-001
title: RAG
tags:
  - ai
  - retrieval
status: growing
created: '2024-10-20'
updated: '2024-10-25'
sources:
  - https://example.com/rag
---

# RAG

## 一句话摘要
通过检索外部文档增强 LLM 回答质量的技术。

## 与我相关
曾在 coding-agent 中尝试，已转向文件直接读取方案。

## 关键事实
- 需要检索器 + 生成器两部分
- 向量数据库是常见检索器

## 时间线
- 2024-10-20 | 初识：认为 RAG 是最佳方案
- 2024-10-25 | 修正：小数据下文件读取更优

## 关联
- [[向量数据库]] #strong — 核心依赖
- [[coding-agent]] #context
- [[file-system]]

## 常见问题
**Q**: RAG 和文件读取怎么选？
**A**: 大数据用 RAG，小数据用文件读取。
*来源: [[conversations/2024-10-25]]*

## 详细内容
RAG 的详细技术说明...
`;

describe('parseNote', () => {
  it('parses frontmatter correctly', () => {
    const note = parseNote(sampleNote);
    expect(note.id).toBe('rag-001');
    expect(note.title).toBe('RAG');
    expect(note.tags).toEqual(['ai', 'retrieval']);
    expect(note.status).toBe('growing');
    expect(note.sources).toEqual(['https://example.com/rag']);
  });

  it('parses summary', () => {
    const note = parseNote(sampleNote);
    expect(note.summary).toBe('通过检索外部文档增强 LLM 回答质量的技术。');
  });

  it('parses personal context', () => {
    const note = parseNote(sampleNote);
    expect(note.personalContext).toContain('coding-agent');
  });

  it('parses key facts', () => {
    const note = parseNote(sampleNote);
    expect(note.keyFacts).toHaveLength(2);
    expect(note.keyFacts[0]).toBe('需要检索器 + 生成器两部分');
  });

  it('parses timeline', () => {
    const note = parseNote(sampleNote);
    expect(note.timeline).toHaveLength(2);
    expect(note.timeline[0].date).toBe('2024-10-20');
    expect(note.timeline[1].event).toBe('修正：小数据下文件读取更优');
  });

  it('parses links with weights', () => {
    const note = parseNote(sampleNote);
    expect(note.links).toHaveLength(3);
    expect(note.links[0]).toEqual({ target: '向量数据库', weight: 'strong', context: '核心依赖' });
    expect(note.links[1]).toEqual({ target: 'coding-agent', weight: 'context', context: '' });
    expect(note.links[2]).toEqual({ target: 'file-system', weight: 'weak', context: '' });
  });

  it('parses QAs with source', () => {
    const note = parseNote(sampleNote);
    expect(note.qas).toHaveLength(1);
    expect(note.qas[0].question).toBe('RAG 和文件读取怎么选？');
    expect(note.qas[0].answer).toBe('大数据用 RAG，小数据用文件读取。');
    expect(note.qas[0].source).toBe('conversations/2024-10-25');
  });

  it('parses content', () => {
    const note = parseNote(sampleNote);
    expect(note.content).toBe('RAG 的详细技术说明...');
  });
});

describe('stringifyNote', () => {
  it('round-trips correctly', () => {
    const original = parseNote(sampleNote);
    const serialized = stringifyNote(original);
    const reparsed = parseNote(serialized);

    expect(reparsed.id).toBe(original.id);
    expect(reparsed.title).toBe(original.title);
    expect(reparsed.tags).toEqual(original.tags);
    expect(reparsed.summary).toBe(original.summary);
    expect(reparsed.personalContext).toBe(original.personalContext);
    expect(reparsed.keyFacts).toEqual(original.keyFacts);
    expect(reparsed.timeline).toEqual(original.timeline);
    expect(reparsed.links).toEqual(original.links);
    expect(reparsed.qas).toEqual(original.qas);
    expect(reparsed.content).toBe(original.content);
  });

  it('handles empty fields by skipping sections', () => {
    const emptyNote = parseNote(`---
id: empty
title: Empty
---

# Empty
`);
    const serialized = stringifyNote(emptyNote);
    expect(serialized).not.toContain('一句话摘要');
    expect(serialized).not.toContain('与我相关');
    expect(serialized).not.toContain('关键事实');
    expect(serialized).not.toContain('时间线');
    expect(serialized).not.toContain('关联');
    expect(serialized).not.toContain('常见问题');
    expect(serialized).not.toContain('详细内容');
  });
});

describe('parseQAs edge cases', () => {
  it('skips malformed QA without A', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 常见问题
**Q**: Question without answer
`);
    expect(note.qas).toHaveLength(0);
  });

  it('handles multiple QAs', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 常见问题
**Q**: First?
**A**: Yes.

**Q**: Second?
**A**: No.
`);
    expect(note.qas).toHaveLength(2);
    expect(note.qas[0].question).toBe('First?');
    expect(note.qas[1].question).toBe('Second?');
  });
});

describe('edge cases', () => {
  it('handles empty note', () => {
    const minimal = `---
id: test
title: Test
---

# Test
`;
    const note = parseNote(minimal);
    expect(note.id).toBe('test');
    expect(note.keyFacts).toEqual([]);
    expect(note.links).toEqual([]);
  });

  it('handles note without frontmatter title', () => {
    const noTitle = `---
id: test
---

# My Title
`;
    const note = parseNote(noTitle);
    expect(note.title).toBe(''); // frontmatter missing
  });

  it('throws on missing frontmatter', () => {
    expect(() => parseNote('no frontmatter here')).toThrow('Invalid markdown: missing frontmatter');
    expect(() => parseNote('---\nonly one')).toThrow('Invalid markdown: unclosed frontmatter');
  });

  it('does not split body horizontal rules as frontmatter', () => {
    const raw = `---
id: test
---

# Title

Some content.

---

More content after horizontal rule.
`;
    const note = parseNote(raw);
    // Frontmatter is correctly extracted even when body contains '---'
    expect(note.id).toBe('test');
    // The second '---' in body should not be mistaken for frontmatter boundary
    // (previously split('---') would cut at the body horizontal rule)
  });

  it('handles unknown sections by merging into content', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 自定义区块
一些内容

## 另一个未知
更多内容
`);
    expect(note.content).toContain('## 自定义区块');
    expect(note.content).toContain('## 另一个未知');
  });

  it('handles malformed links gracefully', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 关联
- not-a-link-format
- [[valid]]
- plain text
`);
    expect(note.links).toHaveLength(3);
    expect(note.links[0]).toEqual({ target: 'not-a-link-format', weight: 'weak' });
    expect(note.links[1]).toEqual({ target: 'valid', weight: 'weak', context: '' });
    expect(note.links[2]).toEqual({ target: 'plain text', weight: 'weak' });
  });

  it('handles timeline without pipe separator', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 时间线
- 2024-01-01 | event with pipe
- 2024-01-02 no pipe here
`);
    expect(note.timeline[1]).toEqual({ date: '2024-01-02 no pipe here', event: '' });
  });

  it('handles timeline line not starting with dash', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 时间线
2024-01-01 | no dash
`);
    expect(note.timeline[0]).toEqual({ date: '2024-01-01', event: 'no dash' });
  });

  it('handles QA without source', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 常见问题
**Q**: What?
**A**: Yes.
`);
    expect(note.qas[0].source).toBeUndefined();
  });

  it('stringifyNote skips source line when QA has no source', () => {
    const note = parseNote(`---
id: test
title: Test
---

# Test

## 常见问题
**Q**: What?
**A**: Yes.
`);
    const serialized = stringifyNote(note);
    expect(serialized).toContain('**Q**: What?');
    expect(serialized).toContain('**A**: Yes.');
    expect(serialized).not.toContain('来源:');
  });
});
