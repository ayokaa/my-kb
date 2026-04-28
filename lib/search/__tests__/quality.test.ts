import { describe, test, expect } from 'vitest';
import { buildIndex } from '../inverted-index';
import { search } from '../engine';
import { evaluateCase, summarizeMetrics, generateErrorReport, checkQualityGates, QUALITY_GATES } from '../eval';
import { ALL_TEST_NOTES, HIT_TEST_CASES, MISS_TEST_CASES, RANK_TEST_CASES } from './fixtures';
import type { TestCase } from '../types';

describe('检索效果评估', () => {
  const index = buildIndex(ALL_TEST_NOTES);

  // 合并所有测试用例
  const allCases: TestCase[] = [
    ...HIT_TEST_CASES.map(c => ({ ...c, unexpected: [] })),
    ...MISS_TEST_CASES,
  ];

  const evalResults = allCases.map(tc => {
    const results = search(tc.query, ALL_TEST_NOTES, index, { enableDiffusion: true });
    return evaluateCase(tc, results);
  });

  const metrics = summarizeMetrics(evalResults);

  test(`SuccessRate@5 >= ${QUALITY_GATES.successRateAt5 * 100}%`, () => {
    expect(metrics.successRateAt5).toBeGreaterThanOrEqual(QUALITY_GATES.successRateAt5);
  });

  test(`AvgPrecision@5 >= ${QUALITY_GATES.avgPrecisionAt5 * 100}%`, () => {
    expect(metrics.avgPrecisionAt5).toBeGreaterThanOrEqual(QUALITY_GATES.avgPrecisionAt5);
  });

  test(`FalsePositiveRate <= ${QUALITY_GATES.falsePositiveRate * 100}%`, () => {
    expect(metrics.falsePositiveRate).toBeLessThanOrEqual(QUALITY_GATES.falsePositiveRate);
  });

  test('Hit 测试用例全部命中', () => {
    const hitEvals = evalResults.filter(r =>
      HIT_TEST_CASES.some(c => c.query === r.query)
    );
    for (const ev of hitEvals) {
      expect(ev.successAt5).toBe(true);
    }
  });

  test('Miss 测试用例无误检索', () => {
    const missEvals = evalResults.filter(r =>
      MISS_TEST_CASES.some(c => c.query === r.query)
    );
    for (const ev of missEvals) {
      expect(ev.falsePositives).toHaveLength(0);
    }
  });

  test('质量门全部通过', () => {
    const gate = checkQualityGates(metrics);
    expect(gate.passed).toBe(true);
    if (!gate.passed) {
      console.error('质量门失败:', gate.failures);
    }
  });

  test('排序正确性测试', () => {
    for (const tc of RANK_TEST_CASES) {
      const results = search(tc.query, ALL_TEST_NOTES, index, { enableDiffusion: false });
      const resultIds = results.map(r => r.note.id);
      const positions = tc.expectedOrder.map(id => resultIds.indexOf(id));

      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    }
  });
});

describe('Error Report', () => {
  test('生成错误报告不报错', () => {
    const index = buildIndex(ALL_TEST_NOTES);
    const allCases: TestCase[] = [
      ...HIT_TEST_CASES.map(c => ({ ...c, unexpected: [] })),
      ...MISS_TEST_CASES,
    ];
    const evalResults = allCases.map(tc => {
      const results = search(tc.query, ALL_TEST_NOTES, index, { enableDiffusion: true });
      return evaluateCase(tc, results);
    });
    const report = generateErrorReport(evalResults);
    expect(report).toHaveProperty('falsePositives');
    expect(report).toHaveProperty('falseNegatives');
    expect(report).toHaveProperty('recommendations');
  });
});

describe('evaluateCase', () => {
  test('expected 为空且结果为空时 successAt5 = true', () => {
    const result = evaluateCase(
      { query: 'xxx', expected: [], category: 'test' },
      []
    );
    expect(result.successAt5).toBe(true);
    expect(result.precisionAt5).toBe(1);
  });

  test('expected 为空但结果非空时 precisionAt5 = 0', () => {
    const result = evaluateCase(
      { query: 'xxx', expected: [], category: 'test' },
      [{ note: ALL_TEST_NOTES[0], score: 1, hitFields: ['tag'], isLinkDiffusion: false }]
    );
    expect(result.precisionAt5).toBe(0);
  });

  test('正确计算 hitExpected 和 missedExpected', () => {
    const result = evaluateCase(
      { query: 'ai', expected: ['rag-overview', 'missing-id'], category: 'test' },
      [{ note: ALL_TEST_NOTES[0], score: 1, hitFields: ['tag'], isLinkDiffusion: false }]
    );
    expect(result.hitExpected).toEqual(['rag-overview']);
    expect(result.missedExpected).toEqual(['missing-id']);
  });
});
