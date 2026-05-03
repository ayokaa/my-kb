import { describe, it, expect } from 'vitest';
import * as lucide from 'lucide-react';

describe('MemoryPanel icon imports', () => {
  it('uses only icons that exist in lucide-react', () => {
    const usedIcons = [
      'Brain', 'Loader2', 'RefreshCw', 'User', 'BookOpen', 'MessageSquare',
      'Heart', 'Pencil', 'Trash2', 'Plus', 'X', 'Check', 'Save',
    ];
    for (const name of usedIcons) {
      const icon = (lucide as any)[name];
      expect(icon, `Icon "${name}" must exist in lucide-react`).toBeDefined();
      expect(typeof icon).toBe('object');
    }
  });
});
