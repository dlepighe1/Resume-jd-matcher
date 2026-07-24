"use client";

import { useState, useEffect } from "react";

interface Application {
  id: string;
  company: string;
  title: string;
  link: string;
  appliedTime: string; // ISO string or relative description
  resumeUsed: string;
  status: "Interviewing" | "Pending" | "Rejected";
  notes: string;
  logoColor: string; // gradient CSS class
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  
  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newLink, setNewLink] = useState("");
  const [newResume, setNewResume] = useState("Product Architect - Fintech");
  const [newStatus, setNewStatus] = useState<"Interviewing" | "Pending" | "Rejected">("Pending");
  const [newNotes, setNewNotes] = useState("");

  // Inline notes edit state
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [tempNotesValue, setTempNotesValue] = useState("");

  const logoGradients = [
    "from-blue-600 to-indigo-500",
    "from-emerald-600 to-teal-500",
    "from-purple-600 to-pink-500",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-red-600",
  ];

  // Initialize from LocalStorage or mock data
  useEffect(() => {
    const saved = localStorage.getItem("resumeai-applications");
    if (saved) {
      try {
        setApplications(JSON.parse(saved));
      } catch (e) {
        loadMockData();
      }
    } else {
      loadMockData();
    }
  }, []);

  const loadMockData = () => {
    const mock: Application[] = [
      {
        id: "1",
        company: "Google",
        title: "L7 Technical Strategy Lead",
        link: "https://careers.google.com/jobs/results/l7-strategy-lead",
        appliedTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        resumeUsed: "Product Architect - Fintech (Primary)",
        status: "Interviewing",
        notes: "Round 1 system design completed successfully. Prepared slides detailing high-scale architecture alignment with Google Cloud Spanner services.",
        logoColor: "from-blue-600 to-indigo-500",
      },
      {
        id: "2",
        company: "NVIDIA",
        title: "Global Operations Lead - AI Cluster",
        link: "https://nvidia.wd5.myworkdayjobs.com/nvidia-careers",
        appliedTime: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        resumeUsed: "VP Engineering - Scaleup",
        status: "Pending",
        notes: "Awaiting response. Hiring manager reached out on LinkedIn last Friday indicating deep interest in my hypergrowth engineering scaling background.",
        logoColor: "from-emerald-600 to-teal-500",
      },
      {
        id: "3",
        company: "Apple",
        title: "Principal Executive Architect",
        link: "https://jobs.apple.com",
        appliedTime: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        resumeUsed: "General Tech Leadership",
        status: "Rejected",
        notes: "Position closed. Recruiter left a nice note stating that although skills were exemplary, they are looking to hire locally in Cupertino.",
        logoColor: "from-slate-700 to-slate-900",
      },
      {
        id: "4",
        company: "OpenAI",
        title: "Technical Director - Alignment Systems",
        link: "https://openai.com/careers",
        appliedTime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        resumeUsed: "Product Architect - Fintech (Primary)",
        status: "Interviewing",
        notes: "Final stage presentation scheduled next Wednesday. Need to review deep learning reinforcement learning human feedback models.",
        logoColor: "from-purple-600 to-pink-500",
      },
    ];
    setApplications(mock);
    localStorage.setItem("resumeai-applications", JSON.stringify(mock));
  };

  const saveToStorage = (updatedList: Application[]) => {
    setApplications(updatedList);
    localStorage.setItem("resumeai-applications", JSON.stringify(updatedList));
  };

  // Add application
  const handleAddApplication = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany || !newTitle) return;

    const newApp: Application = {
      id: Date.now().toString(),
      company: newCompany,
      title: newTitle,
      link: newLink || "#",
      appliedTime: new Date().toISOString(),
      resumeUsed: newResume,
      status: newStatus,
      notes: newNotes,
      logoColor: logoGradients[Math.floor(Math.random() * logoGradients.length)],
    };

    const updated = [newApp, ...applications];
    saveToStorage(updated);
    
    // Reset form
    setNewCompany("");
    setNewTitle("");
    setNewLink("");
    setNewStatus("Pending");
    setNewNotes("");
    setIsAddModalOpen(false);
  };

  // Change status
  const handleStatusChange = (id: string, status: "Interviewing" | "Pending" | "Rejected") => {
    const updated = applications.map((app) => 
      app.id === id ? { ...app, status } : app
    );
    saveToStorage(updated);
  };

  // Update Notes
  const handleNotesSave = (id: string) => {
    const updated = applications.map((app) => 
      app.id === id ? { ...app, notes: tempNotesValue } : app
    );
    saveToStorage(updated);
    setEditingNotesId(null);
  };

  // Delete application
  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this application?")) {
      const updated = applications.filter((app) => app.id !== id);
      saveToStorage(updated);
    }
  };

  // Format relative time
  const formatRelativeTime = (isoString: string) => {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Applied today";
      if (diffDays === 1) return "Applied yesterday";
      return `Applied ${diffDays} days ago`;
    } catch {
      return "Applied recently";
    }
  };

  // Filter applications
  const filteredApps = applications.filter((app) => {
    const matchesSearch = 
      app.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.notes.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (statusFilter === "All") return matchesSearch;
    return app.status === statusFilter && matchesSearch;
  });

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Your Applications</h1>
          <p className="text-sm text-slate-400 mt-1">Track and manage your high-level pipeline.</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm font-semibold text-white shadow-lg shadow-blue-500/10 transition-all duration-300 active:scale-95 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Application
        </button>
      </header>

      {/* Filters & Search panel */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <svg className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search company, role or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0b0f19]/80 border border-slate-800/80 rounded-xl pl-10 pr-4 py-2 text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-1.5 p-1 bg-slate-950/80 border border-slate-800/80 rounded-xl">
          {["All", "Interviewing", "Pending", "Rejected"].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === status
                  ? "bg-white/[0.08] text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Grid List */}
      {filteredApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-20 glass-panel rounded-2xl border-dashed border-slate-800">
          <span className="text-4xl">📁</span>
          <h3 className="text-base font-bold text-white mt-4">No applications found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm text-center">
            Modify your search criteria or click &quot;Add Application&quot; to begin filling your job pipeline.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredApps.map((app) => (
            <div
              key={app.id}
              className="glass-card flex flex-col justify-between hover:border-slate-700/80 group"
            >
              {/* Header: Logo and Status */}
              <div>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${app.logoColor} flex items-center justify-center text-lg font-black text-white shadow-lg`}>
                    {app.company.charAt(0)}
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      app.status === "Interviewing"
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : app.status === "Pending"
                        ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                    }`}
                  >
                    {app.status === "Interviewing" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    )}
                    {app.status}
                  </span>
                </div>

                {/* Company and Title */}
                <div>
                  <h3 className="text-base font-bold text-white leading-tight">{app.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-semibold text-slate-300">{app.company}</span>
                    <a
                      href={app.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-blue-400 transition-colors"
                      title="Link to posting"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                </div>

                {/* Time & Resume Metadata */}
                <div className="mt-4 pt-3 border-t border-slate-800/30 flex flex-wrap gap-2 text-[10px] font-mono text-slate-400">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {formatRelativeTime(app.appliedTime)}
                  </span>
                  <span className="flex items-center gap-1 bg-white/[0.02] border border-white/[0.04] px-1.5 py-0.5 rounded">
                    <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    {app.resumeUsed.split("(")[0]}
                  </span>
                </div>

                {/* Notes Block */}
                <div className="mt-4 p-3 rounded-xl bg-slate-950/40 border border-white/5 relative">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Notes</span>
                    {editingNotesId !== app.id && (
                      <button
                        onClick={() => {
                          setEditingNotesId(app.id);
                          setTempNotesValue(app.notes);
                        }}
                        className="text-[10px] font-semibold text-blue-400 hover:text-blue-300 cursor-pointer"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {editingNotesId === app.id ? (
                    <div className="space-y-2 mt-1.5">
                      <textarea
                        value={tempNotesValue}
                        onChange={(e) => setTempNotesValue(e.target.value)}
                        className="w-full bg-[#080c14] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                        rows={3}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setEditingNotesId(null)}
                          className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleNotesSave(app.id)}
                          className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-505 text-[10px] text-white font-semibold cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 leading-relaxed max-h-24 overflow-y-auto">
                      {app.notes || "No notes logged yet. Double-click here to write notes."}
                    </p>
                  )}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="mt-5 pt-3 border-t border-slate-800/40 flex items-center justify-between gap-3">
                {/* Status Switcher shortcuts */}
                <div className="flex gap-1">
                  {(["Interviewing", "Pending", "Rejected"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => handleStatusChange(app.id, st)}
                      className={`text-[9px] font-bold px-1.5 py-1 rounded transition-colors cursor-pointer ${
                        app.status === st
                          ? "bg-white/10 text-white"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                      title={`Mark as ${st}`}
                    >
                      {st.charAt(0)}
                    </button>
                  ))}
                </div>

                {/* Delete button */}
                <button
                  onClick={() => handleDelete(app.id)}
                  className="p-1 text-slate-600 hover:text-rose-400 rounded-lg hover:bg-rose-500/5 transition-colors cursor-pointer"
                  title="Remove application"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Application Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setIsAddModalOpen(false)} />
          {/* Form container */}
          <form
            onSubmit={handleAddApplication}
            className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#0a0d16] p-6 shadow-2xl glass-panel animate-in fade-in zoom-in duration-300 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Log Application</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Inputs */}
            <div className="space-y-3">
              {/* Company */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Company Name *</label>
                <input
                  type="text"
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="e.g. Stripe, Airbnb"
                  className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Job Title *</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Senior Software Architect"
                  className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Job Link */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Link to Posting</label>
                <input
                  type="url"
                  value={newLink}
                  onChange={(e) => setNewLink(e.target.value)}
                  placeholder="https://company.com/careers/job"
                  className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Status and Resume */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as any)}
                    className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Interviewing">Interviewing</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Resume Used</label>
                  <select
                    value={newResume}
                    onChange={(e) => setNewResume(e.target.value)}
                    className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Product Architect - Fintech">Fintech Resume</option>
                    <option value="VP Engineering - Scaleup">Scaleup Resume</option>
                    <option value="General Tech Leadership">Executive Resume</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Notes</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Insert follow-up dates, interviewer names, or next step preparations..."
                  rows={3}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-xs font-bold text-white shadow-lg transition-colors cursor-pointer"
              >
                Log Application
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
