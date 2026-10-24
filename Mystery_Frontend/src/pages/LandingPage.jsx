import { useEffect } from 'react';
import { Link } from 'react-router-dom'; // swap for your router's Link if different
import './landing.css';

export default function LandingPage() {
  useEffect(() => {
    const prevTitle = document.title;
    const prevScroll = document.documentElement.style.scrollBehavior;
    document.title = 'SPOT – Test your business process before you change it';
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.title = prevTitle;
      document.documentElement.style.scrollBehavior = prevScroll;
    };
  }, []);

  return (
    <div className="sl-root">

<svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
<symbol id="sl-model" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="8.5" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v2h11v-2M12 12v2"/></symbol>
<symbol id="sl-scen" viewBox="0 0 24 24"><path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3"/></symbol>
<symbol id="sl-play" viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></symbol>
<symbol id="sl-chart" viewBox="0 0 24 24"><path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8"/></symbol>
<symbol id="sl-rx" viewBox="0 0 24 24"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></symbol>
<symbol id="sl-heart" viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 10c0 6-8 11-8 11z"/></symbol>
<symbol id="sl-cup" viewBox="0 0 24 24"><path d="M4 8h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5zM17 10h2a2 2 0 010 4h-2M7 3v2M11 3v2"/></symbol>
<symbol id="sl-box" viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/></symbol>
<symbol id="sl-spark" viewBox="0 0 24 24"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></symbol>
<symbol id="sl-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
<symbol id="sl-ok" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></symbol>
<symbol id="sl-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></symbol>
<symbol id="sl-layers" viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/></symbol>
</defs></svg>

<nav><div className="sl-w"><a className="sl-logo" href="#sl-top"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M16 5l9.5 5.5v11L16 27l-9.5-5.5v-11z" opacity=".55"/><circle cx="16" cy="5" r="2.6" fill="#fff"/><circle cx="25.5" cy="10.5" r="2.6" fill="#fff"/><circle cx="25.5" cy="21.5" r="2.6" fill="#fff"/><circle cx="16" cy="27" r="2.6" fill="#fff"/><circle cx="6.5" cy="21.5" r="2.6" fill="#fff"/><circle cx="6.5" cy="10.5" r="2.6" fill="#fff"/></svg>SPOT</a>
<div className="sl-tabs"><a href="#sl-how">How it works</a><a href="#sl-ai">AI assistant</a><a href="#sl-results">Results</a><a href="#sl-cases">Use cases</a><a href="#sl-tech">Technology</a></div>
<div className="sl-navr"><Link className="sl-lo" to="/login">Log in</Link><Link className="sl-btn sl-p sl-sm" to="/signup">Get started</Link></div></div></nav>

<header className="sl-hero" id="sl-top"><div className="sl-w sl-hg"><div>
<span className="sl-badge"><i></i>A digital twin for your business process</span>
<h1>Test your business process before you change it.</h1>
<p className="sl-lead">Draw your process, run it hundreds of times on a digital twin, and see exactly where customers wait and why. No guesswork, no risky experiments on real operations.</p>
<div className="sl-cta"><Link className="sl-btn sl-p" to="/signup">Get started</Link><a className="sl-btn" href="#sl-how">See how it works</a></div>
<div className="sl-pts"><span><svg className="sl-ic"><use href="#sl-ok"/></svg>No BPMN knowledge needed</span><span><svg className="sl-ic"><use href="#sl-ok"/></svg>AI draws your process</span><span><svg className="sl-ic"><use href="#sl-ok"/></svg>Plain-language results</span></div></div>
<div className="sl-shot"><div className="sl-frame"><div className="sl-bar"><i></i><i></i><i></i><em>spot / model</em></div><img src="/landing/model.jpg" alt="SPOT model view showing a pharmacy process with Customer and Pharmacy swimlanes" /></div>
<div className="sl-chip sl-c1"><i></i><span>AI-generated process<small>From one plain-language description</small></span></div>
<div className="sl-chip sl-c2"><i></i><span>Bottleneck found<small>Verify medicine and dosage</small></span></div></div></div></header>

<div className="sl-strip"><div className="sl-w"><span>BPMN 2.0 modelling</span><span>SimPy discrete-event simulation</span><span>Monte Carlo analysis</span><span>Bottleneck detection</span><span>AI process generation</span></div></div>

<section><div className="sl-w"><div className="sl-head"><h2>Changing a process blind is expensive.</h2><p className="sl-sub">Hiring one more person or reordering a step looks sensible on paper, until the queue simply moves somewhere else.</p></div>
<div className="sl-vs"><div className="sl-card sl-no"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-x"/></svg></div><h3>Without SPOT</h3><p>You change the real process, wait weeks, and only then learn whether customers waited less or whether you just moved the bottleneck.</p></div>
<div className="sl-card sl-yes"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-ok"/></svg></div><h3>With SPOT</h3><p>You change a copy. SPOT simulates hundreds of customers through it in seconds and shows the effect on waiting time, workload and cost before anything changes in real life.</p></div></div></div></section>

<section className="sl-alt" id="sl-how"><div className="sl-w"><div className="sl-head"><h2>From idea to answer in four steps.</h2><p className="sl-sub">The workflow follows the tabs in the app, so what you see here is exactly what you use.</p></div>
<div className="sl-grid4"><div className="sl-card sl-step"><b>Step 1</b><div className="sl-tile"><svg className="sl-ic"><use href="#sl-model"/></svg></div><h3>Model</h3><p>Build the process on a BPMN canvas, or let the AI draw it for you.</p></div>
<div className="sl-card sl-step"><b>Step 2</b><div className="sl-tile"><svg className="sl-ic"><use href="#sl-scen"/></svg></div><h3>Scenarios</h3><p>Edit the canvas and SPOT saves a What-If version next to your baseline.</p></div>
<div className="sl-card sl-step"><b>Step 3</b><div className="sl-tile"><svg className="sl-ic"><use href="#sl-play"/></svg></div><h3>Simulate</h3><p>Choose how many customers, how often they arrive, and who is available.</p></div>
<div className="sl-card sl-step"><b>Step 4</b><div className="sl-tile"><svg className="sl-ic"><use href="#sl-chart"/></svg></div><h3>Results</h3><p>Read the story: where people wait, who is overloaded, what to fix first.</p></div></div></div></section>

<section id="sl-ai"><div className="sl-w sl-two"><div><span className="sl-tag">AI assistant</span><h2>Describe it in plain words. Get a diagram.</h2>
<p className="sl-sub" style={{ marginBottom: '24px' }}>Type what happens from the moment a customer arrives until they leave. The guided assistant turns it into a BPMN process you can edit.</p>
<ul className="sl-chk"><li>No BPMN knowledge needed</li><li>Starter ideas for a coffee shop, clinic visit or order delivery</li><li>Edit every step after it is drawn</li></ul></div>
<div className="sl-frame"><div className="sl-bar"><i></i><i></i><i></i><em>spot / model / ai assistant</em></div><img src="/landing/ai-assistant.jpg" alt="SPOT AI Assistant panel asking the user to describe their business process" loading="lazy" /></div></div></section>

<section className="sl-alt"><div className="sl-w sl-two sl-r"><div><span className="sl-tag">What-If scenarios</span><h2>Keep the baseline. Try the alternatives.</h2>
<p className="sl-sub" style={{ marginBottom: '24px' }}>Your original process stays read-only. The moment you edit the canvas, SPOT creates a new scenario, so you can compare options without losing where you started.</p>
<ul className="sl-chk"><li>Baseline is always protected</li><li>Every edit becomes its own scenario</li><li>Run the same simulation on each and compare</li></ul></div>
<div className="sl-frame"><div className="sl-bar"><i></i><i></i><i></i><em>spot / scenarios</em></div><img src="/landing/scenarios.jpg" alt="SPOT Scenarios tab showing a read-only baseline process" loading="lazy" /></div></div></section>

<section><div className="sl-w sl-two"><div><span className="sl-tag">Simulation</span><h2>Set the scene, then press run.</h2>
<p className="sl-sub" style={{ marginBottom: '24px' }}>Pick how many cases to run, how often customers arrive, and how many pharmacists, technicians or counters you have. Click any task to set its duration and resources.</p>
<ul className="sl-chk"><li>Quick mode for fast checks, Detailed mode for accuracy</li><li>Presets from quiet to busy periods</li><li>Hundreds of runs analysed with Monte Carlo methods</li></ul></div>
<div className="sl-frame"><div className="sl-bar"><i></i><i></i><i></i><em>spot / simulate</em></div><img src="/landing/simulate-setup.jpg" alt="SPOT simulation setup with total cases, arrival frequency and resources" loading="lazy" /></div></div></section>

<section className="sl-alt" id="sl-results"><div className="sl-w sl-two sl-r"><div><span className="sl-tag">Results</span><h2>Answers a manager can read.</h2>
<p className="sl-sub" style={{ marginBottom: '24px' }}>Results arrive as plain-language findings first, with the numbers behind them: how long customers spend, which step holds everyone up, and who is busiest.</p>
<ul className="sl-chk"><li>A short story of what happened</li><li>Bottlenecks highlighted, not buried in tables</li><li>Resource workload at a glance</li></ul></div>
<div><div className="sl-frame"><div className="sl-bar"><i></i><i></i><i></i><em>spot / results</em></div><div className="sl-rs">
<div className="sl-kpis"><div className="sl-kpi"><small>Average time in store</small><strong>14 min</strong></div><div className="sl-kpi"><small>Longest wait</small><strong>9 min</strong></div><div className="sl-kpi"><small>Customers served</small><strong>500</strong></div></div>
<div className="sl-bars"><h4>How busy each step is</h4><div className="sl-bar2 sl-hot"><div>Verify medicine</div><span style={{ '--w': '88%' }}></span><div>88%</div></div><div className="sl-bar2"><div>Count and pack</div><span style={{ '--w': '52%' }}></span><div>52%</div></div><div className="sl-bar2"><div>Generate bill</div><span style={{ '--w': '31%' }}></span><div>31%</div></div></div>
<div className="sl-story"><strong>Key takeaway:</strong> Most waiting happens at medicine verification. A second pharmacist would help more than speeding up packing.</div></div></div>
<p className="sl-note">Illustrative example</p></div></div></section>

<section id="sl-cases"><div className="sl-w"><div className="sl-head"><h2>Built for any step-by-step service.</h2><p className="sl-sub">If customers queue and staff are shared, SPOT can model it.</p></div>
<div className="sl-grid4"><div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-rx"/></svg></div><h3>Pharmacy</h3><p>Prescription checks, packing and billing.</p></div><div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-heart"/></svg></div><h3>Clinic</h3><p>Reception, triage and consultation flow.</p></div><div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-cup"/></svg></div><h3>Coffee shop</h3><p>Order, prepare and serve at rush hour.</p></div><div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-box"/></svg></div><h3>Order delivery</h3><p>Pick, pack and dispatch capacity.</p></div></div></div></section>

<section className="sl-alt" id="sl-tech"><div className="sl-w"><div className="sl-head"><h2>Built on proven methods.</h2><p className="sl-sub">Industry-standard modelling and simulation under a simple interface.</p></div>
<div className="sl-grid3"><div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-model"/></svg></div><h3>BPMN 2.0</h3><p>The standard notation for business processes, with swimlanes, gateways and message flows.</p></div>
<div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-gear"/></svg></div><h3>SimPy simulation</h3><p>Discrete-event simulation of every customer, task and shared resource.</p></div>
<div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-chart"/></svg></div><h3>Monte Carlo analysis</h3><p>Many randomised runs, so results reflect real variation rather than one lucky day.</p></div>
<div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-spark"/></svg></div><h3>AI generation</h3><p>Plain-language descriptions become editable process diagrams.</p></div>
<div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-play"/></svg></div><h3>Bottleneck detection</h3><p>Steps are scored by waiting time, so the biggest delay is always named first.</p></div>
<div className="sl-card"><div className="sl-tile"><svg className="sl-ic"><use href="#sl-layers"/></svg></div><h3>Modern architecture</h3><p>React frontend, Node.js backend and a FastAPI simulation service.</p></div></div></div></section>

<section id="sl-faq"><div className="sl-w"><div className="sl-head"><h2>Questions, answered.</h2><p className="sl-sub">The essentials before you start.</p></div><div className="sl-faq">
<details><summary>Do I need to know BPMN?</summary><p>No. Describe your process in plain words and the AI assistant draws it for you. You can then edit every step on the canvas.</p></details>
<details><summary>What does a simulation tell me?</summary><p>It shows how long customers spend in your process, where they wait, how busy each resource is, and which step is the main bottleneck.</p></details>
<details><summary>Can I test changes without losing my original process?</summary><p>Yes. Your baseline stays read-only. Any edit creates a separate What-If scenario that you can simulate and compare.</p></details>
<details><summary>How reliable are the results?</summary><p>Results reflect the durations, arrival rates and resources you enter. SPOT runs many randomised simulations, so the numbers account for natural variation rather than a single run.</p></details>
<details><summary>What kinds of processes can I model?</summary><p>Any step-by-step process where people or orders move through tasks and share resources, such as a pharmacy, clinic, coffee shop or delivery operation.</p></details>
</div></div></section>

<section id="sl-start" style={{ paddingTop: '40px' }}><div className="sl-w"><div className="sl-cta-card"><h2>See where your process breaks. Then fix it.</h2><p>Create your first model in minutes and run your first simulation today.</p><div className="sl-cta" style={{ justifyContent: 'center' }}><Link className="sl-btn" to="/signup">Create account</Link><Link className="sl-btn sl-o" to="/login">Log in</Link></div></div></div></section>

<footer><div className="sl-w"><div className="sl-fg"><div><a className="sl-logo" href="#sl-top" style={{ fontSize: '19px', marginBottom: '14px', color: 'var(--ink)' }}>SPOT</a><p style={{ margin: '0', maxWidth: '36ch' }}>Simulation Platform for Optimization using Digital Twin. Test process changes on a model, not on your customers.</p></div>
<div><h5>Product</h5><a href="#sl-how">How it works</a><a href="#sl-ai">AI assistant</a><a href="#sl-results">Results</a><a href="#sl-cases">Use cases</a></div>
<div><h5>Company</h5><a href="#sl-tech">Technology</a><a href="#sl-faq">FAQ</a><Link to="/login">Log in</Link></div></div>
<div className="sl-copy">© 2026 SPOT. All rights reserved.</div></div></footer>

    </div>
  );
}
