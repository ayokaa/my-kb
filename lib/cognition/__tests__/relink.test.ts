import { describe, it, expect, vi } from 'vitest';
import { relinkNote, runRelinkJob } from '../relink';
import type { Note } from '../../types';

vi.mock('openai', () => ({
  default: vi.fn(function () {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  links: [
                    { target: 'Note B', weight: 'weak', context: 'related' },
                  ],
                }),
              },
            }],
          }),
        },
      },
    };
  }),
}));

function makeNote(id: string, title: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    title,
    tags: [],
    status: 'seed',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    sources: [],
    summary: '',
    personalContext: '',
    keyFacts: [],
    timeline: [],
    links: [],
    qas: [],
    content: title,
    ...extra,
  };
}

describe('relinkNote', () => {
  it('merges new links with existing links without deleting old ones', async () => {
    const noteA = makeNote('a', 'Note A', {
      links: [{ target: 'Note C', weight: 'strong', context: 'old' }],
    });
    const noteB = makeNote('b', 'Note B');
    const noteC = makeNote('c', 'Note C');

    const result = await relinkNote(noteA, [noteA, noteB, noteC]);

    expect(result).toHaveLength(2);
    expect(result.map((l) => l.target)).toContain('Note B');
    expect(result.map((l) => l.target)).toContain('Note C');
  });

  it('does not link a note to itself', async () => {
    const noteA = makeNote('a', 'Note A');

    const result = await relinkNote(noteA, [noteA]);

    expect(result).toHaveLength(0);
  });

  it('filters out void links (non-existent targets)', async () => {
    vi.doMock('openai', () => ({
      default: vi.fn(function () {
        return {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      links: [
                        { target: 'Note B', weight: 'weak' },
                        { target: 'Ghost Note', weight: 'weak' },
                      ],
                    }),
                  },
                }],
              }),
            },
          },
        };
      }),
    }));

    const noteA = makeNote('a', 'Note A');
    const noteB = makeNote('b', 'Note B');

    const { relinkNote: relinkNoteFresh } = await import('../relink');
    const result = await relinkNoteFresh(noteA, [noteA, noteB]);

    expect(result.map((l) => l.target)).toContain('Note B');
    expect(result.map((l) => l.target)).not.toContain('Ghost Note');

    vi.doUnmock('openai');
  });

  it('deduplicates links by target (prefer existing)', async () => {
    const noteA = makeNote('a', 'Note A', {
      links: [{ target: 'Note B', weight: 'strong', context: 'existing' }],
    });
    const noteB = makeNote('b', 'Note B');

    const result = await relinkNote(noteA, [noteA, noteB]);

    const linkB = result.find((l) => l.target === 'Note B');
    expect(linkB?.weight).toBe('strong');
    expect(linkB?.context).toBe('existing');
  });

  it('returns empty links when no other notes exist', async () => {
    const noteA = makeNote('a', 'Note A');
    const result = await relinkNote(noteA, [noteA]);
    expect(result).toEqual([]);
  });
});

describe('runRelinkJob', () => {
  it('processes all notes and reports stats', async () => {
    const notes = [
      makeNote('a', 'Note A'),
      makeNote('b', 'Note B'),
    ];
    const saved: Note[] = [];

    const result = await runRelinkJob(
      async () => notes,
      async (note) => { saved.push(note); }
    );

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    // Both notes got new links from mocked LLM
    expect(result.updated).toBe(2);
    expect(saved.length).toBe(2);
  });

  it('handles empty knowledge base', async () => {
    const result = await runRelinkJob(
      async () => [],
      async () => {}
    );

    expect(result).toEqual({ processed: 0, updated: 0, failed: 0 });
  });

  it('counts failures when relinkNote throws', async () => {
    const notes = [
      makeNote('a', 'Note A'),
      makeNote('b', 'Note B'),
    ];

    let callCount = 0;
    const result = await runRelinkJob(
      async () => notes,
      async () => {
        callCount++;
        if (callCount === 1) throw new Error('save failed');
      }
    );

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(1);
  });
});
