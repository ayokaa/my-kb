import { describe, it, expect, vi } from 'vitest';
import { processInboxEntry, validateLLMOutput } from '../ingest';

vi.mock('openai', () => ({
  default: vi.fn(function() {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  title: 'AI Agents in Zed',
                  tags: ['ai', 'zed', 'agent'],
                  summary: 'Zed introduces parallel AI agents',
                  personalContext: 'Useful for understanding IDE agent trends',
                  keyFacts: ['Zed now supports parallel agents', 'Agents can run simultaneously'],
                  timeline: [{ date: '2026-04', event: 'Zed launches parallel agents' }],
                  qas: [{ question: 'What are parallel agents?', answer: 'Multiple AI agents running at once' }],
                  links: [{ target: 'Zed', weight: 'weak', context: 'IDE' }],
                  content: '## Zed Parallel Agents\n\nZed now supports running multiple AI agents in parallel.',
                }),
              },
            }],
          }),
        },
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

describe('validateLLMOutput', () => {
  it('accepts a valid LLM response', () => {
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

  it('rejects non-string tags', () => {
    expect(() => validateLLMOutput({ tags: [1, null, 'ok'] })).toThrow('tags');
  });

  it('rejects non-string keyFacts', () => {
    expect(() => validateLLMOutput({ keyFacts: [1, 'ok'] })).toThrow('keyFacts');
  });

  it('rejects invalid timeline item types', () => {
    expect(() => validateLLMOutput({ timeline: ['not an object'] })).toThrow('timeline');
  });

  it('rejects invalid link weight', () => {
    expect(() => validateLLMOutput({ links: [{ target: 'T', weight: 'invalid' }] })).toThrow('weight');
  });
});

describe('processInboxEntry', () => {
  it('converts inbox entry to note via LLM', async () => {
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
  });
});
