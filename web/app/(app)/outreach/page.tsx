"use client";

import { useState, useEffect } from "react";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export default function OutreachPage() {
  const [selectedTemplateId, setSelectedTemplateId] = useState("1");
  const [recruiterName, setRecruiterName] = useState("Sarah Jenkins");
  const [companyName, setCompanyName] = useState("Google");
  const [jobTitle, setJobTitle] = useState("L7 Technical Strategy Lead");
  const [senderName, setSenderName] = useState("Alex Sterling");

  const templates: EmailTemplate[] = [
    {
      id: "1",
      name: "Cold Recruiter Pitch",
      subject: "Inquiry: Executive Engineering Leadership Opportunities at {Company}",
      body: "Hi {Recruiter},\n\nI hope this email finds you well.\n\nI've been following {Company}'s recent expansions in AI infrastructure, specifically the launch of your core model clusters. With 12+ years of fintech systems architecture scaling, I wanted to reach out regarding potential alignment.\n\nMy background includes supervising 45+ engineers and reducing microservice latency by 85% at Vanguard. I recently reviewed the {Job_Title} opening and feel my experience matches your current roadmap demands.\n\nDo you have 10 minutes next Tuesday for a brief introductory call?\n\nBest regards,\n{Sender_Name}"
    },
    {
      id: "2",
      name: "Application Follow-Up",
      subject: "Follow-up: Application status for {Job_Title} - {Sender_Name}",
      body: "Hi {Recruiter},\n\nI hope your week is off to a great start.\n\nI wanted to follow up on my application for the {Job_Title} role at {Company}. Having recently optimized database execution workloads for major scaleups, I am extremely excited about this opportunity.\n\nI've attached my updated Fintech Blueprint resume highlighting systems uptime compliance audits. I'd love to jump on a quick call to elaborate on how I can support your engineering teams.\n\nBest,\n{Sender_Name}"
    },
    {
      id: "3",
      name: "Referral Request",
      subject: "Systems Design Discussion / Potential Referral - {Sender_Name}",
      body: "Hi {Recruiter},\n\nHope all is well.\n\nI noticed you are currently managing engineering pods at {Company}. I'm an executive architect looking to transition into your space and recently applied to the {Job_Title} role.\n\nGiven your focus on Kubernetes cluster costs, I thought you might find my smart contract gas reduction metrics interesting. I'd value your advice on the organization's growth trajectory if you have a few minutes for a virtual coffee.\n\nThanks,\n{Sender_Name}"
    }
  ];

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
  const [editedBody, setEditedBody] = useState(selectedTemplate.body);
  const [editedSubject, setEditedSubject] = useState(selectedTemplate.subject);
  const [aiRefining, setAiRefining] = useState(false);

  // Sync editor when switching template or variables
  useEffect(() => {
    setEditedBody(selectedTemplate.body);
    setEditedSubject(selectedTemplate.subject);
  }, [selectedTemplateId]);

  // Replace tokens in string helper
  const replaceTokens = (text: string) => {
    return text
      .replace(/{Recruiter}/g, recruiterName || "[Recruiter Name]")
      .replace(/{Company}/g, companyName || "[Company]")
      .replace(/{Job_Title}/g, jobTitle || "[Job Title]")
      .replace(/{Sender_Name}/g, senderName || "[Your Name]");
  };

  const handleRefineWithAI = () => {
    setAiRefining(true);
    setTimeout(() => {
      // Professional AI polish simulation
      const polished = replaceTokens(editedBody) + "\n\n[AI ENHANCEMENT: Formatted using Recruiter-CTR models, strengthening action verb statements and closing calls to action by 25%]";
      setEditedBody(polished);
      setAiRefining(false);
    }, 1200);
  };

  const handleSend = () => {
    alert(`Outreach email queued! Sent to: ${recruiterName.toLowerCase().replace(/ /g, "")}@${companyName.toLowerCase()}.com`);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-white">Outreach Campaigns</h1>
        <p className="text-sm text-slate-400 mt-1">Compose and automate cold outreach using tailored templates.</p>
      </header>

      {/* Funnel Metrics Row */}
      <div className="grid gap-6 sm:grid-cols-4">
        {/* Sent */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 relative">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Sent</span>
          <h3 className="text-2xl font-black text-white mt-1 tabular">148</h3>
          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 mt-2">
            ↑ 12% vs last month
          </span>
        </div>

        {/* Opened */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 relative">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Open Rate</span>
          <h3 className="text-2xl font-black text-white mt-1 tabular">74.2%</h3>
          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 mt-2">
            ↑ 2.4% above average
          </span>
        </div>

        {/* Replied */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 relative">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reply Rate</span>
          <h3 className="text-2xl font-black text-white mt-1 tabular">38.5%</h3>
          <span className="text-[10px] text-indigo-400 font-mono flex items-center gap-1 mt-2">
            Stable velocity
          </span>
        </div>

        {/* Conversion */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 relative">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Interviews Sparked</span>
          <h3 className="text-2xl font-black text-white mt-1 tabular">16</h3>
          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 mt-2">
            ↑ 4 new scheduling
          </span>
        </div>
      </div>

      {/* Campaign Workspace layout */}
      <div className="grid gap-8 lg:grid-cols-12 items-start">
        {/* Left pane: Templates & Variables (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Templates list */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Campaign Templates</h3>
            <div className="space-y-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                  className={`w-full text-left p-3.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    tpl.id === selectedTemplateId
                      ? "bg-white/[0.04] border-slate-700 text-white shadow-md"
                      : "bg-white/[0.01] border-white/5 text-slate-400 hover:text-white hover:bg-white/[0.02]"
                  }`}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>

          {/* Form Variables */}
          <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Template Tokens</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Recruiter Name</label>
                <input
                  type="text"
                  value={recruiterName}
                  onChange={(e) => setRecruiterName(e.target.value)}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Company</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Job Title</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right pane: Composer and Live preview (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/40 pb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Draft Composer</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRefineWithAI}
                  disabled={aiRefining}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/20 text-[10px] font-bold text-indigo-300 transition-colors cursor-pointer"
                >
                  {aiRefining ? "AI Refining..." : "✨ Refine with AI"}
                </button>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Subject Line</label>
                <input
                  type="text"
                  value={editedSubject}
                  onChange={(e) => setEditedSubject(e.target.value)}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Email Body</label>
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={12}
                  className="w-full bg-[#080c14] border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-blue-500 leading-relaxed font-sans"
                />
              </div>
            </div>

            {/* Resolved Preview rendering */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-white/5 relative">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Live Resolved Preview</h4>
              <div className="font-mono text-[10px] text-slate-500 mb-2 border-b border-slate-800 pb-2">
                <p>Subject: <span className="text-slate-300 font-semibold">{replaceTokens(editedSubject)}</span></p>
              </div>
              <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                {replaceTokens(editedBody)}
              </p>
            </div>

            {/* Send CTA */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleSend}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-xs font-bold text-white shadow-lg cursor-pointer"
              >
                Send Outreach Campaign
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
