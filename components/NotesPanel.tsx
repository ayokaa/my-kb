import { FileSystemStorage } from '@/lib/storage';
import NotesPanelClient from './NotesPanelClient';

export default async function NotesPanel() {
  const storage = new FileSystemStorage();
  const notes = await storage.listNotes();
  return <NotesPanelClient initialNotes={notes} />;
}
