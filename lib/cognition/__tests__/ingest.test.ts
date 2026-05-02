import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Note } from '../../types';

// Shared mock for LLM messages.create — hoisted so vi.mock can access it
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function () {
    return {
      messages: {
        create: mockCreate,
      },
    };
  }),
}));

vi.mock('@/lib/ingestion/web', () => ({
  fetchWebContent: vi.fn().mockResolvedValue({
    title: 'Zed Parallel Agents',
    content: 'Zed now supports running multiple AI agents in parallel within the same window.',
    excerpt: 'Parallel agents in Zed',
  }),
}));

import { processInboxEntry, validateLLMOutput, validateExtractOutput, validateQAOutput, validateLinkOutput, selectCandidateTitles } from '../ingest';

function anthropicResponse(text: string) {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: '',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

/** Set up mock to return three-step pipeline responses */
function setupThreeStepMock(overrides: { extract?: any; qa?: any; links?: any } = {}) {
  const extractResponse = overrides.extract ?? {
    title: 'AI Agents in Zed',
    tags: ['ai', 'zed', 'agent'],
    summary: 'Zed introduces parallel AI agents',
    personalContext: 'Useful for understanding IDE agent trends',
    keyFacts: ['Zed now supports parallel agents', 'Agents can run simultaneously'],
    timeline: [{ date: '2026-04', event: 'Zed launches parallel agents' }],
    content: '## Zed Parallel Agents\n\nZed now supports running multiple AI agents in parallel.',
  };
  const qaResponse = overrides.qa ?? {
    qas: [{ question: 'What are parallel agents?', answer: 'Multiple AI agents running at once' }],
  };
  const linksResponse = overrides.links ?? {
    links: [{ target: 'Zed', weight: 'weak', context: 'IDE' }],
  };

  const responses = [
    anthropicResponse(JSON.stringify(extractResponse)),
    anthropicResponse(JSON.stringify(qaResponse)),
    anthropicResponse(JSON.stringify(linksResponse)),
  ];

  let callIndex = 0;
  mockCreate.mockImplementation(() => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return Promise.resolve(resp);
  });
}

/** Set up mock where a specific step fails */
function setupFailingStepMock(failAtStep: number, extractData: any, qaData?: any) {
  const failError = failAtStep === 2 ? 'QA API error' : 'Link API error';

  let callIndex = 0;
  mockCreate.mockImplementation(() => {
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve(anthropicResponse(JSON.stringify(extractData)));
    }
    if (callIndex === 2) {
      if (failAtStep === 2) return Promise.reject(new Error(failError));
      return Promise.resolve(anthropicResponse(JSON.stringify(qaData ?? { qas: [] })));
    }
    if (failAtStep === 3) return Promise.reject(new Error(failError));
    return Promise.resolve(anthropicResponse(JSON.stringify({ links: [] })));
  });
}

describe('validateExtractOutput', () => {
  it('accepts valid extract output', () => {
    expect(() =>
      validateExtractOutput({
        title: 'Test',
        tags: ['a', 'b'],
        summary: 'Summary',
        keyFacts: ['f1'],
        timeline: [{ date: '2024-01', event: 'E1' }],
        content: 'Body',
      })
    ).not.toThrow();
  });

  it('rejects non-object root', () => {
    expect(() => validateExtractOutput(null)).toThrow('not a JSON object');
    expect(() => validateExtractOutput('string')).toThrow('not a JSON object');
  });

  it('rejects non-string tags', () => {
    expect(() => validateExtractOutput({ tags: [1, null, 'ok'] })).toThrow('tags');
  });

  it('rejects non-string keyFacts', () => {
    expect(() => validateExtractOutput({ keyFacts: [1, 'ok'] })).toThrow('keyFacts');
  });

  it('rejects invalid timeline item types', () => {
    expect(() => validateExtractOutput({ timeline: ['not an object'] })).toThrow('timeline');
  });

  it('accepts empty arrays', () => {
    expect(() =>
      validateExtractOutput({
        title: '',
        tags: [],
        summary: '',
        keyFacts: [],
        timeline: [],
        content: '',
      })
    ).not.toThrow();
  });
});

