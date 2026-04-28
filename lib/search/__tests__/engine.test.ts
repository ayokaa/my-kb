import { describe, test, expect } from 'vitest';
import { buildIndex } from '../inverted-index';
import { scoreNote, buildLinkMap, diffuseLinks, search, assembleContext } from '../engine';
import { DEFAULT_ZONE_WEIGHTS } from '../types';
import type { SearchField } from '../types';
import { RAG_NOTE, VECTOR_DB_NOTE, COOKING_NOTE, ALL_TEST_NOTES } from './fixtures';

describe('buildLinkMap', () => {
  test('构建正确的 link 反向映射', () => {
    const map = buildLinkMap([RAG_NOTE, VECTOR_DB_NOTE]);
    expect(map.get('向量数据库')).toContain('rag-overview');
    expect(map.get('RAG 检索增强生成')).toContain('vector-db');
  });
});

describe('scoreNote', () => {
  const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);

  test('tag 命中得分最高', () => {
    const { score, hitFields } = scoreNote('rag-overview', ['llm'], index);
    // 'llm' 只在 rag-overview 的 tag 中命中
    expect(score).toBeGreaterThan(0);
    expect(hitFields).toContain('tag');
  });

  test('多字段命中分数累加高于单字段', () => {
    const scoreLlm = scoreNote('rag-overview', ['llm'], index).score; // 只命中 tag
    const scoreRag = scoreNote('rag-overview', ['rag'], index).score; // 命中多个字段
    expect(scoreRag).toBeGreaterThan(scoreLlm);
  });

  test('content 命中得分低于 title/tag', () => {
    const { score, hitFields } = scoreNote('rag-overview', ['retrieval'], index);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(DEFAULT_ZONE_WEIGHTS.title);
    expect(hitFields).toContain('content');
  });

  test('多 term 分数累加', () => {
    const scoreRag = scoreNote('rag-overview', ['rag'], index).score;
    const scoreRagWhat = scoreNote('rag-overview', ['rag', '什么是'], index).score;
    // 增加第二个查询词后总分应更高
    expect(scoreRagWhat).toBeGreaterThan(scoreRag);
  });

  test('未命中返回 0 分', () => {
    const { score } = scoreNote('rag-overview', ['红烧肉'], index);
    expect(score).toBe(0);
  });

  test('同一 term 多字段命中分数累加（含 IDF）', () => {
    // 'rag' 在 tag/title/keyFact/content/qa 等多个字段中都有，分数累加
    const { score } = scoreNote('rag-overview', ['rag'], index);
    // 多字段累加后分数应显著高于单个最高权重字段
    expect(score).toBeGreaterThan(DEFAULT_ZONE_WEIGHTS.tag * 1.5);
  });
});

describe('diffuseLinks', () => {
  test('link diffusion 包含关联笔记', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);
    const scored = new Map([
      [
        'rag-overview',
        {
          note: RAG_NOTE,
          score: 10,
          hitFields: ['tag'] as SearchField[],
          isLinkDiffusion: false,
        },
      ],
    ]);

    const diffused = diffuseLinks(scored, [RAG_NOTE, VECTOR_DB_NOTE], 1, 0.3);
    expect(diffused.has('vector-db')).toBe(true);
    expect(diffused.get('vector-db')!.score).toBe(3); // 10 * 0.3
    expect(diffused.get('vector-db')!.isLinkDiffusion).toBe(true);
  });

  test('已直接命中的笔记不被 diffusion 重复', () => {
    const index = buildIndex([RAG_NOTE, VECTOR_DB_NOTE]);
    const scored = new Map([
      [
        'rag-overview',
        {
          note: RAG_NOTE,
          score: 10,
          hitFields: ['tag'] as SearchField[],
          isLinkDiffusion: false,
        },
      ],
    ]);

    const diffused = diffuseLinks(scored, [RAG_NOTE, VECTOR_DB_NOTE], 1, 0.3);
    // rag-overview 自身不会通过 diffusion 添加
    expect(diffused.get('rag-overview')!.isLinkDiffusion).toBe(false);
  });

  test('diffusion 分数正确衰减', () => {
    const scored = new Map([
      [
        'rag-overview',
        {
          note: RAG_NOTE,
          score: 10,
          hitFields: ['tag'] as SearchField[],
          isLinkDiffusion: false,
        },
      ],
    ]);

    const diffused = diffuseLinks(scored, [RAG_NOTE, VECTOR_DB_NOTE], 1, 0.5);
    expect(diffused.get('vector-db')!.score).toBe(5); // 10 * 0.5
  });
});

