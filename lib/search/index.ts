export * from './types';
export * from './engine';
export * from './eval';

// 倒排索引构建与管理
export {
  tokenize,
  buildNoteIndex,
  buildIndex,
  mergeIndexes,
  removeNoteFromIndex,
  addNoteToIndex,
  serializeIndex,
  deserializeIndex,
  INDEX_VERSION,
} from './inverted-index';