describe('validateQAOutput', () => {
  it('accepts valid QA output', () => {
    expect(() =>
      validateQAOutput({ qas: [{ question: 'Q', answer: 'A' }] })
    ).not.toThrow();
  });

  it('rejects invalid qas item types', () => {
    expect(() => validateQAOutput({ qas: ['not an object'] })).toThrow('qas');
  });

  it('rejects non-string qas fields', () => {
    expect(() => validateQAOutput({ qas: [{ question: 123, answer: 'ok' }] })).toThrow('question');
    expect(() => validateQAOutput({ qas: [{ question: 'Q', answer: 456 }] })).toThrow('answer');
  });
});

describe('validateLinkOutput', () => {
  it('accepts valid link output', () => {
    expect(() =>
      validateLinkOutput({ links: [{ target: 'T', weight: 'weak' }] })
    ).not.toThrow();
  });

  it('rejects invalid link weight', () => {
    expect(() => validateLinkOutput({ links: [{ target: 'T', weight: 'invalid' }] })).toThrow('weight');
  });
});

describe('validateLLMOutput (backwards compatible)', () => {
  it('accepts a valid full LLM response', () => {
    expect(() =>
      validateLLMOutput({
        title: 'Test',
        tags: ['a', 'b'],
        summary: 'Summary',
        keyFacts: ['f1'],
        timeline: [{ date: '2024-01', event: 'E1' }],
        links: [{ target: 'T', weight: 'weak' }],
        qas: [{ question: 'Q', answer: 'A' }],
        content: 'Body',
      })
    ).not.toThrow();
  });

  it('rejects non-object root', () => {
    expect(() => validateLLMOutput(null)).toThrow('not a JSON object');
    expect(() => validateLLMOutput(42)).toThrow('not a JSON object');
  });
});

