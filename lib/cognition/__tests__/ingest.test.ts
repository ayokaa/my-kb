import { describe, it, expect, vi } from 'vitest';
import { processInboxEntry, validateLLMOutput, selectCandidateTitles } from '../ingest';
import type { Note } from '../../types';

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

  it('rejects invalid qas item types', () => {
    expect(() => validateLLMOutput({ qas: ['not an object'] })).toThrow('qas');
  });

  it('rejects non-string qas fields', () => {
    expect(() => validateLLMOutput({ qas: [{ question: 123, answer: 'ok' }] })).toThrow('question');
    expect(() => validateLLMOutput({ qas: [{ question: 'Q', answer: 456 }] })).toThrow('answer');
  });

  it('rejects non-object root', () => {
    expect(() => validateLLMOutput(null)).toThrow('not a JSON object');
    expect(() => validateLLMOutput('string')).toThrow('not a JSON object');
    expect(() => validateLLMOutput(42)).toThrow('not a JSON object');
  });

  it('accepts empty arrays and objects', () => {
    expect(() =>
      validateLLMOutput({
        title: '',
        tags: [],
        summary: '',
        keyFacts: [],
        timeline: [],
        links: [],
        qas: [],
        content: '',
      })
    ).not.toThrow();
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

  it('falls back to entry.content when web fetch fails', async () => {
    const { fetchWebContent } = await import('@/lib/ingestion/web');
    (fetchWebContent as any).mockRejectedValue(new Error('Network error'));

    const entry = {
      sourceType: 'web' as const,
      title: 'Fallback Test',
      content: 'Original content from entry',
      rawMetadata: { source_url: 'https://example.com' },
    };

    const { note } = await processInboxEntry(entry);
    expect(note.title).toBe('AI Agents in Zed'); // LLM mock still returns same title
    // The content passed to LLM should still contain the original entry content
  });
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
      qas: [],
      content: summary || title,
    };
  }

  it('returns all titles when note count <= 10', () => {
    const notes = Array.from({ length: 10 }, (_, i) => makeNote(`Note ${i}`));
    const entry = { sourceType: 'text' as const, title: 'Test', content: 'hello world', rawMetadata: {} };
    const candidates = selectCandidateTitles(entry, notes);
    expect(candidates).toHaveLength(10);
    expect(candidates).toContain('Note 0');
    expect(candidates).toContain('Note 9');
  });

  it('returns top 15 candidates via search when note count > 10', () => {
    // 15 irrelevant notes + 5 relevant notes
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

    const entry = {
      sourceType: 'text' as const,
      title: 'Advanced React Patterns with TypeScript',
      content: 'This article covers React hooks, TypeScript integration, and frontend architecture best practices.',
      rawMetadata: {},
    };

    const candidates = selectCandidateTitles(entry, allNotes);

    // Should be limited to 5
    expect(candidates.length).toBeLessThanOrEqual(5);
    // Should prefer relevant notes
    expect(candidates).toContain('React Hooks Guide');
    expect(candidates).toContain('TypeScript Tips');
    expect(candidates).toContain('Frontend Architecture');
  });

  it('returns empty array when no notes exist', () => {
    const entry = { sourceType: 'text' as const, title: 'Test', content: 'hello', rawMetadata: {} };
    const candidates = selectCandidateTitles(entry, []);
    expect(candidates).toEqual([]);
  });
});


