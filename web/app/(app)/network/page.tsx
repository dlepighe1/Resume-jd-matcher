"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "directory" | "graph" | "research";
type Contact = {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  relationship: "Warm" | "Engaged" | "Priority";
  credentials: string[];
  notes: string;
  lastContact: string;
};

const initialContacts: Contact[] = [
  { id:"1", name:"Sarah Jenkins", role:"Principal Technical Recruiter", company:"Google", email:"sjenkins@google.com", relationship:"Priority", credentials:["Executive recruiting","Cloud leadership","12 shared contacts"], notes:"Owns the L7 strategy search. Final system-design loop is being coordinated for next week.", lastContact:"Yesterday" },
  { id:"2", name:"Marcus Vance", role:"Director, Talent Acquisition", company:"NVIDIA", email:"mvance@nvidia.com", relationship:"Engaged", credentials:["Infrastructure hiring","AI systems","8 shared contacts"], notes:"Interested in distributed systems and cluster operations experience. Follow up after earnings week.", lastContact:"5 days ago" },
  { id:"3", name:"Elena Rostova", role:"Engineering Director", company:"Anthropic", email:"elena.r@anthropic.com", relationship:"Warm", credentials:["Safety infrastructure","Platform strategy","3 shared contacts"], notes:"Met at the SF AI Infrastructure Summit. Discussed safety guardrails and model-training cost controls.", lastContact:"1 week ago" },
  { id:"4", name:"Maya Chen", role:"VP, Platform Engineering", company:"Stripe", email:"maya.chen@stripe.com", relationship:"Engaged", credentials:["Payments platform","Org design","15 shared contacts"], notes:"Warm introduction through Priya. Interested in migration work and engineering operating models.", lastContact:"2 weeks ago" },
  { id:"5", name:"Daniel Okafor", role:"Partner", company:"Lightspeed", email:"daniel@lightspeed.com", relationship:"Warm", credentials:["Enterprise software","Board advisory","6 shared contacts"], notes:"Possible bridge to portfolio CTO roles. Send the short career narrative, not the full resume.", lastContact:"3 weeks ago" },
];

function Avatar({ name }: { name: string }) {
  return <span className="contact-avatar" aria-label={`${name} avatar`}><i /></span>;
}

