export type NoteStatus = 'seed' | 'growing' | 'evergreen' | 'stale' | 'archived';
export type LinkWeight = 'strong' | 'weak' | 'context';
export type SourceType = 'text' | 'web' | 'image' | 'audio' | 'pdf';

export interface NoteLink {
  target: string;
  weight: LinkWeight;
  context?: string;
}

export interface TimelineEntry {
  date: string;
  event: string;
}

export interface QAEntry {
  question: string;
  answer: string;
  source?: string;
}

export interface NoteFrontmatter {
  id: string;
  title: string;
  tags: string[];
  status: NoteStatus;
  created: string;
  updated: string;
  sources: string[];
}

export interface Note extends NoteFrontmatter {
  summary: string;
  personalContext: string;
  keyFacts: string[];
  timeline: TimelineEntry[];
  links: NoteLink[];
  backlinks: NoteLink[];
  qas: QAEntry[];
  content: string;
  filePath?: string;
}

/** 步骤 1（Extract）的中间结果 */
export interface ExtractResult {
  title: string;
  tags: string[];
  summary: string;
  personalContext: string;
  keyFacts: string[];
  timeline: TimelineEntry[];
  content: string;
}

export interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp?: string;
}

export interface Conversation {
  id: string;
  date: string;
  topics: string[];
  status: 'open' | 'resolved';
  turns: ConversationTurn[];
  agentActions: string[];
  filePath?: string;
  updatedAt?: string;
}

export interface InboxEntry {
  sourceType: SourceType;
  sourcePath?: string;
  title: string;
  content: string;
  extractedAt?: string;
  rawMetadata: Record<string, unknown>;
  filePath?: string;
}

export interface InvertedIndexEntry {
  tag: string;
  noteId: string;
  noteTitle: string;
  noteSummary: string;
}

export interface InvertedIndex {
  entries: InvertedIndexEntry[];
}

export interface AliasMapping {
  canonical: string;
  aliases: string[];
}

export interface Storage {
  loadNote(id: string): Promise<Note>;
  saveNote(note: Note): Promise<void>;
  listNotes(): Promise<Note[]>;
  deleteNote(id: string): Promise<void>;
  loadConversation(id: string): Promise<Conversation>;
  saveConversation(conv: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listConversations(): Promise<Conversation[]>;
  loadIndex(): Promise<InvertedIndex>;
  saveIndex(index: InvertedIndex): Promise<void>;
  loadAliases(): Promise<AliasMapping[]>;
  saveAliases(aliases: AliasMapping[]): Promise<void>;
  writeInbox(entry: InboxEntry): Promise<boolean>;
  listInbox(): Promise<InboxEntry[]>;
  archiveInbox(fileName: string): Promise<void>;
  listNoteSources(): Promise<Array<{ id: string; sources: string[] }>>;
  commit(message: string): Promise<void>;
}
