import { basename } from 'path';
import yaml from 'js-yaml';
import type { Note, NoteLink, TimelineEntry, QAEntry, InboxEntry, SourceType } from './types';

export function parseInboxEntry(raw: string, path: string): InboxEntry {
  // Robust frontmatter extraction: looks for --- at the very start,
  // then finds the closing --- on its own line.
  if (!raw.startsWith('---')) {
    return {
      sourceType: 'text',
      title: basename(path, '.md'),
      content: raw,
      rawMetadata: {},
      filePath: path,
    };
  }

  const endMarker = raw.indexOf('\n---', 3);
  if (endMarker === -1) {
    return {
      sourceType: 'text',
      title: basename(path, '.md'),
      content: raw,
      rawMetadata: {},
      filePath: path,
    };
  }

  const fmRaw = raw.slice(3, endMarker).trim();
  const content = raw.slice(endMarker + 4).trim();

  const fm = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
  const known = new Set(['source_type', 'source_path', 'title', 'extracted_at']);
  const rawMetadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!known.has(k)) rawMetadata[k] = v;
  }

  return {
    sourceType: ((fm.source_type as string) || 'text') as SourceType,
    sourcePath: fm.source_path as string | undefined,
    title: (fm.title as string) || basename(path, '.md'),
    content,
    extractedAt: fm.extracted_at as string | undefined,
    rawMetadata,
    filePath: path,
  };
}

export function parseNote(raw: string, filePath?: string): Note {
  // Robust frontmatter extraction: looks for --- at the very start,
  // then finds the closing --- on its own line.
  if (!raw.startsWith('---')) {
    throw new Error('Invalid markdown: missing frontmatter');
  }

  const endMarker = raw.indexOf('\n---', 3);
  if (endMarker === -1) {
    throw new Error('Invalid markdown: unclosed frontmatter');
  }

  const fmRaw = raw.slice(3, endMarker).trim();
  const body = raw.slice(endMarker + 4).trim();

  const fm = yaml.load(fmRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;

  const note: Note = {
    id: String(fm.id || ''),
    title: String(fm.title || ''),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    status: (fm.status as Note['status']) || 'seed',
    created: String(fm.created || ''),
    updated: String(fm.updated || ''),
    sources: Array.isArray(fm.sources) ? fm.sources.map(String) : [],
    summary: '',
    personalContext: '',
    keyFacts: [],
    timeline: [],
    links: [],
    backlinks: [],
    qas: [],
    content: '',
    filePath,
  };

  // Parse body sections by ## headers
  const sectionRegex = /^## (.+)$/gm;
  const sections: { header: string; content: string }[] = [];

  let match;
  let lastIndex = 0;
  while ((match = sectionRegex.exec(body)) !== null) {
    if (lastIndex > 0) {
      const prev = sections[sections.length - 1];
      prev.content = body.slice(lastIndex, match.index).trim();
    }
    sections.push({ header: match[1].trim(), content: '' });
    lastIndex = match.index + match[0].length;
  }
  if (sections.length > 0) {
    sections[sections.length - 1].content = body.slice(lastIndex).trim();
  }

  for (const sec of sections) {
    const header = sec.header;
    const content = sec.content;

    switch (header) {
      case '一句话摘要':
        note.summary = content;
        break;
      case '与我相关':
        note.personalContext = content;
        break;
      case '关键事实':
        note.keyFacts = content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('- '))
          .map((l) => l.slice(2).trim());
        break;
      case '时间线':
        note.timeline = content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((l) => {
            const cleaned = l.startsWith('- ') ? l.slice(2) : l;
            const idx = cleaned.indexOf(' | ');
            if (idx === -1) return { date: cleaned, event: '' };
            return {
              date: cleaned.slice(0, idx).trim(),
              event: cleaned.slice(idx + 3).trim(),
            };
          });
        break;
      case '关联':
        note.links = content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('- '))
          .map((l) => parseLink(l.slice(2).trim()));
        break;
      case '反向链接':
        note.backlinks = content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('- '))
          .map((l) => parseLink(l.slice(2).trim()));
        break;
      case '常见问题':
        note.qas = parseQAs(content);
        break;
      case '详细内容':
        note.content = content;
        break;
      default:
        // Unknown section goes into content
        if (note.content) {
          note.content += `\n\n## ${header}\n${content}`;
        } else {
          note.content = `## ${header}\n${content}`;
        }
    }
  }

  return note;
}

function parseLink(line: string): NoteLink {
  const match = line.match(/^\[\[(.+?)\]\](?:\s+#(\w+))?(?:\s*—\s*(.*))?$/);
  if (!match) {
    return { target: line, weight: 'weak' };
  }
  return {
    target: match[1],
    weight: (match[2] as NoteLink['weight']) || 'weak',
    context: match[3] || '',
  };
}

function parseQAs(content: string): QAEntry[] {
  const qas: QAEntry[] = [];
  const blocks = content.split(/\*\*Q\*\*:\s*/);
  for (const block of blocks.slice(1)) {
    const parts = block.split('**A**:', 2);
    if (parts.length !== 2) continue;
    const q = parts[0].trim();
    let aRest = parts[1].trim();
    let source: string | undefined;
    const sourceMatch = aRest.match(/\*来源:\s*\[\[(.+?)\]\]\*$/);
    if (sourceMatch) {
      aRest = aRest.slice(0, sourceMatch.index).trim();
      source = sourceMatch[1];
    }
    qas.push({ question: q, answer: aRest, source });
  }
  return qas;
}

export function stringifyNote(note: Note): string {
  const fm = {
    id: note.id,
    title: note.title,
    tags: note.tags,
    status: note.status,
    created: note.created,
    updated: note.updated,
    sources: note.sources,
  };

  const lines: string[] = ['---', yaml.dump(fm, { allowUnicode: true } as any).trim(), '---', ''];

  lines.push(`# ${note.title}`, '');

  if (note.summary) {
    lines.push('## 一句话摘要', note.summary, '');
  }

  if (note.personalContext) {
    lines.push('## 与我相关', note.personalContext, '');
  }

  if (note.keyFacts.length > 0) {
    lines.push('## 关键事实');
    for (const f of note.keyFacts) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  if (note.timeline.length > 0) {
    lines.push('## 时间线');
    for (const t of note.timeline) {
      lines.push(`- ${t.date} | ${t.event}`);
    }
    lines.push('');
  }

  if (note.links.length > 0) {
    lines.push('## 关联');
    for (const link of note.links) {
      const weightTag = link.weight !== 'weak' ? ` #${link.weight}` : '';
      const ctx = link.context ? ` — ${link.context}` : '';
      lines.push(`- [[${link.target}]]${weightTag}${ctx}`);
    }
    lines.push('');
  }

  if (note.backlinks && note.backlinks.length > 0) {
    lines.push('## 反向链接');
    for (const link of note.backlinks) {
      const weightTag = link.weight !== 'weak' ? ` #${link.weight}` : '';
      const ctx = link.context ? ` — ${link.context}` : '';
      lines.push(`- [[${link.target}]]${weightTag}${ctx}`);
    }
    lines.push('');
  }

  if (note.qas.length > 0) {
    lines.push('## 常见问题');
    for (const qa of note.qas) {
      lines.push(`**Q**: ${qa.question}`);
      lines.push(`**A**: ${qa.answer}`);
      if (qa.source) {
        lines.push(`*来源: [[${qa.source}]]*`);
      }
      lines.push('');
    }
  }

  if (note.content) {
    lines.push('## 详细内容', note.content, '');
  }

  return lines.join('\n');
}
