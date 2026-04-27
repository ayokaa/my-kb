import type { Note } from '../types';

/** 倒排索引的 posting 条目 */
export interface Posting {
  noteId: string;
  field: SearchField;
}

/** 可搜索的字段类型 */
export type SearchField =
  | 'tag'
  | 'title'
  | 'qa'
  | 'keyFact'
  | 'summary'
  | 'link'
  | 'backlink'
  | 'content';

/** 内存中的倒排索引 */
export type InvertedIndexMap = Record<string, Posting[]>;

/** 搜索结果条目 */
export interface SearchResult {
  note: Note;
  score: number;
  hitFields: SearchField[];
  isLinkDiffusion: boolean;
}

/** 搜索选项 */
export interface SearchOptions {
  /** 只检索指定状态的笔记 */
  statusFilter?: Array<Note['status']>;
  /** 最大返回结果数，不设置则返回所有符合条件的笔记 */
  limit?: number;
  /** 是否启用关联扩散 */
  enableDiffusion?: boolean;
  /** 关联扩散深度 */
  diffusionDepth?: number;
  /** 关联扩散权重衰减系数 */
  diffusionDecay?: number;
}

/** Zone 权重配置 */
export interface ZoneWeights {
  [field: string]: number;
}

/** 默认 Zone 权重 */
export const DEFAULT_ZONE_WEIGHTS: ZoneWeights = {
  tag: 3.0,
  qa: 2.5,
  title: 2.0,
  summary: 1.8,
  keyFact: 1.5,
  link: 1.5,
  backlink: 1.2,
  content: 0.8,
};

/** 搜索索引文件的数据结构（JSON 格式） */
export interface SearchIndexFile {
  version: number;
  updatedAt: string;
  index: InvertedIndexMap;
  noteIds: string[];
}

/** 测试用例 */
export interface TestCase {
  query: string;
  expected: string[];
  unexpected?: string[];
  category: string;
  reason?: string;
}

/** 评估结果 */
export interface EvalResult {
  query: string;
  category: string;
  resultIds: string[];
  expected: string[];
  unexpected: string[];
  hitExpected: string[];
  missedExpected: string[];
  falsePositives: string[];
  successAt5: boolean;
  precisionAt5: number;
}

/** 评估指标汇总 */
export interface MetricsSummary {
  totalQueries: number;
  successRateAt5: number;
  avgPrecisionAt5: number;
  falsePositiveRate: number;
  perCategory: Record<string, { successRate: number; count: number }>;
}

/** 错误分析报告 */
export interface ErrorReport {
  falsePositives: Array<{
    query: string;
    wrongRetrieved: string[];
    reason: string;
  }>;
  falseNegatives: Array<{
    query: string;
    missed: string[];
    reason: string;
  }>;
  recommendations: string[];
}
