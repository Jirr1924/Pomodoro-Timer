export type Tab = 'focus' | 'stats' | 'journal';

export interface CozySettings {
  focusMin: number;
  breakMin: number;
  targetRounds: number;
}

export interface FocusSession {
  date: string; // YYYY-MM-DD
  minutes: number;
  uid?: string;
}

export interface JournalNote {
  id: string;
  date: string; // ISO string
  content: string;
  uid?: string;
}