export default function NetworkPage() {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [selectedId, setSelectedId] = useState("1");
  const [mode, setMode] = useState<Mode>("directory");
  const [query, setQuery] = useState("");
  const [researchQuery, setResearchQuery] = useState("");
  const [researchDone, setResearchDone] = useState(false);
  const [composeMode, setComposeMode] = useState<"ai" | "manual">("ai");
  const [composerOpen, setComposerOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("resumeai-contacts");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Contact[];
      queueMicrotask(() => setContacts(parsed));
    } catch { /* keep seeded contacts */ }
  }, []);

  const selected = contacts.find(contact => contact.id === selectedId) || contacts[0];
  const filtered = useMemo(() => contacts.filter(contact =>
    [contact.name, contact.role, contact.company].some(value => value.toLowerCase().includes(query.toLowerCase()))
  ), [contacts, query]);

  function save(next: Contact[]) {
    setContacts(next);
    localStorage.setItem("resumeai-contacts", JSON.stringify(next));
  }

  function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const contact: Contact = {
      id: Date.now().toString(),
      name: String(data.get("name")),
      role: String(data.get("role")),
      company: String(data.get("company")),
      email: String(data.get("email")),
      relationship: "Warm",
      credentials: ["New connection"],
      notes: String(data.get("notes") || "No notes yet."),
      lastContact: "Just added",
    };
    save([contact, ...contacts]);
    setSelectedId(contact.id);
    setAdding(false);
  }

  const draft = selected ? `Hi ${selected.name.split(" ")[0]},\n\nI appreciated our recent conversation about ${selected.company} and the work happening across ${selected.role.toLowerCase()}. I’ve been looking more closely at where my experience scaling distributed platforms and technical organizations could be useful.\n\nIf it would be helpful, I’d value 15 minutes to compare notes on the team’s priorities and share a concise view of the problems I’ve led through.\n\nBest,\nAlex` : "";

  return (
    <div className="executive-page network-page">
      <header className="page-header">
        <div><span className="page-kicker">RELATIONSHIP INTELLIGENCE</span><h1>Network</h1><p>Map the people, context, and introductions around your highest-priority roles.</p></div>
        <button className="obsidian-button" onClick={()=>setAdding(true)} type="button">Add connection <span>+</span></button>
      </header>

      <div className="mode-switcher" role="tablist" aria-label="Network view">
        <button className={mode==="directory"?"is-active":""} onClick={()=>setMode("directory")} role="tab" aria-selected={mode==="directory"}><span>01</span> Directory</button>
        <button className={mode==="graph"?"is-active":""} onClick={()=>setMode("graph")} role="tab" aria-selected={mode==="graph"}><span>02</span> Relationship Graph</button>
        <button className={mode==="research"?"is-active":""} onClick={()=>setMode("research")} role="tab" aria-selected={mode==="research"}><span>03</span> Hierarchy Research</button>
      </div>

      {mode === "directory" && (
        <section className="network-split">
          <div className="contact-browser">
            <div className="contact-browser__tools"><label><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, title, or company" /></label><small>{filtered.length} CONTACTS</small></div>
            <div className="contact-grid">{filtered.map(contact=><button key={contact.id} type="button" onClick={()=>{setSelectedId(contact.id);setComposerOpen(false)}} className={selected?.id===contact.id?"contact-card is-active":"contact-card"}><span className={`relationship-dot relationship-dot--${contact.relationship.toLowerCase()}`} /><Avatar name={contact.name} /><strong>{contact.name}</strong><p>{contact.role}</p><small>{contact.company}</small></button>)}</div>
          </div>
          {selected && <ContactDetail contact={selected} composerOpen={composerOpen} setComposerOpen={setComposerOpen} composeMode={composeMode} setComposeMode={setComposeMode} draft={draft} />}
        </section>
      )}

      {mode === "graph" && (
        <section className="relationship-map">
          <div className="map-toolbar"><div><span className="page-kicker">LIVE RELATIONSHIP MAP</span><h2>Influence around priority companies</h2></div><div><span><i className="blue"/>Direct</span><span><i className="gold"/>Warm path</span><span><i/>Company</span></div></div>
          <div className="graph-canvas">
            <div className="graph-line line-a" /><div className="graph-line line-b" /><div className="graph-line line-c" /><div className="graph-line line-d" /><div className="graph-line line-e" />
            <button className="graph-node graph-node--self"><Avatar name="Alex Sterling" /><strong>You</strong><small>Alex Sterling</small></button>
            <button className="graph-node node-google"><b>G</b><strong>Google</strong><small>3 connections</small></button>
            <button className="graph-node node-anthropic"><b>A</b><strong>Anthropic</strong><small>2 connections</small></button>
            <button className="graph-node node-stripe"><b>S</b><strong>Stripe</strong><small>4 connections</small></button>
            <button className="graph-person person-sarah" onClick={()=>{setSelectedId("1");setMode("directory")}}><Avatar name="Sarah Jenkins" /><span>Sarah J.</span></button>
            <button className="graph-person person-elena" onClick={()=>{setSelectedId("3");setMode("directory")}}><Avatar name="Elena Rostova" /><span>Elena R.</span></button>
            <button className="graph-person person-maya" onClick={()=>{setSelectedId("4");setMode("directory")}}><Avatar name="Maya Chen" /><span>Maya C.</span></button>
          </div>
        </section>
      )}

      {mode === "research" && (
        <section className="research-layout">
          <div className="research-pane">
            <span className="page-kicker">ORGANIZATION DISCOVERY</span><h2>Find the right path into a company.</h2><p>Enter a person or company to build a working view of leadership, influence, and likely contact paths. Review every result before adding it to your network.</p>
            <form onSubmit={(e)=>{e.preventDefault();setResearchDone(true)}}><label>PERSON OR COMPANY</label><div><input required value={researchQuery} onChange={e=>setResearchQuery(e.target.value)} placeholder="e.g. Anthropic or Jane Smith" /><button className="obsidian-button">Research hierarchy ↗</button></div></form>
            <div className="research-guardrail"><span>⊘</span><p><b>Respectful research only</b>Use public professional information and honor site terms, privacy, and outreach laws.</p></div>
            {researchDone && <div className="research-results"><div className="research-results__head"><span>PROPOSED ORG MAP</span><small>4 PUBLIC SIGNALS</small></div>{[["Dario Amodei","Chief Executive Officer","Executive sponsor"],["Daniela Amodei","President","Operations influence"],["Ben Mann","Co-founder","Technical leadership"],["Mike Krieger","Chief Product Officer","Product organization"]].map(([name,role,signal])=><button key={name} onClick={()=>setResearchQuery(name)}><Avatar name={name}/><span><strong>{name}</strong><p>{role}</p></span><small>{signal} →</small></button>)}</div>}
          </div>
          <aside className="research-detail"><span className="page-kicker">RESEARCH NOTES</span><h3>{researchDone ? researchQuery : "No subject selected"}</h3><p>{researchDone ? "Public signals suggest a founder-led structure with product and research leadership close to the executive team." : "Run a hierarchy search to review roles, reporting signals, and potential paths."}</p>{researchDone && <><div className="credential-list"><span><b>Company</b>Anthropic</span><span><b>Sector</b>AI research & products</span><span><b>Best path</b>Warm technical introduction</span></div><textarea defaultValue="Validate the most relevant leader and identify a credible reason to reach out before adding a contact." aria-label="Research notes"/><button className="ghost-button" onClick={()=>setMode("directory")}>Add selected person</button></>}</aside>
        </section>
      )}

      {adding && <div className="detail-modal" role="dialog" aria-modal="true" aria-label="Add connection"><button className="detail-modal__backdrop" onClick={()=>setAdding(false)} aria-label="Close" /><form className="contact-form" onSubmit={addContact}><button type="button" onClick={()=>setAdding(false)} aria-label="Close">×</button><span className="page-kicker">NEW CONNECTION</span><h2>Add someone to your network</h2><div className="form-grid"><label>Name<input name="name" required /></label><label>Job title<input name="role" required /></label><label>Company<input name="company" required /></label><label>Email<input name="email" type="email" /></label></div><label>Notes<textarea name="notes" rows={4} /></label><button className="obsidian-button" type="submit">Save connection</button></form></div>}
    </div>
  );
}

