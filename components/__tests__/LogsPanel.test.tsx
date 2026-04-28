import { describe, it, expect } from 'vitest';
import * as lucide from 'lucide-react';

describe('LogsPanel icon imports', () => {
  it('uses only icons that exist in lucide-react', () => {
    const usedIcons = [
      'FileText',
      'RefreshCw',
      'Trash2',
      'Radio',
      'RadioReceiver',
      'ChevronDown',
      'ChevronUp',
      'Search',
      'X',
    ];
    for (const name of usedIcons) {
      const icon = (lucide as any)[name];
      expect(icon, `Icon "${name}" must exist in lucide-react`).toBeDefined();
      expect(typeof icon).toBe('object');
    }
  });
});