describe('search', () => {
  test('tag 精确匹配召回相关笔记', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('ai', ALL_TEST_NOTES, index, { enableDiffusion: false });
    const ids = results.map(r => r.note.id);
    expect(ids).toContain('rag-overview');
    expect(ids).toContain('vector-db');
  });

  test('title 命中排在 content 命中前面', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('数据库', ALL_TEST_NOTES, index, { enableDiffusion: false });
    expect(results[0].note.id).toBe('vector-db');
  });

  test('空查询返回空结果', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    expect(search('', ALL_TEST_NOTES, index)).toEqual([]);
  });

  test('无匹配返回空结果', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    // 使用停用词 + 生造组合，确保没有任何笔记包含这些词
    const results = search('xyzqwerty12345', ALL_TEST_NOTES, index);
    expect(results).toHaveLength(0);
  });

  test('状态过滤只返回符合条件的笔记', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    // seed-note 的 tag 是 'test'，但状态是 'seed'
    const results = search('test', ALL_TEST_NOTES, index, {
      statusFilter: ['evergreen', 'growing'],
    });
    expect(results.map(r => r.note.id)).not.toContain('seed-note');
  });

  test('关联扩散启用时包含关联笔记', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('RAG', ALL_TEST_NOTES, index, { enableDiffusion: true });
    const ids = results.map(r => r.note.id);
    expect(ids).toContain('vector-db'); // 通过 link diffusion
  });

  test('limit 参数限制返回数量', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('ai', ALL_TEST_NOTES, index, { limit: 1, enableDiffusion: false });
    expect(results).toHaveLength(1);
  });

  test('多关键词 OR 语义', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('RAG LLM', ALL_TEST_NOTES, index, { enableDiffusion: false });
    // RAG 命中 rag-overview，LLM 也命中 rag-overview（tag）
    const rag = results.find(r => r.note.id === 'rag-overview');
    expect(rag).toBeDefined();
  });

  test('多关键词同时命中的笔记排序更高', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('RAG 检索', ALL_TEST_NOTES, index, { enableDiffusion: false });
    // rag-overview 的 title 同时包含 RAG 和 检索
    expect(results[0].note.id).toBe('rag-overview');
  });

  test('backlink field has non-zero weight in scoring', () => {
    // Verify that 'backlink' is a valid SearchField with a positive weight
    expect(DEFAULT_ZONE_WEIGHTS.backlink).toBeGreaterThan(0);
    // Verify backlink postings actually contribute to score
    const idx = buildIndex([RAG_NOTE]);
    const { score } = scoreNote('rag-overview', ['大模型'], idx);
    // '大模型' appears in backlinks of RAG_NOTE — should contribute positive score
    expect(score).toBeGreaterThan(0);
  });
});

describe('assembleContext', () => {
  test('生成包含笔记信息的上下文', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('RAG', ALL_TEST_NOTES, index, { enableDiffusion: false });
    const context = assembleContext(results);
    expect(context).toContain('RAG 检索增强生成');
    expect(context).toContain('摘要');
  });

  test('扩散笔记只包含摘要', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const results = search('RAG', ALL_TEST_NOTES, index, { enableDiffusion: true });
    const diffused = results.find(r => r.isLinkDiffusion);
    if (diffused) {
      const context = assembleContext([diffused]);
      expect(context).toContain('相关笔记');
      expect(context).toContain('关联原因');
    }
  });
});
