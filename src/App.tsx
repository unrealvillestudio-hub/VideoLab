import React, { useState } from 'react';
import { Video, Layers, History, Settings, Play, Sparkles, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BUILD_TAG } from './config/buildTag';
import StoryboardModule from './modules/promptpack/StoryboardModule';
import { VideoLabProvider } from './context/VideoLabContext';
import { cn } from './ui/components';
import './styles/uv_theme.css';
import './styles/uv_typography.css';

type TabId = 'storyboard' | 'library' | 'history' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('storyboard');

  return (
    <div className="flex h-screen w-screen bg-uv-bg text-uv-text-primary font-uv-body overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 flex flex-col items-center py-4 border-r border-uv-border bg-uv-panel z-20">
        <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center mb-8 shadow-lg shadow-blue-900/20">
          <Video size={24} className="text-white" />
        </div>
        
        <nav className="flex flex-col gap-4">
          <button 
            onClick={() => setActiveTab('storyboard')}
            className={cn("p-3 rounded-xl transition-all", activeTab === 'storyboard' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800 hover:text-white")}
          >
            <Layers size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('library')}
            className={cn("p-3 rounded-xl transition-all", activeTab === 'library' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800 hover:text-white")}
          >
            <LayoutGrid size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={cn("p-3 rounded-xl transition-all", activeTab === 'history' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800 hover:text-white")}
          >
            <History size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={cn("p-3 rounded-xl transition-all", activeTab === 'settings' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800 hover:text-white")}
          >
            <Settings size={20} />
          </button>
        </nav>
        
        <div className="mt-auto text-[10px] font-mono text-zinc-600 rotate-90 mb-4">
          {BUILD_TAG}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-14 border-b border-uv-border flex items-center justify-between px-6 bg-uv-panel/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <h1 className="font-uv-display text-lg tracking-tight">UNRLVL - <span className="text-blue-500">VideoLab</span></h1>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400 border border-zinc-700">BETA</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-zinc-400">System Ready</span>
            </div>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 overflow-hidden">
          {/*
            VideoLabProvider wraps the entire workspace so any future tab
            (library, history) can also access the loaded brand/person/location data
            without triggering a second fetch.
          */}
          <VideoLabProvider>
            <AnimatePresence mode="wait">
              {activeTab === 'storyboard' && (
                <motion.div
                  key="storyboard"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="h-full"
                >
                  <StoryboardModule />
                </motion.div>
              )}
              {activeTab !== 'storyboard' && (
                <motion.div
                  key="placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex items-center justify-center text-zinc-600"
                >
                  <div className="text-center">
                    <Sparkles size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-mono uppercase tracking-widest">Module Under Construction</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </VideoLabProvider>
        </div>
      </main>
    </div>
  );
}
