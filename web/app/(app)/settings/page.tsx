"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

export default function SettingsPage() {
  const { user } = useUser();
  const [isSaved, setIsSaved] = useState(false);

  // Section 1: Profile
  const [fullName, setFullName] = useState("Alexander Sterling");
  const [title, setTitle] = useState("Chief Strategy Officer");
  const [mission, setMission] = useState(
    "Driving digital transformation and high-stakes market expansion for Fortune 500 enterprises through algorithmic precision."
  );
  const [avatarUrl, setAvatarUrl] = useState(
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=60"
  );

  // Section 2: Theme
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("dark");
  const [accent, setAccent] = useState("blue");

  // Section 3: AI Preferences
  const [sensitivity, setSensitivity] = useState(84);
  const [culturalScan, setCulturalScan] = useState(true);
  const [salaryFilter, setSalaryFilter] = useState(true);
  const [stealthMode, setStealthMode] = useState(false);
  const [deepExtraction, setDeepExtraction] = useState(true);

  // Section 4: Accounts
  const [linkedinConnected, setLinkedinConnected] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(true);
  const [githubConnected, setGithubConnected] = useState(false);

  // Section 5: Security
  const [dataRegion, setDataRegion] = useState("North America (US-East)");

  // Load from localStorage on mount
  useEffect(() => {
    // Profile
    const savedName = localStorage.getItem("resumeai-profile-name");
    const savedTitle = localStorage.getItem("resumeai-profile-title");
    const savedMission = localStorage.getItem("resumeai-profile-mission");
    const savedAvatar = localStorage.getItem("resumeai-profile-avatar");
    if (savedName) setFullName(savedName);
    else if (user?.fullName) setFullName(user.fullName);
    if (savedTitle) setTitle(savedTitle);
    if (savedMission) setMission(savedMission);
    if (savedAvatar) setAvatarUrl(savedAvatar);
    else if (user?.imageUrl) setAvatarUrl(user.imageUrl);

    // Theme & Accent
    const savedTheme = localStorage.getItem("theme") || "dark";
    setThemeMode(savedTheme as any);
    const savedAccent = localStorage.getItem("resumeai-accent") || "blue";
    setAccent(savedAccent);

    // AI
    const savedSensitivity = localStorage.getItem("resumeai-ai-sensitivity");
    if (savedSensitivity) setSensitivity(parseInt(savedSensitivity));
    setCulturalScan(localStorage.getItem("resumeai-ai-cultural") !== "false");
    setSalaryFilter(localStorage.getItem("resumeai-ai-salary") !== "false");
    setStealthMode(localStorage.getItem("resumeai-ai-stealth") === "true");
    setDeepExtraction(localStorage.getItem("resumeai-ai-deep") !== "false");
  }, [user]);

  // Set accent variables
  const applyAccent = (colorName: string) => {
    setAccent(colorName);
    localStorage.setItem("resumeai-accent", colorName);

    const accentsMap: Record<string, { color: string; hover: string; glow: string }> = {
      blue: { color: "#2563eb", hover: "#1d4ed8", glow: "rgba(37, 99, 235, 0.15)" },
      gold: { color: "#d97706", hover: "#b45309", glow: "rgba(217, 119, 6, 0.15)" },
      silver: { color: "#64748b", hover: "#475569", glow: "rgba(100, 116, 139, 0.15)" },
      purple: { color: "#7c3aed", hover: "#6d28d9", glow: "rgba(124, 58, 237, 0.15)" },
      coral: { color: "#f43f5e", hover: "#e11d48", glow: "rgba(244, 63, 94, 0.15)" },
    };

    const target = accentsMap[colorName] || accentsMap.blue;
    document.documentElement.style.setProperty("--accent-color", target.color);
    document.documentElement.style.setProperty("--accent-color-hover", target.hover);
    document.documentElement.style.setProperty("--accent-glow", target.glow);
  };

  // Toggle Theme Mode
  const applyThemeMode = (mode: "light" | "dark" | "system") => {
    setThemeMode(mode);
    localStorage.setItem("theme", mode);
    
    if (mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleSaveAll = () => {
    setIsSaved(true);
    // Profile
    localStorage.setItem("resumeai-profile-name", fullName);
    localStorage.setItem("resumeai-profile-title", title);
    localStorage.setItem("resumeai-profile-mission", mission);
    localStorage.setItem("resumeai-profile-avatar", avatarUrl);
    
    // AI
    localStorage.setItem("resumeai-ai-sensitivity", sensitivity.toString());
    localStorage.setItem("resumeai-ai-cultural", culturalScan ? "true" : "false");
    localStorage.setItem("resumeai-ai-salary", salaryFilter ? "true" : "false");
    localStorage.setItem("resumeai-ai-stealth", stealthMode ? "true" : "false");
    localStorage.setItem("resumeai-ai-deep", deepExtraction ? "true" : "false");

    setTimeout(() => {
      setIsSaved(false);
    }, 2000);
  };

  const handleAvatarChange = () => {
    const newUrl = prompt("Enter a custom avatar image URL:", avatarUrl);
    if (newUrl) {
      setAvatarUrl(newUrl);
      localStorage.setItem("resumeai-profile-avatar", newUrl);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl pb-16">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/40 pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
          <p className="text-sm text-slate-400 mt-1">Precision control for your executive career engine.</p>
        </div>
        <button
          onClick={handleSaveAll}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm font-semibold text-white shadow-lg transition-all duration-300 active:scale-95 cursor-pointer"
        >
          {isSaved ? "Saved Successfully!" : "Save Changes"}
        </button>
      </header>

      <div className="space-y-10">
        {/* Section 01: Profile & Branding */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between border-b border-slate-800/30 pb-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
              01. Profile & Branding
            </h3>
            <span className="text-[10px] font-mono text-slate-500">SECTION 01</span>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Avatar Upload mockup */}
            <div className="glass-panel rounded-2xl p-5 flex flex-col items-center justify-center border border-white/5 text-center">
              <div className="relative group cursor-pointer" onClick={handleAvatarChange}>
                <img
                  src={avatarUrl}
                  alt={fullName}
                  className="w-24 h-24 rounded-2xl object-cover border-2 border-white/10 shadow-xl group-hover:opacity-75 transition-opacity"
                />
                <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-bold text-white uppercase">Change</span>
                </div>
              </div>
              <h4 className="text-xs font-semibold text-white mt-4">Public Executive Identity</h4>
              <p className="text-[10px] text-slate-500 mt-1">Click to edit image URL</p>
            </div>

            {/* Profile fields */}
            <div className="md:col-span-2 glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Full Legal Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Executive Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Personal Mission Statement</label>
                <textarea
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  rows={3}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 leading-relaxed font-sans"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Section 02: Theme & Appearance */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between border-b border-slate-800/30 pb-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
              02. Theme & Appearance
            </h3>
            <span className="text-[10px] font-mono text-slate-500">SECTION 02</span>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Mode selector */}
            <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Interface Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "light", label: "Light", icon: "☀️" },
                  { id: "dark", label: "Dark", icon: "🌙" },
                  { id: "system", label: "System", icon: "💻" },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => applyThemeMode(mode.id as any)}
                    className={`py-3 px-4 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                      themeMode === mode.id
                        ? "bg-white/[0.05] border-slate-700 text-white shadow-md"
                        : "bg-white/[0.01] border-white/5 text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>{mode.icon}</span>
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Color pills */}
            <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Accent Color</label>
              <div className="flex flex-wrap items-center gap-4 py-2">
                {[
                  { id: "blue", bg: "bg-[#2563eb]", label: "Blue" },
                  { id: "gold", bg: "bg-[#d97706]", label: "Gold" },
                  { id: "silver", bg: "bg-[#64748b]", label: "Silver" },
                  { id: "purple", bg: "bg-[#7c3aed]", label: "Purple" },
                  { id: "coral", bg: "bg-[#f43f5e]", label: "Coral" },
                ].map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => applyAccent(col.id)}
                    className={`w-9 h-9 rounded-full ${col.bg} border-2 transition-all cursor-pointer hover:scale-110 flex items-center justify-center ${
                      accent === col.id ? "border-white shadow-lg" : "border-transparent"
                    }`}
                    title={col.label}
                  >
                    {accent === col.id && (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 font-mono mt-1">Changes propagate globally across visualizations.</p>
            </div>
          </div>
        </section>

        {/* Section 03: AI Matching Preferences */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between border-b border-slate-800/30 pb-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
              03. AI Matching Preferences
            </h3>
            <span className="text-[10px] font-mono text-slate-500">SECTION 03</span>
          </div>

          <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-6">
            {/* Slider */}
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <div>
                  <h4 className="text-xs font-semibold text-white">Engine Sensitivity</h4>
                  <p className="text-[10px] text-slate-500">Lower values allow for &apos;stretch&apos; roles; higher values enforce strict alignment.</p>
                </div>
                <span className="text-xl font-bold font-mono text-indigo-400">{sensitivity}%</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                value={sensitivity}
                onChange={(e) => setSensitivity(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-[8.5px] font-mono text-slate-500 uppercase mt-1">
                <span>Exploratory</span>
                <span>Optimal Balance</span>
                <span>Strict Fit</span>
              </div>
            </div>

            {/* Toggles Grid */}
            <div className="grid gap-6 sm:grid-cols-2 pt-4 border-t border-slate-800/40">
              {/* Cultural Scan */}
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div>
                  <h5 className="text-xs font-bold text-white">Cultural Alignment Scan</h5>
                  <p className="text-[10px] text-slate-500 mt-0.5">Analyze company leadership DNA for compatibility.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCulturalScan(!culturalScan)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    culturalScan ? "bg-blue-600" : "bg-slate-850"
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    culturalScan ? "left-6" : "left-1"
                  }`} />
                </button>
              </div>

              {/* Salary Anomaly */}
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div>
                  <h5 className="text-xs font-bold text-white">Salary Anomaly Filter</h5>
                  <p className="text-[10px] text-slate-500 mt-0.5">Auto-hide roles falling below compensation thresholds.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSalaryFilter(!salaryFilter)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    salaryFilter ? "bg-blue-600" : "bg-slate-850"
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    salaryFilter ? "left-6" : "left-1"
                  }`} />
                </button>
              </div>

              {/* Stealth Mode */}
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div>
                  <h5 className="text-xs font-bold text-white">Stealth Mode Matching</h5>
                  <p className="text-[10px] text-slate-500 mt-0.5">Hide profile from current employer or direct competitors.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStealthMode(!stealthMode)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    stealthMode ? "bg-blue-600" : "bg-slate-850"
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    stealthMode ? "left-6" : "left-1"
                  }`} />
                </button>
              </div>

              {/* Deep History */}
              <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div>
                  <h5 className="text-xs font-bold text-white">Deep History Extraction</h5>
                  <p className="text-[10px] text-slate-500 mt-0.5">Include archival project data in model matching cycles.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeepExtraction(!deepExtraction)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    deepExtraction ? "bg-blue-600" : "bg-slate-850"
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    deepExtraction ? "left-6" : "left-1"
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Section 04: Connected Accounts */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between border-b border-slate-800/30 pb-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
              04. Connected Accounts
            </h3>
            <span className="text-[10px] font-mono text-slate-500">SECTION 04</span>
          </div>

          <div className="space-y-3">
            {/* LinkedIn */}
            <div className="glass-panel rounded-2xl p-5 flex items-center justify-between border border-white/5">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center font-black text-lg">in</span>
                <div>
                  <h4 className="text-sm font-bold text-white">LinkedIn Professional</h4>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Connected: /in/alex-sterling</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinkedinConnected(!linkedinConnected)}
                className="px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {linkedinConnected ? "Disconnect" : "Connect"}
              </button>
            </div>

            {/* Google */}
            <div className="glass-panel rounded-2xl p-5 flex items-center justify-between border border-white/5">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center font-bold text-base">G</span>
                <div>
                  <h4 className="text-sm font-bold text-white">Google Workspace</h4>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Syncing executive outreach & meeting schedules.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGoogleConnected(!googleConnected)}
                className="px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {googleConnected ? "Manage Sync" : "Connect"}
              </button>
            </div>

            {/* GitHub */}
            <div className="glass-panel rounded-2xl p-5 flex items-center justify-between border border-white/5">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold text-base">git</span>
                <div>
                  <h4 className="text-sm font-bold text-white">GitHub Portfolio</h4>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Showcase technical leadership and open source contributions.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGithubConnected(!githubConnected)}
                className="px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {githubConnected ? "Disconnect" : "Connect"}
              </button>
            </div>
          </div>
        </section>

        {/* Section 05: Security */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between border-b border-slate-800/30 pb-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
              05. Security
            </h3>
            <span className="text-[10px] font-mono text-slate-500">SECTION 05</span>
          </div>

          <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-6">
            {/* 2FA */}
            <div className="flex items-center justify-between border-b border-slate-800/40 pb-4">
              <div>
                <h4 className="text-xs font-bold text-white">Two-Factor Authentication</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Enhance protection using hardware keys or biometric prompts.</p>
              </div>
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md font-mono uppercase">
                Active
              </span>
            </div>

            {/* Session devices */}
            <div className="flex items-center justify-between border-b border-slate-800/40 pb-4">
              <div>
                <h4 className="text-xs font-bold text-white">Session Fingerprinting</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Verify every login attempt against recognized device signatures.</p>
              </div>
              <button className="text-[10px] font-bold text-blue-400 hover:text-blue-300 cursor-pointer">
                Manage Devices
              </button>
            </div>

            {/* Data region */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-white">Data Sovereignty</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Choose your data center region for compliance and latency.</p>
              </div>
              <select
                value={dataRegion}
                onChange={(e) => setDataRegion(e.target.value)}
                className="bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
              >
                <option value="North America (US-East)">North America (US-East)</option>
                <option value="Europe (EU-Central)">Europe (EU-Central)</option>
                <option value="Asia Pacific (APAC-South)">Asia Pacific (APAC-South)</option>
              </select>
            </div>

            {/* Danger zone */}
            <div className="pt-6 border-t border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-rose-400">Terminate Account</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Account termination is irreversible. All career historical data will be purged.</p>
              </div>
              <button
                onClick={() => {
                  if (confirm("WARNING: Are you absolutely sure you want to terminate this account? This action is permanent.")) {
                    alert("Account purged.");
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
              >
                Terminate Account
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
