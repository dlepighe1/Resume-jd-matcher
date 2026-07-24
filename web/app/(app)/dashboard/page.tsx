"use client";

import Link from "next/link";
import { useState } from "react";

const activity = [
  { title: "Interview confirmed", detail: "Google · Platform Strategy", time: "Tomorrow, 10:00 AM", tone: "blue" },
  { title: "New 98% match", detail: "Founders Fund · Portfolio Systems", time: "12 minutes ago", tone: "gold" },
  { title: "Response received", detail: "NVIDIA · Global Operations", time: "Yesterday", tone: "neutral" },
  { title: "Contact engaged", detail: "Maya Chen · Stripe", time: "2 days ago", tone: "blue" },
];

const targets = [
  { id: 1, score: "99.4%", title: "VP of Engineering", company: "Anthropic", location: "San Francisco · Hybrid", salary: "$450K–$600K TC", note: "Your distributed systems leadership maps directly to the team’s current scaling mandate." },
  { id: 2, score: "98.1%", title: "Head of Cloud Operations", company: "Databricks", location: "Seattle · Hybrid", salary: "Equity focused", note: "Strong technical operations fit with a manageable gap in public-cloud cost ownership." },
];

export default function DashboardPage() {
  const [selected, setSelected] = useState<(typeof targets)[number] | null>(null);
  const [period, setPeriod] = useState("8 weeks");

  return (
    <div className="executive-page">
      <header className="page-header">
        <div><span className="page-kicker">CAREER COMMAND CENTER</span><h1>Executive Overview</h1><p>Signals, momentum, and the next best action across your search.</p></div>
        <div className="page-actions"><button className="icon-button" type="button" aria-label="Notifications">○<i /></button><Link href="/matcher" className="obsidian-button">Start Matcher <span>↗</span></Link></div>
      </header>

      <section className="metric-strip">
        <article><span>ACTIVE APPLICATIONS</span><strong>24</strong><p><b>+6</b> this month</p></article>
        <article><span>INTERVIEW RATE</span><strong>18.7%</strong><p><b>+4.2%</b> from last cycle</p></article>
        <article><span>NETWORK MOMENTUM</span><strong>12</strong><p><b>5</b> warm conversations</p></article>
        <article><span>AVG. MATCH QUALITY</span><strong>91%</strong><p><b>Top 8%</b> of targets</p></article>
      </section>

      <section className="dashboard-grid">
        <article className="obsidian-panel velocity-panel">
          <div className="panel-heading"><div><span>SEARCH MOMENTUM</span><h2>Job Hunt Velocity</h2><p>Applications and interview invitations over time.</p></div><select value={period} onChange={(e)=>setPeriod(e.target.value)} aria-label="Chart period"><option>8 weeks</option><option>12 weeks</option><option>6 months</option></select></div>
          <div className="velocity-chart">
            <div className="chart-grid"><i /><i /><i /></div>
            <div className="velocity-line" aria-hidden="true"><span style={{left:"2%",bottom:"14%"}}/><span style={{left:"16%",bottom:"18%"}}/><span style={{left:"30%",bottom:"37%"}}/><span style={{left:"44%",bottom:"44%"}}/><span style={{left:"58%",bottom:"55%"}}/><span style={{left:"72%",bottom:"61%"}}/><span style={{left:"86%",bottom:"76%"}}/><span style={{left:"98%",bottom:"82%"}}/></div>
            <div className="chart-columns">{[22,28,43,50,59,67,78,88].map((height,index)=><i key={index} style={{height:`${height}%`}}><span>{[5,8,12,10,15,18,22,25][index]}</span></i>)}</div>
          </div>
          <div className="chart-footer">{["W1","W2","W3","W4","W5","W6","W7","W8"].map(w=><span key={w}>{w}</span>)}</div>
        </article>

        <article className="obsidian-panel distribution-panel">
          <div className="panel-heading"><div><span>PORTFOLIO HEALTH</span><h2>Match Distribution</h2><p>Relevance across saved roles.</p></div></div>
          <div className="distribution-list">
            <div><p><span>HIGH CONFIDENCE</span><b>14 roles</b></p><i><u style={{width:"76%"}} /></i><small>90–100%</small></div>
            <div><p><span>MARKET READY</span><b>38 roles</b></p><i><u style={{width:"53%"}} /></i><small>70–89%</small></div>
            <div><p><span>NEEDS POSITIONING</span><b>12 roles</b></p><i><u style={{width:"22%"}} /></i><small>Below 70%</small></div>
          </div>
          <Link href="/matcher" className="panel-link">Run a new analysis <span>→</span></Link>
        </article>

        <article className="obsidian-panel activity-panel">
          <div className="panel-heading"><div><span>LIVE SIGNALS</span><h2>Recent Intelligence</h2></div><Link href="/applications">View all</Link></div>
          <div className="activity-list">{activity.map((item)=><div key={item.title}><i className={`tone-${item.tone}`} /><span><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></span></div>)}</div>
        </article>

        <section className="priority-panel">
          <div className="priority-heading"><div><span>RECOMMENDED NEXT MOVES</span><h2>Priority Targets</h2><p>Roles where your evidence and current momentum are strongest.</p></div><Link href="/applications">All applications →</Link></div>
          <div className="target-grid">{targets.map(target=><article key={target.id} className="target-card"><div className="target-card__top"><span>{target.company.slice(0,1)}</span><b>{target.score} MATCH</b></div><small>{target.salary}</small><h3>{target.title}</h3><p>{target.company} · {target.location}</p><div><i>TOP PRIORITY</i><button onClick={()=>setSelected(target)} type="button">Review target</button></div></article>)}</div>
        </section>
      </section>

      {selected && <div className="detail-modal" role="dialog" aria-modal="true" aria-label="Target details"><button className="detail-modal__backdrop" onClick={()=>setSelected(null)} aria-label="Close" /><article><button onClick={()=>setSelected(null)} aria-label="Close">×</button><span className="page-kicker">PRIORITY TARGET · {selected.score} MATCH</span><h2>{selected.title}</h2><p>{selected.company} · {selected.location}</p><div className="modal-insight">{selected.note}</div><div className="modal-actions"><Link href="/matcher" className="obsidian-button">Analyze this role ↗</Link><Link href="/network" className="ghost-button">Find a connection</Link></div></article></div>}
    </div>
  );
}
