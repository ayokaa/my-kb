import type { Note } from '../types';
import type { EvalResult, MetricsSummary, ErrorReport, TestCase } from './types';
import type { SearchResult } from './types';

/**
 * 对单个测试用例计算评估指标。
 */
export function evaluateCase(
  testCase: TestCase,
  results: SearchResult[]
): EvalResult {
  const resultIds = results.slice(0, 5).map(r => r.note.id);
  const expected = testCase.expected;
  const unexpected = testCase.unexpected || [];

  const hitExpected = expected.filter(id => resultIds.includes(id));
  const missedExpected = expected.filter(id => !resultIds.includes(id));
  const falsePositives = resultIds.filter(id => unexpected.includes(id));

  // Success@5: 至少一个 expected 在 Top-5 中，或者 expected 为空且无结果
  const successAt5 =
    expected.length === 0
      ? resultIds.length === 0
      : hitExpected.length > 0;

  // Precision@5: Top-5 中正确的比例
  const correctCount = resultIds.filter(id => expected.includes(id)).length;
  const precisionAt5 =
    expected.length === 0
      ? resultIds.length === 0
        ? 1
        : 0
      : correctCount / Math.max(resultIds.length, 1);

  return {
    query: testCase.query,
    category: testCase.category,
    resultIds,
    expected,
    unexpected,
    hitExpected,
    missedExpected,
    falsePositives,
    successAt5,
    precisionAt5,
  };
}

/**
 * 汇总多个评估结果。
 */
export function summarizeMetrics(results: EvalResult[]): MetricsSummary {
  const total = results.length;
  const successCount = results.filter(r => r.successAt5).length;
  const precisionSum = results.reduce((sum, r) => sum + r.precisionAt5, 0);
  const fpCount = results.reduce((sum, r) => sum + r.falsePositives.length, 0);

  // 按类别汇总
  const categoryMap = new Map<string, { success: number; count: number }>();
  for (const r of results) {
    const c = categoryMap.get(r.category) || { success: 0, count: 0 };
    c.count++;
    if (r.successAt5) c.success++;
    categoryMap.set(r.category, c);
  }

  const perCategory: Record<string, { successRate: number; count: number }> = {};
  for (const [cat, data] of categoryMap) {
    perCategory[cat] = {
      successRate: data.count > 0 ? data.success / data.count : 0,
      count: data.count,
    };
  }

  return {
    totalQueries: total,
    successRateAt5: total > 0 ? successCount / total : 0,
    avgPrecisionAt5: total > 0 ? precisionSum / total : 0,
    falsePositiveRate: total > 0 ? fpCount / (total * 5) : 0,
    perCategory,
  };
}

/**
 * 生成错误分析报告。
 */
export function generateErrorReport(results: EvalResult[]): ErrorReport {
  const falsePositives = results
    .filter(r => r.falsePositives.length > 0)
    .map(r => ({
      query: r.query,
      wrongRetrieved: r.falsePositives,
      reason: `查询"${r.query}"误检索到不相关笔记: ${r.falsePositives.join(', ')}`,
    }));

  const falseNegatives = results
    .filter(r => r.missedExpected.length > 0)
    .map(r => ({
      query: r.query,
      missed: r.missedExpected,
      reason: `查询"${r.query}"漏掉了期望笔记: ${r.missedExpected.join(', ')}`,
    }));

  const recommendations: string[] = [];

  if (falsePositives.length > 0) {
    recommendations.push(
      `有 ${falsePositives.length} 个查询存在误检索，建议检查权重配置或增加负例过滤。`
    );
  }

  if (falseNegatives.length > 0) {
    recommendations.push(
      `有 ${falseNegatives.length} 个查询存在漏检，建议检查字段覆盖或降低内容匹配阈值。`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('当前测试集全部通过，无错误需要修复。');
  }

  return {
    falsePositives,
    falseNegatives,
    recommendations,
  };
}

/**
 * 质量门检查。
 */
export const QUALITY_GATES = {
  successRateAt5: 0.90,
  avgPrecisionAt5: 0.70,
  falsePositiveRate: 0.10,
};

export function checkQualityGates(metrics: MetricsSummary): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];

  if (metrics.successRateAt5 < QUALITY_GATES.successRateAt5) {
    failures.push(
      `SuccessRate@5 ${(metrics.successRateAt5 * 100).toFixed(1)}% < 目标 ${(QUALITY_GATES.successRateAt5 * 100).toFixed(0)}%`
    );
  }
  if (metrics.avgPrecisionAt5 < QUALITY_GATES.avgPrecisionAt5) {
    failures.push(
      `AvgPrecision@5 ${(metrics.avgPrecisionAt5 * 100).toFixed(1)}% < 目标 ${(QUALITY_GATES.avgPrecisionAt5 * 100).toFixed(0)}%`
    );
  }
  if (metrics.falsePositiveRate > QUALITY_GATES.falsePositiveRate) {
    failures.push(
      `FalsePositiveRate ${(metrics.falsePositiveRate * 100).toFixed(1)}% > 目标 ${(QUALITY_GATES.falsePositiveRate * 100).toFixed(0)}%`
    );
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
