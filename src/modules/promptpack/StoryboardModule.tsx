import React, { useState, useEffect, useMemo } from 'react';
import { 
  Video, Copy, Check, Trash2, Plus, ChevronDown, Sparkles, 
  Download, Wand2, Users, MapPin, Music, Zap, Clock, 
  Type, Move, User, UserPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BRAND_PROFILES } from '../../config/brandProfiles';
import { VIDEO_PACKS } from '../../config/packs';
import { MOTION_PRESETS, RHYTHM_PRESETS } from '../../config/presets';
import { PERSON_BLUEPRINTS, getBlueprintsByBrand } from '../../config/personBlueprints';
import { LOCATION_BLUEPRINTS, getLocationsByBrand } from '../../config/locationBlueprints';
import { buildVideoPackRequest, generateVideoFramePrompt } from '../../services/videoEngine';
import { useSessionOutputsStore } from '../../state/sessionOutputsStore';
import { RunControlButton } from '../../ui/RunControlButton';
import { Panel, Button, cn } from '../../ui/components';
import { 
  VideoPackSpec, StoryboardFrame, BrandProfile, MotionStyle, 
  CutRhythm, ArchetypeId, StoryboardExport, PersonBlueprint, LocationBlueprint 
} from '../../core/types';

const ARCHETYPES: { id: ArchetypeId; label: string }[] = [
  { id: "studio_setup", label: "Studio Setup" },
  { id: "car_front", label: "Car Front" },
  { id: "car_rear", label: "Car Rear" },
  { id: "street_interview", label: "Street Interview" },
  { id: "salon_workshop", label: "Salon Workshop" },
  { id: "event_stage", label: "Event Stage" },
  { id: "single_talking_head", label: "Single Talking Head" },
];

const MUSIC_MOODS = ["none", "calm", "energetic", "luxury", "dramatic"];

