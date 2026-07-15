import React, { useState, useEffect, useRef } from 'react';
import { Timer, BarChart2, BookOpen, Settings, Play, Pause, RotateCcw, Coffee, Trash2, Menu, X, CloudRain, Music, Flame, Upload, LogOut, ChevronDown, Check, Plus, Minus } from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useLocalStorage, useInterval, useOnClickOutside } from 'usehooks-ts';
import { format, eachDayOfInterval, subDays, startOfWeek, addDays } from 'date-fns';
import { Tab, CozySettings, FocusSession, JournalNote } from './types';
import { auth, db, googleProvider } from './lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useCollectionData } from 'react-firebase-hooks/firestore';
import { collection, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';

const CHIME_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-84.wav';
const MAGICAL_CHIME_URL = 'https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav';

export default function App() {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-primary">Loading...</div>;
  }

  const handleLogin = async () => {
    try {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        await signInWithRedirect(auth, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (error: any) {
      if (error.code !== 'auth/popup-closed-by-user') {
        console.error('Login error:', error);
      }
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="bg-surface-container p-8 rounded-3xl soft-shadow text-center max-w-sm w-full border border-secondary/20 animate-in fade-in zoom-in-95 duration-300">
          <h1 className="font-display text-3xl font-bold text-primary mb-2">CozyPomo</h1>
          <p className="text-text-muted mb-8 text-sm">Masuk untuk menyimpan progress belajar kamu di Cloud.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-primary text-on-primary py-3 rounded-full font-semibold hover:opacity-90 transition-opacity"
          >
            Login dengan Google
          </button>
        </div>
      </div>
    );
  }

  return <MainApp user={user} />;
}

function MainApp({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState<Tab>('focus');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Two-way Offline Sync setup
  const defaultSettings: CozySettings = { focusMin: 25, breakMin: 5, targetRounds: 4 };
  const [localSettings, setLocalSettings] = useLocalStorage<CozySettings>('cozypomo_settings', defaultSettings);
  const [settings, setSettings] = useState<CozySettings>({ ...defaultSettings, ...localSettings });
  
  const [localHistory, setLocalHistory] = useLocalStorage<FocusSession[]>('cozypomo_history', []);
  const [localJournal, setLocalJournal] = useLocalStorage<JournalNote[]>('cozypomo_journal', []);

  // Firestore Refs under user path
  const historyRef = collection(db, 'users', user.uid, 'history');
  const journalRef = collection(db, 'users', user.uid, 'journals');
  const settingsRef = doc(db, 'users', user.uid, 'config', 'settings');

  const [historyDocs, historyLoading, historyError] = useCollectionData(historyRef);
  const [journalDocs, journalLoading, journalError] = useCollectionData(journalRef);

  // Sync back to local storage when fetched
  useEffect(() => {
    if (historyDocs && !historyError) {
      setLocalHistory(historyDocs as FocusSession[]);
    }
  }, [historyDocs, historyError, setLocalHistory]);

  useEffect(() => {
    if (journalDocs && !journalError) {
      setLocalJournal(journalDocs as JournalNote[]);
    }
  }, [journalDocs, journalError, setLocalJournal]);

  // Read from local if offline/loading, else from firestore
  const history = (historyDocs && !historyError) ? (historyDocs as FocusSession[]) : localHistory;
  const journal = (journalDocs && !journalError) ? (journalDocs as JournalNote[]) : localJournal;

  // Load Settings from Firestore on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
          const remoteSettings = docSnap.data() as CozySettings;
          // Merge missing properties (like targetRounds if they only had old settings)
          const merged = { ...defaultSettings, ...remoteSettings };
          setSettings(merged);
          setLocalSettings(merged);
        }
      } catch (e) {
        console.error("Error loading settings", e);
      }
    };
    loadSettings();
  }, [user.uid]);

  // Sync settings back to firestore when modified (debounced implicitly by user actions)
  const updateSettings = async (newSettings: CozySettings) => {
    setSettings(newSettings);
    setLocalSettings(newSettings);
    try {
      await setDoc(settingsRef, newSettings, { merge: true });
    } catch (e) {
      console.error("Error saving settings", e);
    }
  };

  const addFocusMinutes = async (date: string, minutes: number) => {
    const docId = date; // 'users/{uid}/history/{date}'
    const existing = history.find(h => h.date === date);
    const newMinutes = (existing?.minutes || 0) + minutes;
    
    // Update local immediately for snappy UI
    setLocalHistory(prev => {
      const idx = prev.findIndex(h => h.date === date);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], minutes: newMinutes };
        return copy;
      }
      return [...prev, { date, minutes: newMinutes }];
    });

    try {
      await setDoc(doc(historyRef, docId), {
        date,
        minutes: newMinutes
      }, { merge: true });
    } catch (e) {
      console.error("Failed to save history to cloud", e);
    }
  };

  const addJournal = async (noteText: string) => {
    const docRef = doc(journalRef); // Auto ID
    const newNote: JournalNote = {
      id: docRef.id,
      date: new Date().toISOString(),
      content: noteText
    };

    setLocalJournal(prev => [newNote, ...prev]);

    try {
      await setDoc(docRef, newNote);
    } catch (e) {
      console.error("Failed to save journal to cloud", e);
    }
  };

  const removeJournal = async (id: string) => {
    setLocalJournal(prev => prev.filter(j => j.id !== id));
    try {
      await deleteDoc(doc(journalRef, id));
    } catch (e) {
      console.error("Failed to delete journal from cloud", e);
    }
  };

  // Playlist State
  const [playlist, setPlaylist] = useState<{ id: string; name: string; url: string }[]>([]);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [isPlayingPlaylist, setIsPlayingPlaylist] = useState(false);
  const playlistAudioRef = useRef<HTMLAudioElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file: File) => ({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
        name: file.name,
        url: URL.createObjectURL(file)
      }));
      setPlaylist(prev => [...prev, ...newFiles]);
    }
  };

  const playTrack = (url: string) => {
    if (currentTrack === url) {
      if (isPlayingPlaylist) {
        playlistAudioRef.current?.pause();
        setIsPlayingPlaylist(false);
      } else {
        playlistAudioRef.current?.play().catch(console.error);
        setIsPlayingPlaylist(true);
      }
    } else {
      setCurrentTrack(url);
      setIsPlayingPlaylist(true);
      if (playlistAudioRef.current) {
        playlistAudioRef.current.src = url;
        playlistAudioRef.current.play().catch(console.error);
      }
    }
  };

  // Avatar Dropdown State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(dropdownRef, () => setIsDropdownOpen(false));

  return (
    <div className="min-h-screen flex flex-col pt-[72px] md:pt-[88px] pb-[88px] md:pb-0 px-4 md:px-10 overflow-hidden">
      <header className="fixed top-0 w-full z-40 bg-surface/90 backdrop-blur-sm flex justify-between items-center px-6 py-4 max-w-7xl mx-auto left-1/2 -translate-x-1/2">
        <button onClick={() => setIsSidebarOpen(true)} className="text-primary hover:opacity-80 transition-opacity">
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-8">
          <div className="font-display text-2xl font-semibold text-primary tracking-tight">
            CozyPomo
          </div>
          <nav className="hidden md:flex gap-6 items-center">
            <button onClick={() => setActiveTab('focus')} className={`text-sm font-semibold transition-colors ${activeTab === 'focus' ? 'text-primary' : 'text-text-muted hover:text-primary/70'}`}>Focus</button>
            <button onClick={() => setActiveTab('stats')} className={`text-sm font-semibold transition-colors ${activeTab === 'stats' ? 'text-primary' : 'text-text-muted hover:text-primary/70'}`}>Stats</button>
            <button onClick={() => setActiveTab('journal')} className={`text-sm font-semibold transition-colors ${activeTab === 'journal' ? 'text-primary' : 'text-text-muted hover:text-primary/70'}`}>Journal</button>
          </nav>
        </div>
        
        <div className="flex items-center gap-4 relative" ref={dropdownRef}>
          <button onClick={() => setIsSettingsOpen(!isSettingsOpen)} className="text-primary hover:opacity-80 transition-opacity">
            <Settings size={24} />
          </button>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-2 hover:bg-secondary/10 rounded-full p-1 pr-3 transition-colors"
          >
            <img 
              src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}&background=e2c9b4&color=a4603d`} 
              alt="Avatar" 
              className="w-8 h-8 rounded-full bg-surface-container border border-secondary/20"
            />
            <ChevronDown size={16} className="text-text-muted" />
          </button>
          
          {isDropdownOpen && (
            <div className="absolute top-12 right-0 w-48 bg-surface-container rounded-2xl p-2 soft-shadow border border-secondary/20 z-50 animate-in fade-in zoom-in-95 duration-200">
              <div className="px-3 py-2 border-b border-secondary/10 mb-1">
                <p className="text-xs text-text-muted truncate">{user.email}</p>
              </div>
              <button 
                onClick={() => signOut(auth)}
                className="w-full text-left flex items-center px-3 py-2 text-sm text-text-main hover:bg-peach/30 hover:text-terracotta rounded-xl transition-colors"
              >
                <LogOut size={16} className="mr-2" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Settings Drawer */}
      <div className={`fixed top-[72px] md:top-[88px] w-full max-w-7xl left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ease-in-out ${isSettingsOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'}`}>
        <div className="bg-surface-container mx-4 md:mx-10 p-6 rounded-b-3xl soft-shadow border-t border-secondary/20 flex flex-col gap-4 items-center">
          <h3 className="font-display text-xl text-text-main font-semibold mb-2">Timer Settings</h3>
          <div className="w-full max-w-md grid grid-cols-2 md:grid-cols-3 gap-4 mb-2">
            <div className="bg-surface rounded-2xl p-4 flex flex-col items-start border border-secondary/20">
              <label className="text-xs font-semibold text-text-muted mb-2 flex items-center">
                <Timer size={16} className="mr-1" /> Focus (min)
              </label>
              <input 
                type="number" 
                value={settings.focusMin || ''}
                onChange={e => updateSettings({ ...settings, focusMin: parseInt(e.target.value) || 0 })}
                className="w-full bg-transparent border-b-2 border-secondary focus:border-primary focus:outline-none focus:ring-0 px-0 py-1 font-display text-xl font-semibold text-text-main transition-colors"
              />
            </div>
            <div className="bg-surface rounded-2xl p-4 flex flex-col items-start border border-secondary/20">
              <label className="text-xs font-semibold text-text-muted mb-2 flex items-center">
                <Coffee size={16} className="mr-1" /> Break (min)
              </label>
              <input 
                type="number" 
                value={settings.breakMin || ''}
                onChange={e => updateSettings({ ...settings, breakMin: parseInt(e.target.value) || 0 })}
                className="w-full bg-transparent border-b-2 border-secondary focus:border-primary focus:outline-none focus:ring-0 px-0 py-1 font-display text-xl font-semibold text-text-main transition-colors"
              />
            </div>
            <div className="bg-surface rounded-2xl p-4 flex flex-col items-start border border-secondary/20 col-span-2 md:col-span-1">
              <label className="text-xs font-semibold text-text-muted mb-2 flex items-center justify-between w-full">
                Target Sesi
              </label>
              <div className="flex items-center justify-between w-full mt-1">
                <button 
                  onClick={() => updateSettings({ ...settings, targetRounds: Math.max(1, (settings.targetRounds || 4) - 1) })}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-peach/30 text-terracotta hover:bg-peach/60 transition-colors"
                >
                  <Minus size={16} />
                </button>
                <span className="font-display text-xl font-semibold text-text-main">{settings.targetRounds || 4}</span>
                <button 
                  onClick={() => updateSettings({ ...settings, targetRounds: Math.min(12, (settings.targetRounds || 4) + 1) })}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-peach/30 text-terracotta hover:bg-peach/60 transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-charcoal/20 backdrop-blur-sm z-50 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar Drawer */}
      <div className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-surface z-50 soft-shadow transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col p-6 overflow-y-auto`}>
        <div className="flex justify-between items-center mb-8">
          <div className="font-display text-2xl font-semibold text-primary tracking-tight">
            CozyPomo
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-text-muted hover:text-primary transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="bg-primary/10 rounded-2xl p-5 mb-8 border border-primary/20">
          <h4 className="font-display font-semibold text-primary mb-2 flex items-center">
            <BookOpen size={18} className="mr-2" /> Lo-Fi Focus Tip
          </h4>
          <p className="text-sm text-text-main/80 leading-relaxed">
            Take a deep breath. Focus on one task at a time. The sound of rain can help wash away distractions.
          </p>
        </div>

        <h3 className="font-display text-lg font-semibold text-text-main mb-4 flex items-center">
          <Music size={18} className="mr-2 text-primary" /> Cozy Playlist
        </h3>
        
        <div className="flex flex-col gap-3 mb-6">
          <label className="flex items-center justify-center p-3 rounded-2xl border-2 border-dashed border-secondary/50 text-text-muted hover:text-primary hover:border-primary/50 hover:bg-secondary/10 transition-all cursor-pointer">
            <Upload size={18} className="mr-2" />
            <span className="font-semibold text-sm">Upload MP3</span>
            <input type="file" accept="audio/*" multiple className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <audio ref={playlistAudioRef} onEnded={() => setIsPlayingPlaylist(false)} />
          {playlist.length === 0 ? (
            <p className="text-sm text-text-muted text-center italic">No tracks in your playlist yet. Upload some cozy tunes!</p>
          ) : (
            playlist.map(track => (
              <button 
                key={track.id}
                onClick={() => playTrack(track.url)}
                className={`flex items-center p-3 rounded-2xl transition-all duration-200 border text-left ${currentTrack === track.url && isPlayingPlaylist ? 'bg-primary text-on-primary border-primary soft-shadow' : 'bg-surface-container text-text-main border-secondary/20 hover:bg-secondary/10'}`}
              >
                <div className={`p-2 rounded-full mr-3 ${currentTrack === track.url && isPlayingPlaylist ? 'bg-on-primary/20' : 'bg-surface text-primary'}`}>
                  {currentTrack === track.url && isPlayingPlaylist ? <Pause size={16} /> : <Play size={16} />}
                </div>
                <div className="flex-grow overflow-hidden">
                  <h4 className="font-semibold text-sm truncate">{track.name}</h4>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <main className="flex-grow flex flex-col items-center justify-start w-full max-w-7xl mx-auto py-8 gap-8 relative z-10">
        {activeTab === 'focus' && (
          <FocusScreen settings={settings} addFocusMinutes={addFocusMinutes} />
        )}
        {activeTab === 'stats' && (
          <StatsScreen history={history} />
        )}
        {activeTab === 'journal' && (
          <JournalScreen journal={journal} addJournal={addJournal} removeJournal={removeJournal} />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 w-full rounded-t-3xl bg-surface-container shadow-[0_-10px_30px_rgba(164,96,61,0.08)] md:hidden z-50 flex justify-around items-center px-4 py-3 pb-safe">
        <NavButton tab="focus" current={activeTab} onClick={setActiveTab} icon={<Timer size={24} />} label="Focus" />
        <NavButton tab="stats" current={activeTab} onClick={setActiveTab} icon={<BarChart2 size={24} />} label="Stats" />
        <NavButton tab="journal" current={activeTab} onClick={setActiveTab} icon={<BookOpen size={24} />} label="Journal" />
      </nav>
    </div>
  );
}

function NavButton({ tab, current, onClick, icon, label }: { tab: Tab, current: Tab, onClick: (t: Tab) => void, icon: React.ReactNode, label: string }) {
  const isActive = tab === current;
  return (
    <button 
      onClick={() => onClick(tab)}
      className={`flex flex-col items-center justify-center rounded-2xl px-4 py-2 transition-all duration-200 active:scale-95 ${isActive ? 'bg-primary text-on-primary' : 'text-text-muted hover:bg-secondary/20'}`}
    >
      {icon}
      <span className="text-xs font-medium mt-1">{label}</span>
    </button>
  );
}

function FocusScreen({ settings, addFocusMinutes }: { 
  settings: CozySettings, 
  addFocusMinutes: (date: string, mins: number) => void
}) {
  const [mode, setMode] = useState<'focus'|'break'>('focus');
  const [timeLeft, setTimeLeft] = useState(settings.focusMin * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [showCelebration, setShowCelebration] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const magicalAudioRef = useRef<HTMLAudioElement>(null);

  // Use a ref to track previous settings so we only reset when settings actually change
  const prevSettings = useRef({ focusMin: settings.focusMin, breakMin: settings.breakMin });

  useEffect(() => {
    // Only update time if the actual focus/break duration settings changed
    if (prevSettings.current.focusMin !== settings.focusMin || prevSettings.current.breakMin !== settings.breakMin) {
      if (!isRunning) {
        setTimeLeft(mode === 'focus' ? settings.focusMin * 60 : settings.breakMin * 60);
      }
      prevSettings.current = { focusMin: settings.focusMin, breakMin: settings.breakMin };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.focusMin, settings.breakMin, mode]);

  useInterval(() => {
    if (isRunning && timeLeft > 0) {
      setTimeLeft(t => t - 1);
    } else if (isRunning && timeLeft === 0) {
      setIsRunning(false); // Temporarily stop to handle transition
      
      if (mode === 'focus') {
        const today = format(new Date(), 'yyyy-MM-dd');
        addFocusMinutes(today, settings.focusMin);
        
        if (currentRound >= (settings.targetRounds || 4)) {
          magicalAudioRef.current?.play().catch(e => console.log('Magical audio play failed:', e));
          setShowCelebration(true);
        } else {
          audioRef.current?.play().catch(e => console.log('Audio play failed:', e));
          setMode('break');
          setTimeLeft(settings.breakMin * 60);
          setIsRunning(true);
        }
      } else {
        audioRef.current?.play().catch(e => console.log('Audio play failed:', e));
        setCurrentRound(r => r + 1);
        setMode('focus');
        setTimeLeft(settings.focusMin * 60);
        setIsRunning(true);
      }
    }
  }, isRunning ? 1000 : null);

  useEffect(() => {
    if (isRunning) {
      const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
      const secs = (timeLeft % 60).toString().padStart(2, '0');
      document.title = `${mins}:${secs} | CozyPomo`;
    } else {
      document.title = 'CozyPomo';
    }
    return () => { document.title = 'CozyPomo'; };
  }, [timeLeft, isRunning]);

  const toggleTimer = () => setIsRunning(!isRunning);
  
  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(mode === 'focus' ? settings.focusMin * 60 : settings.breakMin * 60);
  };

  const resetRoundsAndClose = () => {
    setCurrentRound(1);
    setMode('focus');
    setTimeLeft(settings.focusMin * 60);
    setShowCelebration(false);
  };

  const totalTime = mode === 'focus' ? settings.focusMin * 60 : settings.breakMin * 60;
  const progress = totalTime > 0 ? ((totalTime - timeLeft) / totalTime) * 283 : 0;
  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const secs = (timeLeft % 60).toString().padStart(2, '0');

  return (
    <div className="w-full flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300">
      <audio ref={audioRef} src={CHIME_URL} preload="auto" />
      <audio ref={magicalAudioRef} src={MAGICAL_CHIME_URL} preload="auto" />
      
      {/* Round Indicators */}
      <div className="flex flex-col items-center mb-6 gap-2">
        <span className="text-sm font-semibold text-text-muted">
          Sesi {currentRound} dari {settings.targetRounds || 4}
        </span>
        <div className="flex gap-2">
          {Array.from({ length: settings.targetRounds || 4 }).map((_, i) => {
            const isCompleted = i + 1 < currentRound || (currentRound >= (settings.targetRounds || 4) && showCelebration);
            const isActive = i + 1 === currentRound && !showCelebration;
            
            return (
              <div 
                key={i} 
                className={`w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isCompleted 
                    ? 'bg-terracotta text-cream' 
                    : isActive 
                      ? 'border-2 border-primary bg-peach/30' 
                      : 'border-2 border-peach bg-transparent'
                }`}
              >
                {isCompleted && <Check size={10} strokeWidth={4} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Timer Ring */}
      <div className="relative w-72 h-72 rounded-full bg-surface-container flex flex-col items-center justify-center soft-shadow mb-8 transition-all duration-300">
        <svg className="absolute inset-0 w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--color-peach)" strokeWidth="4" className="opacity-40" />
          <circle 
            cx="50" cy="50" r="45" fill="none" 
            stroke="var(--color-primary)" 
            strokeWidth="4" 
            strokeDasharray="283" 
            strokeDashoffset={progress} 
            className="transition-all duration-1000 ease-linear" 
          />
        </svg>
        <div className="z-10 flex flex-col items-center">
          <span className="text-sm font-semibold text-primary mb-2">
            {mode === 'focus' ? 'Fokus Yuk!' : 'Waktunya Rehat!'}
          </span>
          <span className="font-display text-[80px] font-bold leading-none tracking-tight text-text-main">
            {mins}:{secs}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-4 items-center mb-12">
        <button 
          onClick={resetTimer}
          className="px-8 py-3 rounded-full bg-surface-container text-primary border border-secondary/40 font-semibold text-sm hover:bg-peach/10 transition-colors flex items-center justify-center active:scale-95"
        >
          <RotateCcw size={20} className="mr-2" />
          Reset
        </button>
        <button 
          onClick={toggleTimer}
          className="px-10 py-4 rounded-full bg-primary text-on-primary font-display text-2xl hover:opacity-90 transition-all soft-shadow active:scale-95 flex items-center justify-center w-48"
        >
          {isRunning ? <Pause size={28} className="mr-2" /> : <Play size={28} className="mr-2 fill-current" />}
          {isRunning ? 'Pause' : 'Start'}
        </button>
      </div>
      
      {/* Celebration Modal */}
      {showCelebration && (
        <div className="fixed inset-0 bg-charcoal/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-surface-container rounded-3xl p-8 max-w-sm w-full soft-shadow border border-secondary/20 flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="text-6xl mb-4">🌟☕</div>
            <h2 className="font-display text-2xl font-bold text-primary mb-2">Kerja Bagus!</h2>
            <p className="text-text-main font-semibold mb-6">
              Selamat! Kamu telah menyelesaikan semua target sesi belajarmu hari ini!
            </p>
            <div className="bg-surface rounded-2xl p-4 w-full mb-8 border border-secondary/20">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-text-muted">Total Sesi</span>
                <span className="font-bold text-primary">{settings.targetRounds || 4} Sesi</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Waktu Fokus</span>
                <span className="font-bold text-primary">{(settings.targetRounds || 4) * settings.focusMin} Menit</span>
              </div>
            </div>
            <button 
              onClick={resetRoundsAndClose}
              className="w-full bg-primary text-on-primary py-3 rounded-full font-semibold hover:opacity-90 transition-opacity"
            >
              Mulai Target Baru
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatsScreen({ history }: { history: FocusSession[] }) {
  const [viewMode, setViewMode] = useState<'week'|'month'>('week');
  
  const today = new Date();
  const days = viewMode === 'week' 
    ? eachDayOfInterval({ start: startOfWeek(today, { weekStartsOn: 1 }), end: addDays(startOfWeek(today, { weekStartsOn: 1 }), 6) })
    : eachDayOfInterval({ start: subDays(today, 29), end: today });

  const data = days.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const h = history.find(h => h.date === dateStr);
    const enDay = format(day, 'EEE');
    const idDays: Record<string, string> = { 'Mon': 'Sen', 'Tue': 'Sel', 'Wed': 'Rab', 'Thu': 'Kam', 'Fri': 'Jum', 'Sat': 'Sab', 'Sun': 'Min' };
    
    return {
      name: viewMode === 'week' ? idDays[enDay] || enDay : format(day, 'dd'),
      minutes: h ? h.minutes : 0
    };
  });

  return (
    <div className="w-full max-w-md bg-surface-container rounded-3xl p-6 soft-shadow border border-secondary/20 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-display text-2xl text-text-main font-semibold">Rekap Aktivitas</h2>
      </div>
      
      <div className="flex bg-surface rounded-full p-1 mb-8 border border-secondary/30">
        <button 
          onClick={() => setViewMode('week')}
          className={`flex-1 py-2 px-4 rounded-full text-sm font-semibold transition-colors ${viewMode === 'week' ? 'bg-primary text-on-primary' : 'text-text-muted hover:bg-secondary/20'}`}
        >
          Minggu Ini
        </button>
        <button 
          onClick={() => setViewMode('month')}
          className={`flex-1 py-2 px-4 rounded-full text-sm font-semibold transition-colors ${viewMode === 'month' ? 'bg-primary text-on-primary' : 'text-text-muted hover:bg-secondary/20'}`}
        >
          Bulan Ini
        </button>
      </div>

      <div className="w-full h-64 mt-4 overflow-x-auto overflow-y-hidden custom-scrollbar pb-2">
        <div className="h-full" style={{ minWidth: viewMode === 'month' ? '1000px' : '350px', padding: '0 10px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: 'var(--color-charcoal-light)', fontSize: 12 }} 
                interval={0}
              />
              <Tooltip 
                cursor={{ fill: 'var(--color-peach)', opacity: 0.2 }}
                contentStyle={{ borderRadius: '12px', border: 'none', backgroundColor: 'var(--color-cream)', color: 'var(--color-charcoal)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
              />
              <Bar dataKey="minutes" radius={[4, 4, 4, 4]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.minutes > 0 ? 'var(--color-terracotta)' : 'var(--color-peach)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function JournalScreen({ journal, addJournal, removeJournal }: { 
  journal: JournalNote[], 
  addJournal: (content: string) => Promise<void>,
  removeJournal: (id: string) => Promise<void>
}) {
  const [noteText, setNoteText] = useState('');

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await addJournal(noteText);
    setNoteText('');
  };

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-surface-container rounded-3xl p-6 soft-shadow border border-secondary/20">
        <h2 className="font-display text-2xl text-text-main font-semibold mb-4">Jurnal Hari Ini</h2>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Apa yang kamu pelajari hari ini?"
          className="w-full bg-surface rounded-2xl p-4 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-main resize-none border border-secondary/30"
        />
        <button
          onClick={handleAddNote}
          disabled={!noteText.trim()}
          className="w-full mt-4 bg-primary text-on-primary py-3 rounded-full font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
          <BookOpen size={18} />
          Tambah Catatan Belajar
        </button>
      </div>

      <div className="space-y-4 pb-20">
        {journal.length === 0 ? (
          <div className="text-center text-text-muted mt-8 text-sm">
            Belum ada catatan. Yuk mulai menulis!
          </div>
        ) : (
          journal.map(note => (
            <div key={note.id} className="bg-surface-container rounded-2xl p-5 soft-shadow border border-secondary/10 relative group">
              <p className="text-sm text-text-muted mb-2">{format(new Date(note.date), 'dd MMM yyyy, HH:mm')}</p>
              <p className="text-text-main whitespace-pre-wrap">{note.content}</p>
              <button 
                onClick={() => removeJournal(note.id)}
                className="absolute top-4 right-4 text-secondary hover:text-primary transition-colors opacity-0 group-hover:opacity-100 md:opacity-100"
                aria-label="Hapus catatan"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
