import { describe, it, expect } from 'vitest';
import * as lucide from 'lucide-react';

describe('TasksPanel icon imports', () => {
  it('uses only icons that exist in lucide-react', () => {
    // The component source imports these icons
    const usedIcons = ['ListChecks', 'Loader2', 'CheckCircle2', 'XCircle', 'Clock', 'RefreshCw'];
    for (const name of usedIcons) {
      const icon = (lucide as any)[name];
      expect(icon, `Icon "${name}" must exist in lucide-react`).toBeDefined();
      expect(typeof icon).toBe('object');
    }
  });
});
