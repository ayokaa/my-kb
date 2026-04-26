import { describe, test, expect } from 'vitest';
import {
  tokenize,
  buildNoteIndex,
  buildIndex,
  mergeIndexes,
  removeNoteFromIndex,
  addNoteToIndex,
  serializeIndex,
  deserializeIndex,
  INDEX_VERSION,
} from '../index';
import { RAG_NOTE, VECTOR_DB_NOTE, ALL_TEST_NOTES } from './fixtures';

describe('tokenize', () => {
  test('英文按空格切分并转小写', () => {
    expect(tokenize('Hello World')).toContain('hello');
    expect(tokenize('Hello World')).toContain('world');
  });

  test('中文按字切分并保留整词', () => {
    const tokens = tokenize('红烧肉');
    expect(tokens).toContain('红烧肉');
    expect(tokens).toContain('红');
    expect(tokens).toContain('烧');
    expect(tokens).toContain('肉');
  });

  test('标点符号去除', () => {
    const tokens = tokenize('Hello, World!');
    expect(tokens).not.toContain('hello,');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  test('空字符串返回空数组', () => {
    expect(tokenize('')).toEqual([]);
  });

  test('重复词去重', () => {
    const tokens = tokenize('RAG RAG rag');
    expect(tokens.filter(t => t === 'rag')).toHaveLength(1);
  });

  test('中英文混合', () => {
    const tokens = tokenize('RAG检索增强');
    expect(tokens).toContain('rag');
    expect(tokens).toContain('检索增强');
  });
});

describe('buildNoteIndex', () => {
  test('title 字段正确索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['rag']).toContainEqual({ noteId: 'rag-overview', field: 'title' });
    expect(index['检索']).toContainEqual({ noteId: 'rag-overview', field: 'title' });
    expect(index['增强']).toContainEqual({ noteId: 'rag-overview', field: 'title' });
    expect(index['生成']).toContainEqual({ noteId: 'rag-overview', field: 'title' });
  });

  test('tag 字段正确索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['ai']).toContainEqual({ noteId: 'rag-overview', field: 'tag' });
    expect(index['rag']).toContainEqual({ noteId: 'rag-overview', field: 'tag' });
    expect(index['llm']).toContainEqual({ noteId: 'rag-overview', field: 'tag' });
  });

  test('summary 字段正确索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['外部']).toContainEqual({ noteId: 'rag-overview', field: 'summary' });
  });

  test('keyFacts 逐条索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['幻觉']).toContainEqual({ noteId: 'rag-overview', field: 'keyFact' });
    expect(index['质量']).toContainEqual({ noteId: 'rag-overview', field: 'keyFact' });
  });

  test('qa questions 索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['什么是']).toContainEqual({ noteId: 'rag-overview', field: 'qa' });
    expect(index['区别']).toContainEqual({ noteId: 'rag-overview', field: 'qa' });
  });

  test('links target 索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['向量']).toContainEqual({ noteId: 'rag-overview', field: 'link' });
    expect(index['数据库']).toContainEqual({ noteId: 'rag-overview', field: 'link' });
  });

  test('content 字段索引', () => {
    const index = buildNoteIndex(RAG_NOTE);
    expect(index['retrieval']).toContainEqual({ noteId: 'rag-overview', field: 'content' });
  });

  test('同一 term 在不同字段出现多次', () => {
    const index = buildNoteIndex(RAG_NOTE);
    const ragPostings = index['rag']?.filter(p => p.noteId === 'rag-overview');
    expect(ragPostings).toBeDefined();
    const fields = ragPostings!.map(p => p.field).sort();
    expect(fields).toContain('tag');
    expect(fields).toContain('title');
  });
});

describe('buildIndex', () => {
  test('多个笔记合并到同一索引', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);
    expect(index['rag']).toBeDefined();
    expect(index['ai']).toBeDefined();
    expect(index['database']).toBeDefined();
  });

  test('不同笔记的同一 term 都有 postings', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);
    const aiPostings = index['ai'];
    expect(aiPostings).toHaveLength(2);
    expect(aiPostings.map(p => p.noteId).sort()).toEqual(['rag-overview', 'vector-db']);
  });
});

describe('removeNoteFromIndex', () => {
  test('移除指定笔记的所有 postings', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);
    const cleaned = removeNoteFromIndex(index, 'rag-overview');
    // 'rag' 也在 vector-db 的 link target 中出现，所以不会被完全清空
    expect(cleaned['rag']?.every(p => p.noteId !== 'rag-overview')).toBe(true);
    expect(cleaned['ai']).toBeDefined();
    expect(cleaned['ai'].map(p => p.noteId)).toEqual(['vector-db']);
  });

  test('移除后空 term 被清理', () => {
    const index = buildIndex([RAG_NOTE]);
    const cleaned = removeNoteFromIndex(index, 'rag-overview');
    expect(Object.keys(cleaned)).toHaveLength(0);
  });
});

describe('addNoteToIndex', () => {
  test('增量添加笔记到索引', () => {
    const index = buildIndex([RAG_NOTE]);
    const updated = addNoteToIndex(index, VECTOR_DB_NOTE);
    expect(updated['database']).toBeDefined();
    expect(updated['ai']).toHaveLength(2);
  });
});

describe('serialize / deserialize', () => {
  test('序列化反序列化一致', () => {
    const index = buildIndex([RAG_NOTE]);
    const serialized = serializeIndex(index, ['rag-overview']);
    const deserialized = deserializeIndex(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized!.version).toBe(INDEX_VERSION);
    expect(deserialized!.noteIds).toEqual(['rag-overview']);
    expect(deserialized!.index['rag']).toBeDefined();
  });

  test('版本不匹配返回 null', () => {
    const serialized = JSON.stringify({ version: 999, index: {}, noteIds: [] });
    expect(deserializeIndex(serialized)).toBeNull();
  });

  test('非法 JSON 返回 null', () => {
    expect(deserializeIndex('not json')).toBeNull();
  });
});
