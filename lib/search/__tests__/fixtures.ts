import type { Note } from '../../types';

export const RAG_NOTE: Note = {
  id: 'rag-overview',
  title: 'RAG 检索增强生成',
  tags: ['ai', 'rag', 'llm'],
  status: 'evergreen',
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  sources: ['https://example.com/rag'],
  summary: '通过检索外部知识增强 LLM 回答准确性',
  personalContext: '对理解大模型应用架构很重要',
  keyFacts: ['RAG 减少幻觉', '检索质量决定生成质量', '比微调更灵活'],
  timeline: [{ date: '2023-01', event: 'RAG 概念提出' }],
  links: [{ target: '向量数据库', weight: 'strong', context: 'RAG 依赖向量数据库做语义检索' }],
  qas: [
    { question: '什么是 RAG？', answer: '检索增强生成是一种结合外部知识检索的生成方法。' },
    { question: 'RAG 和微调的区别？', answer: 'RAG 不需要训练模型，通过检索动态获取知识。' },
  ],
  content: 'RAG（Retrieval-Augmented Generation）是一种将信息检索与文本生成相结合的技术框架。',
};

export const VECTOR_DB_NOTE: Note = {
  id: 'vector-db',
  title: '向量数据库简介',
  tags: ['database', 'ai', 'vector'],
  status: 'evergreen',
  created: '2024-02-01T00:00:00Z',
  updated: '2024-02-01T00:00:00Z',
  sources: ['https://example.com/vectordb'],
  summary: '用向量相似度实现语义搜索的数据库',
  personalContext: '构建 AI 应用的基础设施',
  keyFacts: ['支持高维向量存储', '用余弦相似度计算距离'],
  timeline: [],
  links: [{ target: 'RAG 检索增强生成', weight: 'strong', context: '向量数据库是 RAG 的基础设施' }],
  qas: [
    { question: '什么是向量数据库？', answer: '专门存储和检索高维向量数据的数据库。' },
  ],
  content: '向量数据库（Vector Database）是一种专门用于存储和查询高维向量数据的数据库系统。',
};

export const COOKING_NOTE: Note = {
  id: 'cooking-recipe',
  title: '红烧肉做法',
  tags: ['cooking', 'food'],
  status: 'growing',
  created: '2024-03-01T00:00:00Z',
  updated: '2024-03-01T00:00:00Z',
  sources: [],
  summary: '家常红烧肉的做法',
  personalContext: '周末想试试做菜',
  keyFacts: ['需要五花肉', '炒糖色是关键', '小火慢炖一小时'],
  timeline: [],
  links: [],
  qas: [],
  content: '红烧肉的详细做法：选材、焯水、炒糖色、炖煮。',
};

export const SEED_NOTE: Note = {
  id: 'seed-note',
  title: '种子笔记',
  tags: ['test'],
  status: 'seed',
  created: '2024-04-01T00:00:00Z',
  updated: '2024-04-01T00:00:00Z',
  sources: [],
  summary: '一个种子状态的笔记',
  personalContext: '',
  keyFacts: ['种子状态'],
  timeline: [],
  links: [],
  qas: [],
  content: '这是种子状态的内容。',
};

export const ALL_TEST_NOTES = [RAG_NOTE, VECTOR_DB_NOTE, COOKING_NOTE, SEED_NOTE];

export const HIT_TEST_CASES = [
  { query: 'ai', expected: ['rag-overview', 'vector-db'], category: 'tag-match', reason: 'tag 精确匹配' },
  { query: '什么是 RAG', expected: ['rag-overview'], category: 'qa-match', reason: 'QA 问题匹配' },
  { query: '减少幻觉', expected: ['rag-overview'], category: 'keyFact-match', reason: 'keyFact 匹配' },
  { query: '向量数据库', expected: ['vector-db'], category: 'title-match', reason: 'title 匹配' },
  { query: 'RAG 和向量数据库', expected: ['rag-overview', 'vector-db'], category: 'multi-term-link-diffusion', reason: '多关键词 + 关联扩散' },
  { query: '检索增强', expected: ['rag-overview'], category: 'title-match', reason: 'title 关键词匹配' },
  { query: '语义搜索', expected: ['vector-db'], category: 'content-match', reason: 'content 匹配' },
  { query: '红烧肉', expected: ['cooking-recipe'], category: 'title-match', reason: 'title 匹配' },
];

export const MISS_TEST_CASES = [
  { query: 'xyzqwerty12345', expected: [], unexpected: ['rag-overview', 'vector-db', 'cooking-recipe'], category: 'negative-test', reason: '完全无关查询不应召回任何笔记' },
  { query: '机器学习', expected: [], unexpected: ['cooking-recipe'], category: 'negative-test', reason: 'tag 匹配不应跨领域' },
];

export const RANK_TEST_CASES = [
  {
    query: 'RAG',
    expectedOrder: ['rag-overview', 'vector-db'],
    category: 'rank-test',
    reason: 'rag-overview 的 tag/title/qa 都含 RAG，应排第一',
  },
  {
    query: '数据库',
    expectedOrder: ['vector-db', 'rag-overview'],
    category: 'rank-test',
    reason: 'vector-db 的 title 含数据库，rag-overview 只在 links 中提及',
  },
];
