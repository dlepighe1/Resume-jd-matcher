"use client";

import { useState } from "react";

interface ResumeVersion {
  id: string;
  title: string;
  score: number;
  isPrimary: boolean;
  modified: string;
  content: {
    name: string;
    title: string;
    summary: string;
    competencies: string[];
    experience: {
      role: string;
      company: string;
      period: string;
      bullets: string[];
    }[];
  };
}

export default function ResumesPage() {
  const [selectedId, setSelectedId] = useState("1");
  const [resumes, setResumes] = useState<ResumeVersion[]>([
    {
      id: "1",
      title: "Product Architect - Fintech",
      score: 94,
      isPrimary: true,
      modified: "Modified 2 days ago",
      content: {
        name: "ALEX STERLING",
        title: "Product Architect | Fintech & Scalable Infrastructure",
        summary: "Visionary technologist with 12+ years of experience building high-frequency trading platforms and decentralized ledger systems. Proven track record of scaling engineering teams from 10 to 150+ while maintaining 99.99% uptime for Tier-1 financial institutions.",
        competencies: ["Distributed Systems", "Regulatory Compliance", "Smart Contract Audit", "Team Mentorship", "Strategic Roadmap", "Go-to-Market"],
        experience: [
          {
            role: "Lead Solutions Architect",
            company: "Vanguard Financial Group",
            period: "2019 — Present",
            bullets: [
              "Designed core blockchain transaction engine processing 1.2M transactions per second under peak loads.",
              "Architected cross-border liquidity pools reducing settlement latency by 85% ($1.2B daily volume).",
              "Supervised a staff of 45 engineers spread across three international hubs, aligning delivery with SEC and GDPR audits."
            ]
          },
          {
            role: "Senior Software Engineer",
            company: "CryptoNexus",
            period: "2016 — 2019",
            bullets: [
              "Pioneered smart contract patterns on EVM networks saving $4.2M in annual gas optimization charges.",
              "Scaled microservices using Rust and Go, reducing cloud computing overhead costs by 22%."
            ]
          }
        ]
      }
    },
    {
      id: "2",
      title: "VP Engineering - Scaleup",
      score: 82,
      isPrimary: false,
      modified: "Modified 1 week ago",
      content: {
        name: "ALEX STERLING",
        title: "VP of Engineering | Scaling Organizations & Hypergrowth",
        summary: "Strategic leader focused on scaling tech start-ups through Series B & C funding rounds. Expertise in building organizational structures, implementing agile practices, and driving cloud migration strategies to maximize platform scalability.",
        competencies: ["Agile Transformation", "Series B/C Scale", "Cloud Migration", "Talent Acquisition", "OPEX Management", "vendor Negotiations"],
        experience: [
          {
            role: "Director of Engineering",
            company: "Apex HyperScale",
            period: "2020 — 2024",
            bullets: [
              "Grew the engineering department from 25 to 110 employees, maintaining a 94% retention rate over four years.",
              "Led migration of legacy on-premise infrastructure to AWS, cutting API response times in half.",
              "Implemented OKR frameworks across 8 development pods, boosting product release frequency by 40%."
            ]
          }
        ]
      }
    },
    {
      id: "3",
      title: "General Tech Leadership",
      score: 65,
      isPrimary: false,
      modified: "Modified 3 weeks ago",
      content: {
        name: "ALEX STERLING",
        title: "Executive Technology Leader | Enterprise Architect",
        summary: "Seasoned executive specializing in digital transformation projects, legacy system migrations, and aligning business goals with modern software development practices. Experience directing large teams and global product budgets.",
        competencies: ["Digital Transformation", "Legacy Migrations", "Budgeting & CAPEX", "Executive Relations", "Vendor Management", "SAFe Agile"],
        experience: [
          {
            role: "Chief Architect",
            company: "Legacy Holdings Corp",
            period: "2014 — 2020",
            bullets: [
              "Orchestrated modern web stack integration across 14 enterprise divisions, replacing 25-year-old COBOL engines.",
              "Managed a $12M annual capital expenditure budget, delivering key milestones ahead of schedule."
            ]
          }
        ]
      }
    }
  ]);

  const [zoomLevel, setZoomLevel] = useState(100);
  const selectedResume = resumes.find(r => r.id === selectedId) || resumes[0];

  const handleMakePrimary = (id: string) => {
    setResumes(resumes.map(r => ({
      ...r,
      isPrimary: r.id === id
    })));
  };

  const handleUploadClick = () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/pdf";
    fileInput.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        // Mock add
        const newRes: ResumeVersion = {
          id: Date.now().toString(),
          title: file.name.replace(".pdf", "") || "New Uploaded Resume",
          score: Math.floor(Math.random() * 25) + 75,
          isPrimary: false,
          modified: "Uploaded just now",
          content: {
            name: "ALEX STERLING",
            title: "Executive Candidate Profile",
            summary: "Extracted summary details from uploaded PDF document file. The parser successfully processed candidate info.",
            competencies: ["Systems Architecture", "Technical Delivery", "Executive Strategy"],
            experience: [
              {
                role: "Senior Engineering Role",
                company: "Previous Tech Firm",
                period: "2012 — 2016",
                bullets: [
                  "Extracted bullet points and aligned with matching algorithms.",
                  "Supported high-capacity cloud infrastructures."
                ]
              }
            ]
          }
        };
        setResumes([newRes, ...resumes]);
        setSelectedId(newRes.id);
      }
    };
    fileInput.click();
  };

  return (
    <div className="space-y-8">
      {/* Header section */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Resume Management</h1>
          <p className="text-sm text-slate-400 mt-1">Manage and optimize your career blueprints.</p>
        </div>
        <button
          onClick={handleUploadClick}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm font-semibold text-white shadow-lg shadow-blue-500/10 transition-all duration-300 active:scale-95 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload New Version
        </button>
      </header>

      {/* Main Grid */}
      <div className="grid gap-8 lg:grid-cols-12 items-start">
        {/* Left Column: Versions List (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Versions ({resumes.length} Active Resumes)</h3>
            
            <div className="space-y-3">
              {resumes.map((res) => {
                const active = res.id === selectedId;
                return (
                  <div
                    key={res.id}
                    onClick={() => setSelectedId(res.id)}
                    className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer ${
                      active
                        ? "bg-white/[0.04] border-slate-700 shadow-xl scale-[1.01]"
                        : "bg-white/[0.01] border-white/5 hover:border-slate-800 hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-white leading-snug">{res.title}</h4>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">{res.modified}</p>
                      </div>
                      
                      {/* Score Badge */}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                        res.score >= 90
                          ? "text-emerald-400 bg-emerald-500/10"
                          : res.score >= 70
                          ? "text-amber-400 bg-amber-500/10"
                          : "text-slate-400 bg-slate-500/10"
                      }`}>
                        ★ {res.score}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800/40 pt-3">
                      <span className="text-[10px] text-slate-400">
                        {res.isPrimary ? (
                          <span className="text-blue-400 font-bold bg-blue-500/10 px-1.5 py-0.5 rounded">PRIMARY</span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMakePrimary(res.id);
                            }}
                            className="hover:text-white transition-colors cursor-pointer"
                          >
                            Set Primary
                          </button>
                        )}
                      </span>

                      <div className="flex gap-2">
                        <button className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold cursor-pointer">Edit</button>
                        <span className="text-slate-700">|</span>
                        <button className="text-[10px] text-rose-500 hover:text-rose-400 font-semibold cursor-pointer">Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Obsidian Insights */}
          <div className="p-5 rounded-2xl bg-gradient-to-b from-indigo-950/20 to-blue-950/10 border border-indigo-500/15 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-indigo-500/10 to-transparent rounded-bl-full pointer-events-none" />
            <div className="flex gap-3">
              <span className="text-lg">✨</span>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 font-mono">Obsidian Insights</h4>
                <p className="text-[11.5px] text-slate-300 mt-2 leading-relaxed">
                  Your <strong className="text-white">&quot;Fintech&quot;</strong> variant has a <span className="text-emerald-400 font-bold">98% match</span> with 12 open roles in your network. Consider adding <strong className="text-white">&quot;Blockchain Infrastructure&quot;</strong> to boost conversion rates by <span className="text-indigo-400 font-bold">15%</span>.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Preview (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Live Preview</h3>
            
            {/* Toolbar */}
            <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800/80 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M11 4a7 7 0 0 1 7 7v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7a7 7 0 0 1 7-7z" />
                </svg>
                1 of 2 Pages
              </span>
              <span className="text-slate-800">|</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                ATS-Optimized
              </span>
              <span className="text-slate-800">|</span>
              <div className="flex gap-2">
                <button onClick={() => setZoomLevel(Math.max(50, zoomLevel - 10))} className="hover:text-white cursor-pointer" title="Zoom Out">-</button>
                <span>{zoomLevel}%</span>
                <button onClick={() => setZoomLevel(Math.min(150, zoomLevel + 10))} className="hover:text-white cursor-pointer" title="Zoom In">+</button>
              </div>
              <span className="text-slate-800">|</span>
              <button className="hover:text-white cursor-pointer" title="Print/Download">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Paper Canvas container */}
          <div className="w-full bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 overflow-x-auto flex justify-center shadow-inner">
            {/* The Resume Sheet Mock */}
            <div
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top center" }}
              className="w-[500px] min-h-[680px] bg-white text-slate-900 p-8 shadow-2xl rounded border border-slate-300 font-serif leading-relaxed text-left transition-all"
            >
              {/* Header */}
              <div className="text-center border-b-2 border-slate-800 pb-4">
                <h2 className="text-2xl font-black tracking-widest font-sans text-slate-950">{selectedResume.content.name}</h2>
                <h3 className="text-xs uppercase font-semibold tracking-wider font-sans text-slate-500 mt-1">{selectedResume.content.title}</h3>
                <div className="text-[10px] text-slate-500 flex justify-center gap-2 mt-2 font-mono">
                  <span>NEW YORK, NY</span>
                  <span>•</span>
                  <span>LINKEDIN.COM/IN/ASTERLING</span>
                  <span>•</span>
                  <span>EXECUTIVE PORTFOLIO</span>
                </div>
              </div>

              {/* Summary */}
              <div className="mt-5">
                <h4 className="text-[10px] uppercase font-bold tracking-widest font-sans text-slate-700 mb-1.5">Executive Summary</h4>
                <p className="text-[11px] text-slate-800 leading-relaxed font-sans">{selectedResume.content.summary}</p>
              </div>

              {/* Competencies */}
              <div className="mt-5">
                <h4 className="text-[10px] uppercase font-bold tracking-widest font-sans text-slate-700 mb-1.5">Core Competencies</h4>
                <div className="grid grid-cols-3 gap-y-1 text-[10px] font-sans font-medium text-slate-700">
                  {selectedResume.content.competencies.map((comp, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-blue-500" />
                      {comp}
                    </span>
                  ))}
                </div>
              </div>

              {/* Experience */}
              <div className="mt-5">
                <h4 className="text-[10px] uppercase font-bold tracking-widest font-sans text-slate-700 mb-2">Professional Milestones</h4>
                <div className="space-y-4">
                  {selectedResume.content.experience.map((exp, i) => (
                    <div key={i}>
                      <div className="flex justify-between items-baseline text-[11px] font-sans font-bold text-slate-950">
                        <span>{exp.role} <span className="font-normal text-slate-500">at {exp.company}</span></span>
                        <span className="text-[9.5px] text-slate-500 font-mono font-normal">{exp.period}</span>
                      </div>
                      <ul className="list-disc list-outside pl-4 mt-1 text-[10px] text-slate-700 space-y-1 font-sans">
                        {exp.bullets.map((b, idx) => (
                          <li key={idx} className="leading-relaxed">{b}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
