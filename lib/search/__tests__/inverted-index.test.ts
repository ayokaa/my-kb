import { describe, test, expect } from 'vitest';
import {
  tokenize,
  buildNoteIndex,
  mergeIndexes,
  buildIndex,
  removeNoteFromIndex,
  addNoteToIndex,
  serializeIndex,
  deserializeIndex,
  INDEX_VERSION,
} from '../inverted-index';
import { RAG_NOTE, VECTOR_DB_NOTE, COOKING_NOTE } from './fixtures';

describe('tokenize', () => {
  test('空字符串返回空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  test('英文按空格切分并转小写', () => {
    const tokens = tokenize('Hello World');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  test('中文按字和子词切分', () => {
    const tokens = tokenize('向量数据库');
    // 单字已去除，只保留双字组合及以上
    expect(tokens).toContain('向量');
    expect(tokens).toContain('量数');
    expect(tokens).toContain('数据');
    expect(tokens).toContain('据库');
    expect(tokens).toContain('向量数');
    expect(tokens).toContain('量数据');
    expect(tokens).toContain('数据库');
    expect(tokens).toContain('向量数据库');
  });

  test('中英文混合在边界处分割', () => {
    const tokens = tokenize('RAG技术');
    expect(tokens).toContain('rag');
    expect(tokens).toContain('技术');
  });

  test('停用词被过滤', () => {
    const tokens = tokenize('这是一个测试');
    expect(tokens).not.toContain('是');
    expect(tokens).not.toContain('个');
    expect(tokens).not.toContain('的');
    expect(tokens).toContain('测试');
    expect(tokens).toContain('一个');
  });

  test('标点符号被去除', () => {
    const tokens = tokenize('Hello, World! 你好，世界。');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('你好');
    expect(tokens).toContain('世界');
    expect(tokens).not.toContain('，');
    expect(tokens).not.toContain('。');
  });

  test('数字被保留', () => {
    const tokens = tokenize('2024年');
    expect(tokens).toContain('2024');
    // 单字'年'已去除
  });

  test('去重', () => {
    const tokens = tokenize('测试 测试');
    const count = tokens.filter((t) => t === '测试').length;
    expect(count).toBe(1);
  });
});

describe('buildNoteIndex', () => {
  test('为笔记构建索引包含所有字段', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['ai']).toBeDefined();
    expect(index['ai'].some((p) => p.field === 'tag')).toBe(true);

    expect(index['rag']).toBeDefined();
    expect(index['rag'].some((p) => p.field === 'tag')).toBe(true);

    expect(index['检索']).toBeDefined();
    expect(index['检索'].some((p) => p.field === 'title')).toBe(true);

    expect(index['什么是']).toBeDefined();
    expect(index['什么是'].some((p) => p.field === 'qa')).toBe(true);

    expect(index['幻觉']).toBeDefined();
    expect(index['幻觉'].some((p) => p.field === 'keyFact')).toBe(true);

    expect(index['向量数据库']).toBeDefined();
    expect(index['向量数据库'].some((p) => p.field === 'link')).toBe(true);
  });

  test('所有 posting 包含正确的 noteId', () => {
    const index = buildNoteIndex(RAG_NOTE);
    for (const postings of Object.values(index)) {
      for (const p of postings) {
        expect(p.noteId).toBe('rag-overview');
      }
    }
  });
});

describe('mergeIndexes', () => {
  test('合并多个索引', () => {
    const idx1 = buildNoteIndex(RAG_NOTE);
    const idx2 = buildNoteIndex(VECTOR_DB_NOTE);
    const merged = mergeIndexes([idx1, idx2]);

    // 'ai' 在两个笔记中都有 tag
    expect(merged['ai']).toHaveLength(2);
    expect(merged['ai'].map((p) => p.noteId).sort()).toEqual([
      'rag-overview',
      'vector-db',
    ]);
  });

  test('空数组返回空对象', () => {
    expect(mergeIndexes([])).toEqual({});
  });
});

describe('buildIndex', () => {
  test('从笔记列表构建完整索引', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE, COOKING_NOTE]);
    expect(Object.keys(index).length).toBeGreaterThan(0);
    expect(index['ai']).toBeDefined();
    expect(index['红烧肉']).toBeDefined();
  });
});

describe('removeNoteFromIndex', () => {
  test('移除指定笔记的所有条目', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);
    expect(index['ai'].some((p) => p.noteId === 'rag-overview')).toBe(true);

    const cleaned = removeNoteFromIndex(index, 'rag-overview');
    expect(cleaned['ai'].every((p) => p.noteId !== 'rag-overview')).toBe(true);
    expect(cleaned['ai'].some((p) => p.noteId === 'vector-db')).toBe(true);
  });

  test('移除后空 token 被清理', () => {
    const index = buildIndex([RAG_NOTE]);
    const cleaned = removeNoteFromIndex(index, 'rag-overview');
    expect(Object.keys(cleaned)).toHaveLength(0);
  });
});

describe('addNoteToIndex', () => {
  test('向现有索引添加笔记', () => {
    const index = buildIndex([RAG_NOTE]);
    const updated = addNoteToIndex(index, COOKING_NOTE);
    expect(updated['红烧肉']).toBeDefined();
    expect(updated['ai']).toBeDefined();
  });
});

describe('serializeIndex / deserializeIndex', () => {
  test('序列化和反序列化保持数据一致', () => {
    const index = buildIndex([RAG_NOTE]);
    const serialized = serializeIndex(index, ['rag-overview']);
    const parsed = JSON.parse(serialized);
    expect(parsed.version).toBe(INDEX_VERSION);
    expect(parsed.noteIds).toEqual(['rag-overview']);
    expect(parsed.index['ai']).toBeDefined();
  });

  test('反序列化成功', () => {
    const index = buildIndex([RAG_NOTE]);
    const serialized = serializeIndex(index, ['rag-overview']);
    const deserialized = deserializeIndex(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.version).toBe(INDEX_VERSION);
    expect(deserialized!.noteIds).toEqual(['rag-overview']);
  });

  test('版本不匹配返回 null', () => {
    const serialized = JSON.stringify({ version: 999, index: {}, noteIds: [] });
    expect(deserializeIndex(serialized)).toBeNull();
  });

  test('无效 JSON 返回 null', () => {
    expect(deserializeIndex('not json')).toBeNull();
  });

  test('反序列化后索引可用', () => {
    const index = buildIndex([RAG_NOTE]);
    const serialized = serializeIndex(index, ['rag-overview']);
    const deserialized = deserializeIndex(serialized);
    expect(deserialized!.index['ai']).toBeDefined();
    expect(deserialized!.index['ai'][0].noteId).toBe('rag-overview');
  });
});