describe('processInboxEntry', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('converts inbox entry to note via three-step pipeline', async () => {
    setupThreeStepMock();

    const entry = {
      sourceType: 'web' as const,
      title: 'Introducing Parallel Agents in Zed',
      content: 'Zed now supports running multiple AI agents in parallel within the same window.',
      rawMetadata: { source_url: 'https://zed.dev/blog/parallel-agents' },
    };

    const { note } = await processInboxEntry(entry);

    expect(note.title).toBe('AI Agents in Zed');
    expect(note.tags).toContain('ai');
    expect(note.summary).toBe('Zed introduces parallel AI agents');
    expect(note.keyFacts.length).toBeGreaterThan(0);
    expect(note.content).toContain('Parallel Agents');
    expect(note.sources).toContain('https://zed.dev/blog/parallel-agents');
    expect(note.status).toBe('seed');
    expect(note.qas).toHaveLength(1);
    expect(note.qas[0].question).toBe('What are parallel agents?');
    // 2 LLM calls: extract + QA (link step skipped because no existing notes)
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('falls back to entry.content when web fetch fails', async () => {
    const { fetchWebContent } = await import('@/lib/ingestion/web');
    (fetchWebContent as any).mockRejectedValue(new Error('Network error'));

    setupThreeStepMock();

    const entry = {
      sourceType: 'web' as const,
      title: 'Fallback Test',
      content: 'Original content from entry that is long enough to pass the minimum content length check for LLM processing',
      rawMetadata: { source_url: 'https://example.com' },
    };

    const { note } = await processInboxEntry(entry);
    expect(note.title).toBe('AI Agents in Zed');
  });

  it('produces valid note when QA step fails', async () => {
    setupFailingStepMock(2, {
      title: 'Resilient Note',
      tags: ['test'],
      summary: 'Test summary',
      personalContext: '',
      keyFacts: ['fact'],
      timeline: [],
      content: 'Content',
    });

    const entry = {
      sourceType: 'text' as const,
      title: 'Resilience Test',
      content: 'Testing QA failure resilience',
      rawMetadata: {},
    };

    const { note } = await processInboxEntry(entry);
    expect(note.title).toBe('Resilient Note');
    expect(note.qas).toEqual([]);
    expect(note.links).toEqual([]);
  });

  it('produces valid note when Link step fails', async () => {
    setupFailingStepMock(3, {
      title: 'Link Fail Note',
      tags: ['test'],
      summary: 'Test',
      personalContext: '',
      keyFacts: [],
      timeline: [],
      content: 'Content',
    }, { qas: [{ question: 'Q', answer: 'A' }] });

    const entry = {
      sourceType: 'text' as const,
      title: 'Link Fail Test',
      content: 'Testing link failure resilience',
      rawMetadata: {},
    };

    const { note } = await processInboxEntry(entry);
    expect(note.title).toBe('Link Fail Note');
    expect(note.qas).toHaveLength(1);
    expect(note.links).toEqual([]);
  });
});

  it('includes userHint in LLM prompt when present', async () => {
    mockCreate.mockClear();
    setupThreeStepMock();

    const entry = {
      sourceType: 'text' as const,
      title: 'Distributed Systems Article',
      content: 'This article covers distributed systems architecture patterns for building resilient cloud-native applications.',
      rawMetadata: { userHint: '重点关注性能优化部分，提取具体的延迟数据和优化手段' },
    };

    await processInboxEntry(entry);

    // Verify the user prompt sent to LLM contains the hint
    const firstCallArgs = mockCreate.mock.calls[0][0];
    const userMessage = firstCallArgs.messages[0].content;
    expect(userMessage).toContain('【用户提示】');
    expect(userMessage).toContain('重点关注性能优化部分');
    expect(userMessage).toContain('提取具体的延迟数据和优化手段');
  });

  it('does not include hint section when userHint is absent', async () => {
    mockCreate.mockClear();
    setupThreeStepMock();

    const entry = {
      sourceType: 'text' as const,
      title: 'Plain Article',
      content: 'Some content about technology and science for general reading purposes.',
      rawMetadata: {},
    };

    await processInboxEntry(entry);

    const firstCallArgs = mockCreate.mock.calls[0][0];
    const userMessage = firstCallArgs.messages[0].content;
    expect(userMessage).not.toContain('【用户提示】');
  });

describe('selectCandidateTitles', () => {
  function makeNote(title: string, tags: string[] = [], summary = ''): Note {
    return {
      id: title.toLowerCase().replace(/\s+/g, '-'),
      title,
      tags,
      status: 'seed',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      sources: [],
      summary,
      personalContext: '',
      keyFacts: [],
      timeline: [],
      links: [],
      backlinks: [],
      qas: [],
      content: summary || title,
    };
  }

  it('returns all titles when note count <= 10', () => {
    const notes = Array.from({ length: 10 }, (_, i) => makeNote(`Note ${i}`));
    const source = { title: 'Test', content: 'hello world' };
    const candidates = selectCandidateTitles(source, notes);
    expect(candidates).toHaveLength(10);
    expect(candidates).toContain('Note 0');
    expect(candidates).toContain('Note 9');
  });

  it('returns top 20 candidates via search when note count > 10', () => {
    const irrelevant = Array.from({ length: 15 }, (_, i) =>
      makeNote(`Irrelevant ${i}`, ['random', 'noise'], 'something unrelated')
    );
    const relevant = [
      makeNote('React Hooks Guide', ['react', 'hooks'], 'A guide to React hooks and state management'),
      makeNote('TypeScript Tips', ['typescript', 'types'], 'Advanced TypeScript patterns'),
      makeNote('Node.js Performance', ['nodejs', 'performance'], 'Optimizing Node.js applications'),
      makeNote('Frontend Architecture', ['frontend', 'architecture'], 'Scalable frontend design'),
      makeNote('CSS Grid Layout', ['css', 'layout'], 'Modern CSS layout techniques'),
    ];
    const allNotes = [...irrelevant, ...relevant];

    const source = {
      title: 'Advanced React Patterns with TypeScript',
      content: 'This article covers React hooks, TypeScript integration, and frontend architecture best practices.',
    };

    const candidates = selectCandidateTitles(source, allNotes);

    expect(candidates.length).toBeLessThanOrEqual(20);
    expect(candidates).toContain('React Hooks Guide');
    expect(candidates).toContain('TypeScript Tips');
    expect(candidates).toContain('Frontend Architecture');
  });

  it('returns empty array when no notes exist', () => {
    const source = { title: 'Test', content: 'hello' };
    const candidates = selectCandidateTitles(source, []);
    expect(candidates).toEqual([]);
  });
});
