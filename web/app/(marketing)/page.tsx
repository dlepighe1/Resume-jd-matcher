import Link from "next/link";

function Mark() {
  return <span className="marketing-mark"><span>R</span> ResumeAI</span>;
}

export default function MarketingHome() {
  return (
    <div className="marketing-shell">
      <header className="marketing-nav">
        <Link href="/" aria-label="ResumeAI home"><Mark /></Link>
        <nav aria-label="Primary navigation">
          <a href="#platform">Platform</a>
          <a href="#precision">Precision engine</a>
          <a href="#network">Network</a>
          <a href="#security">Security</a>
        </nav>
        <div className="marketing-nav__actions">
          <Link href="/sign-in" className="text-link">Sign in</Link>
          <Link href="/sign-up" className="button button--light">Get started</Link>
        </div>
      </header>

      <main>
        <section className="hero-section" id="platform">
          <div className="eyebrow"><i /> Private career intelligence</div>
          <h1>Turn your experience into a <em>decisive advantage.</em></h1>
          <p>ResumeAI aligns your resume to the role, organizes every application, maps the people who matter, and helps you make the right outreach at the right moment.</p>
          <div className="hero-actions">
            <Link href="/matcher" className="button button--primary">Start a match <span>↗</span></Link>
            <a href="#precision" className="button button--ghost">Explore the platform</a>
          </div>
          <div className="trust-row"><span>Encrypted documents</span><span>Evidence-backed scoring</span><span>User-controlled outreach</span></div>

          <div className="product-window" aria-label="ResumeAI dashboard preview">
            <div className="product-window__rail">
              <Mark />
              <div className="mini-profile"><i /><span><b>Alex Sterling</b><small>ELITE MEMBER</small></span></div>
              {["Overview", "Applications", "Resumes", "Network", "Outreach"].map((item, index) => (
                <div key={item} className={index === 0 ? "mini-nav active" : "mini-nav"}><i />{item}</div>
              ))}
            </div>
            <div className="product-window__main">
              <div className="preview-heading"><span><small>CAREER COMMAND CENTER</small><b>Executive Overview</b></span><i>Start Matcher ↗</i></div>
              <div className="preview-grid">
                <div className="preview-chart">
                  <small>JOB HUNT VELOCITY</small><strong>Momentum, made visible.</strong>
                  <div className="chart-bars">{[32,45,39,58,68,62,78,88].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div>
                  <div className="chart-labels"><span>W1</span><span>W4</span><span>W8</span></div>
                </div>
                <div className="preview-score"><small>MATCH CONFIDENCE</small><div className="score-ring"><span>92<b>%</b></span></div><strong>Strong alignment</strong><p>12 priority roles surfaced</p></div>
                <div className="preview-activity"><small>RECENT INTELLIGENCE</small><div><i />Interview confirmed <b>Google</b></div><div><i />New response <b>NVIDIA</b></div><div><i />Contact engaged <b>Anthropic</b></div></div>
                <div className="preview-target"><small>PRIORITY TARGET</small><span className="match-chip">98.4% MATCH</span><h3>Director, Platform Strategy</h3><p>Databricks · New York / Hybrid</p><button>Review opportunity</button></div>
              </div>
            </div>
          </div>
        </section>

        <section className="precision-section" id="precision">
          <div className="section-copy">
            <div className="eyebrow"><i /> Precision before volume</div>
            <h2>Know where you stand before you apply.</h2>
            <p>Compare the language, evidence, and seniority signals in your resume against the actual role. The result is a clear score and a practical plan—not vague encouragement.</p>
            <div className="proof-list">
              <div><span>01</span><p><b>Requirement coverage</b>See what your resume proves, implies, and misses.</p></div>
              <div><span>02</span><p><b>Evidence quality</b>Separate credible achievements from unsupported claims.</p></div>
              <div><span>03</span><p><b>Actionable rewrite</b>Prioritize the changes most likely to improve alignment.</p></div>
            </div>
          </div>
          <div className="analysis-card">
            <div className="analysis-card__top"><span>ROLE ALIGNMENT</span><small>ANALYSIS COMPLETE</small></div>
            <div className="analysis-score"><div className="score-ring score-ring--large"><span>92</span></div><div><small>PRECISION SCORE</small><strong>Strong candidate</strong><p>Your experience is well aligned. Strengthen two leadership signals before submitting.</p></div></div>
            <div className="analysis-bars"><p><span>Core requirements</span><b>96%</b><i><u style={{width:"96%"}} /></i></p><p><span>Leadership scope</span><b>84%</b><i><u style={{width:"84%"}} /></i></p><p><span>Domain evidence</span><b>91%</b><i><u style={{width:"91%"}} /></i></p></div>
          </div>
        </section>

        <section className="platform-section" id="network">
          <div className="section-heading"><div><div className="eyebrow"><i /> One connected system</div><h2>Your search, orchestrated.</h2></div><p>Move from fit to application to relationship-building without losing context.</p></div>
          <div className="feature-grid">
            <article><span>01 / MATCH</span><h3>Precision Matcher</h3><p>Measure alignment and close the most important evidence gaps before you submit.</p><b>Analyze a role ↗</b></article>
            <article><span>02 / TRACK</span><h3>Application Intelligence</h3><p>Keep every target, stage, resume version, and follow-up in one decisive view.</p><b>See your pipeline ↗</b></article>
            <article><span>03 / CONNECT</span><h3>Relationship Mapping</h3><p>Understand who is connected, where influence sits, and which introduction is warmest.</p><b>Map your network ↗</b></article>
            <article><span>04 / OUTREACH</span><h3>Thoughtful Outreach</h3><p>Draft specific, human emails with AI assistance while you retain the final word.</p><b>Compose with context ↗</b></article>
          </div>
        </section>

        <section className="security-section" id="security">
          <div><div className="eyebrow"><i /> Designed for discretion</div><h2>Your career move stays yours.</h2><p>Documents are handled privately, public sharing is always explicit, and outreach remains under your control.</p></div>
          <div className="security-grid"><article><span>◈</span><b>Private by default</b><p>Analyses remain private unless you create a read-only link.</p></article><article><span>⌁</span><b>Clear provenance</b><p>Know which engine produced a score and what evidence supports it.</p></article><article><span>⊘</span><b>No auto-send</b><p>Every email is reviewed and approved by you before it leaves.</p></article></div>
        </section>

        <section className="final-cta">
          <div><small>YOUR NEXT MOVE, WITH CLARITY</small><h2>Build the search that gets you <em>noticed.</em></h2></div>
          <Link href="/matcher" className="button button--primary">Start Matcher <span>↗</span></Link>
        </section>
      </main>

      <footer className="marketing-footer"><Mark /><p>© {new Date().getFullYear()} ResumeAI. Career intelligence, engineered with discretion.</p><nav><span>Privacy</span><span>Security</span><span>Terms</span></nav></footer>
    </div>
  );
}
