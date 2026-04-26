import TabShell from '@/components/TabShell';
import NotesPanel from '@/components/NotesPanel';

export default function HomePage() {
  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <TabShell notesPanel={<NotesPanel />} />
    </div>
  );
}