export default function StoryboardModule() {
  // --- STATE ---
  const [selectedBrand, setSelectedBrand] = useState<BrandProfile>(BRAND_PROFILES[0]);
  const [selectedArchetype, setSelectedArchetype] = useState<ArchetypeId>("studio_setup");
  const [selectedPack, setSelectedPack] = useState<VideoPackSpec>(VIDEO_PACKS[0]);
  
  const [personaA, setPersonaA] = useState<{ id: string; role: string }>({ id: "", role: "HOST" });
  const [personaB, setPersonaB] = useState<{ id: string; role: string }>({ id: "", role: "GUEST" });
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [episodeBrief, setEpisodeBrief] = useState("");
  
  const [globalMotion, setGlobalMotion] = useState<MotionStyle>("static");
  const [globalRhythm, setGlobalRhythm] = useState<CutRhythm>("medium");
  const [musicMood, setMusicMood] = useState("none");

  const [frames, setFrames] = useState<StoryboardFrame[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const addSessionOutput = useSessionOutputsStore(state => state.addSessionOutput);

  // --- DERIVED DATA ---
  const filteredPersonas = useMemo(() => {
    // In a real app, we'd filter by brand, but for now we show all or filter if brandId matches
    // The user request says "PersonBlueprints filtrados"
    return PERSON_BLUEPRINTS.filter(p => p.brandId === selectedBrand.name || selectedBrand.name === "GENERIC");
  }, [selectedBrand]);

  const filteredLocations = useMemo(() => {
    return getLocationsByBrand(selectedBrand.name);
  }, [selectedBrand]);

  const totalDuration = useMemo(() => {
    return frames.reduce((acc, f) => acc + (f.duration_seconds || 0), 0);
  }, [frames]);

  // --- EFFECTS ---
  useEffect(() => {
    if (filteredPersonas.length > 0 && !personaA.id) {
      setPersonaA(prev => ({ ...prev, id: filteredPersonas[0].id }));
    }
    if (filteredPersonas.length > 1 && !personaB.id) {
      setPersonaB(prev => ({ ...prev, id: filteredPersonas[1].id }));
    }
  }, [filteredPersonas]);

  useEffect(() => {
    if (filteredLocations.length > 0 && !selectedLocation) {
      setSelectedLocation(filteredLocations[0].id);
    }
  }, [filteredLocations]);

  // --- HANDLERS ---
  const generateAutoStructure = () => {
    const newFrames = selectedPack.frames.map(f => ({
      ...f,
      prompt: f.prompt || `Scene for ${f.label}`,
      motion_style: globalMotion
    }));
    setFrames(newFrames);
  };

  const addFrame = () => {
    const newFrame: StoryboardFrame = {
      id: crypto.randomUUID(),
      label: `Frame ${frames.length + 1}`,
      duration_seconds: 3,
      prompt: "",
      motion_style: globalMotion
    };
    setFrames([...frames, newFrame]);
  };

  const removeFrame = (id: string) => {
    setFrames(frames.filter(f => f.id !== id));
  };

  const updateFrame = (index: number, updates: Partial<StoryboardFrame>) => {
    const newFrames = [...frames];
    newFrames[index] = { ...newFrames[index], ...updates };
    setFrames(newFrames);
  };

  const handleGeneratePrompts = async () => {
    setIsGenerating(true);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const packRequest = buildVideoPackRequest({
      ...selectedPack,
      frames: frames
    }, selectedBrand);

    const outputId = crypto.randomUUID();
    addSessionOutput({
      id: outputId,
      status: 'completed',
      progress: 100,
      brand: selectedBrand.name,
      pack: selectedPack.label,
      request: packRequest,
      timestamp: Date.now()
    });

    setIsGenerating(false);
    alert("Prompts generated and saved to Session Output Tray.");
  };

  const exportJSON = () => {
    const exportData: StoryboardExport = {
      version: "VP_1.0",
      episode_id: `EP-${Date.now()}`,
      brand_id: selectedBrand.name,
      archetype: selectedArchetype,
      personas: {
        a: selectedArchetype !== "single_talking_head" ? personaA : undefined,
        b: selectedArchetype !== "single_talking_head" ? personaB : undefined,
      },
      location_id: selectedLocation,
      brief: episodeBrief,
      videolab_params: {
        motion_style: globalMotion,
        cut_rhythm: globalRhythm,
        music_mood: musicMood
      },
      frames: frames
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storyboard_${selectedBrand.name.toLowerCase()}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL: CONFIGURATION (30%) */}
      <aside className="w-[30%] min-w-[320px] border-r border-uv-border bg-uv-panel/20 flex flex-col">
        <div className="p-4 border-b border-uv-border flex items-center justify-between bg-uv-panel/40">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
            <Zap size={14} className="text-blue-500" />
            Studio Config
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-6 uv-scrollbar">
          {/* Brand & Pack */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-zinc-600 mb-1.5 block">Brand Profile</label>
              <select 
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
                value={selectedBrand.name}
                onChange={(e) => setSelectedBrand(BRAND_PROFILES.find(b => b.name === e.target.value) || BRAND_PROFILES[0])}
              >
                {BRAND_PROFILES.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-zinc-600 mb-1.5 block">Archetype</label>
              <select 
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
                value={selectedArchetype}
                onChange={(e) => setSelectedArchetype(e.target.value as ArchetypeId)}
              >
                {ARCHETYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-zinc-600 mb-1.5 block">Video Pack</label>
              <select 
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
                value={selectedPack.id}
                onChange={(e) => setSelectedPack(VIDEO_PACKS.find(p => p.id === e.target.value) || VIDEO_PACKS[0])}
              >
                {VIDEO_PACKS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Personas */}
          {selectedArchetype !== "single_talking_head" && (
            <div className="space-y-4 pt-4 border-t border-zinc-800/50">
              <h3 className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-2">
                <Users size={12} /> Personas
              </h3>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-bold text-zinc-700">Persona A</label>
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs outline-none"
                    value={personaA.id}
                    onChange={(e) => setPersonaA({ ...personaA, id: e.target.value })}
                  >
                    {filteredPersonas.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[10px] outline-none text-blue-500"
                    value={personaA.role}
                    onChange={(e) => setPersonaA({ ...personaA, role: e.target.value })}
                  >
                    <option value="HOST">HOST</option>
                    <option value="GUEST">GUEST</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-bold text-zinc-700">Persona B</label>
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs outline-none"
                    value={personaB.id}
                    onChange={(e) => setPersonaB({ ...personaB, id: e.target.value })}
                  >
                    <option value="">None</option>
                    {filteredPersonas.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[10px] outline-none text-blue-500"
                    value={personaB.role}
                    onChange={(e) => setPersonaB({ ...personaB, role: e.target.value })}
                  >
                    <option value="HOST">HOST</option>
                    <option value="GUEST">GUEST</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Location & Brief */}
          <div className="space-y-4 pt-4 border-t border-zinc-800/50">
            <div>
              <label className="text-[10px] uppercase font-bold text-zinc-600 mb-1.5 block flex items-center gap-2">
                <MapPin size={12} /> Location
              </label>
              <select 
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-zinc-600 mb-1.5 block">Episode Brief</label>
              <textarea 
                className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs outline-none focus:border-blue-500 transition-all resize-none"
                placeholder="Brief content of the episode..."
                value={episodeBrief}
                onChange={(e) => setEpisodeBrief(e.target.value)}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-4 pt-4 border-t border-zinc-800/50">
            <h3 className="text-[10px] uppercase font-bold text-zinc-500">Video Params</h3>
            
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[9px] uppercase font-bold text-zinc-700 mb-1 block">Motion Style</label>
                <select 
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs outline-none"
                  value={globalMotion}
                  onChange={(e) => setGlobalMotion(e.target.value as MotionStyle)}
                >
                  {MOTION_PRESETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-bold text-zinc-700 mb-1 block">Rhythm</label>
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs outline-none"
                    value={globalRhythm}
                    onChange={(e) => setGlobalRhythm(e.target.value as CutRhythm)}
                  >
                    {RHYTHM_PRESETS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] uppercase font-bold text-zinc-700 mb-1 block">Music Mood</label>
                  <select 
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs outline-none"
                    value={musicMood}
                    onChange={(e) => setMusicMood(e.target.value)}
                  >
                    {MUSIC_MOODS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-uv-border bg-uv-panel/40">
          <RunControlButton isLoading={isGenerating} onClick={handleGeneratePrompts} />
        </div>
      </aside>

      {/* RIGHT PANEL: EDITOR (70%) */}
      <main className="flex-1 flex flex-col bg-black/20">
        <div className="p-4 border-b border-uv-border flex items-center justify-between bg-uv-panel/20">
          <div className="flex items-center gap-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Storyboard Editor</h2>
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
              <Clock size={12} className="text-zinc-500" />
              <span className="text-[10px] font-mono text-zinc-400">{totalDuration}s / {selectedPack.duration_seconds}s</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="secondary" 
              className="flex items-center gap-2 text-[10px] py-1.5"
              onClick={generateAutoStructure}
            >
              <Wand2 size={14} />
              AUTO-STRUCTURE
            </Button>
            <Button 
              variant="secondary" 
              className="flex items-center gap-2 text-[10px] py-1.5"
              onClick={addFrame}
            >
              <Plus size={14} />
              ADD FRAME
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 uv-scrollbar">
          <Panel className="bg-uv-panel/10 border-zinc-800/50 p-0 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-900/50 border-b border-zinc-800">
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold w-12">#</th>
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold">Scene Description</th>
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold w-20 text-center">Sec</th>
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold w-32">Speaker</th>
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold">Overlay Text</th>
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold w-32">Motion</th>
                  <th className="py-3 px-4 text-[10px] uppercase text-zinc-500 font-bold w-12"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {frames.map((frame, idx) => (
                    <motion.tr 
                      key={frame.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-b border-zinc-800/30 group hover:bg-zinc-800/10 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <span className="text-[10px] font-mono text-zinc-600">{idx + 1}</span>
                      </td>
                      <td className="py-4 px-4">
                        <textarea 
                          className="w-full bg-transparent border-none outline-none text-sm text-zinc-300 placeholder:text-zinc-800 resize-none h-8 focus:h-20 transition-all"
                          placeholder="What happens in this frame?"
                          value={frame.prompt}
                          onChange={(e) => updateFrame(idx, { prompt: e.target.value })}
                        />
                      </td>
                      <td className="py-4 px-4 text-center">
                        <input 
                          type="number"
                          className="w-full bg-transparent border-none outline-none text-xs font-mono text-zinc-400 text-center"
                          value={frame.duration_seconds}
                          onChange={(e) => updateFrame(idx, { duration_seconds: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="py-4 px-4">
                        <select 
                          className="w-full bg-transparent border-none outline-none text-xs text-zinc-500"
                          value={frame.label} // Using label as speaker for now in this simple table
                          onChange={(e) => updateFrame(idx, { label: e.target.value })}
                        >
                          <option value="HOST">HOST</option>
                          <option value="GUEST">GUEST</option>
                          <option value="B-ROLL">B-ROLL</option>
                          <option value="LOGO">LOGO</option>
                        </select>
                      </td>
                      <td className="py-4 px-4">
                        <input 
                          type="text"
                          className="w-full bg-transparent border-none outline-none text-xs text-zinc-500 italic"
                          placeholder="None"
                          value={frame.text_overlay || ''}
                          onChange={(e) => updateFrame(idx, { text_overlay: e.target.value })}
                        />
                      </td>
                      <td className="py-4 px-4">
                        <select 
                          className="bg-transparent border-none outline-none text-[10px] text-blue-500 font-bold uppercase"
                          value={frame.motion_style}
                          onChange={(e) => updateFrame(idx, { motion_style: e.target.value as MotionStyle })}
                        >
                          {MOTION_PRESETS.map(m => <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>)}
                        </select>
                      </td>
                      <td className="py-4 px-4">
                        <button 
                          onClick={() => removeFrame(frame.id)}
                          className="text-zinc-800 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {frames.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-20">
                        <Video size={48} strokeWidth={1} />
                        <p className="text-xs font-mono uppercase tracking-widest">No frames defined</p>
                        <Button variant="secondary" onClick={generateAutoStructure} className="text-[10px]">
                          Generate from Template
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-uv-border bg-uv-panel/10 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">Total Duration</span>
              <span className={cn("text-xl font-mono", totalDuration > selectedPack.duration_seconds ? "text-red-500" : "text-white")}>
                {totalDuration.toFixed(1)}s
              </span>
            </div>
            <div className="h-8 w-px bg-zinc-800" />
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">Format</span>
              <span className="text-sm font-mono text-zinc-400">{selectedPack.format.toUpperCase()}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button 
              variant="secondary" 
              className="flex items-center gap-2 px-6"
              onClick={exportJSON}
              disabled={frames.length === 0}
            >
              <Download size={16} />
              EXPORT JSON
            </Button>
            <div className="w-48">
              <RunControlButton 
                isLoading={isGenerating} 
                onClick={handleGeneratePrompts} 
                label="GENERATE PROMPTS"
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