function ContactDetail({contact,composerOpen,setComposerOpen,composeMode,setComposeMode,draft}:{contact:Contact;composerOpen:boolean;setComposerOpen:(open:boolean)=>void;composeMode:"ai"|"manual";setComposeMode:(mode:"ai"|"manual")=>void;draft:string}) {
  return <aside className="contact-detail"><div className="contact-detail__hero"><Avatar name={contact.name}/><span><small>{contact.relationship.toUpperCase()} RELATIONSHIP</small><h2>{contact.name}</h2><p>{contact.role}</p></span></div><div className="contact-meta"><span><b>COMPANY</b>{contact.company}</span><span><b>EMAIL</b>{contact.email}</span><span><b>LAST CONTACT</b>{contact.lastContact}</span></div><div className="contact-section"><span>CREDENTIALS & SIGNALS</span><div className="credential-chips">{contact.credentials.map(item=><i key={item}>{item}</i>)}</div></div><div className="contact-section"><span>YOUR NOTES</span><textarea defaultValue={contact.notes} aria-label={`Notes for ${contact.name}`} /></div>{composerOpen ? <div className="inline-composer"><div><span>OUTREACH DRAFT</span><button onClick={()=>setComposerOpen(false)}>×</button></div><div className="compose-toggle"><button className={composeMode==="ai"?"is-active":""} onClick={()=>setComposeMode("ai")}>AI-assisted</button><button className={composeMode==="manual"?"is-active":""} onClick={()=>setComposeMode("manual")}>Write myself</button></div><input defaultValue={composeMode==="ai"?`A quick conversation about ${contact.company}`:""} aria-label="Email subject"/><textarea defaultValue={composeMode==="ai"?draft:""} aria-label="Email body"/><div><small>Nothing sends without your approval.</small><button className="obsidian-button">Review & send ↗</button></div></div> : <div className="contact-detail__actions"><button className="obsidian-button" onClick={()=>setComposerOpen(true)}>Send email <span>↗</span></button><button className="ghost-button">Log interaction</button></div>}</aside>;
}
