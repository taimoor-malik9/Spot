import { useId } from "react";

const CSS = `
.spot-showcase{box-sizing:border-box;width:100%;min-height:100%;display:flex;flex-direction:column;justify-content:center;gap:clamp(28px,5vh,56px);padding:clamp(32px,5vw,72px);background:linear-gradient(145deg,#6A4DF1 0%,#4B33CF 48%,#3A25A3 100%);color:#fff;font-family:inherit}
.spot-showcase h2{margin:0;font-size:clamp(30px,3.2vw,44px);line-height:1.12;font-weight:800;letter-spacing:-.02em}
.spot-showcase svg{display:block;width:100%;max-width:720px;height:auto;overflow:visible}
.spot-showcase svg text{font-family:inherit}
.spot-showcase .ss-feats{display:flex;flex-wrap:wrap;gap:14px 44px;max-width:720px}
.spot-showcase .ss-feat{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700}
@keyframes ssDraw{to{stroke-dashoffset:0}}
@keyframes ssFade{from{opacity:0}to{opacity:1}}
.spot-showcase .ss-line{stroke-dasharray:1;stroke-dashoffset:1;animation:ssDraw 1.8s .2s cubic-bezier(.4,0,.2,1) forwards}
.spot-showcase .ss-pt{opacity:0;animation:ssFade .6s ease forwards}
.spot-showcase .ss-d1{animation-delay:.2s}
.spot-showcase .ss-d2{animation-delay:.9s}
.spot-showcase .ss-d3{animation-delay:1.7s}
@media (prefers-reduced-motion:reduce){
  .spot-showcase .ss-line{animation:none;stroke-dashoffset:0}
  .spot-showcase .ss-pt{animation:none;opacity:1}
}`;

const LINE = "M0 298 C100 298 200 236 320 202 C440 168 540 108 640 65";
const AREA = `${LINE} L640 370 L0 370 Z`;

const STEPS = [
  { n: "01", t: "Model", x: 0, y: 298, anchor: "start", lift: 0 },
  { n: "02", t: "Simulate", x: 320, y: 202, anchor: "middle", lift: 0 },
  { n: "03", t: "Improve", x: 640, y: 65, anchor: "end", lift: 8 },
];

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export default function AuthShowcase({ headline = "Model it. Simulate it. Improve it." }) {
  const uid = useId().replace(/:/g, "");
  const fillId = `ss-fill-${uid}`;

  return (
    <div className="spot-showcase">
      <style>{CSS}</style>
      <h2>{headline}</h2>

      <svg viewBox="-24 0 688 384" fill="none" role="img" aria-label="Growth path: Model, Simulate, Improve">
        <defs>
          <linearGradient id={fillId} x1="0" y1="65" x2="0" y2="370" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[95, 145, 195, 245, 295].map((y) => (
          <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
        ))}
        <line x1="0" x2="640" y1="370" y2="370" stroke="rgba(255,255,255,0.22)" />

        <path className="ss-pt ss-d2" d={AREA} fill={`url(#${fillId})`} />
        <path className="ss-line" pathLength="1" d={LINE} stroke="#fff" strokeWidth="2" strokeLinecap="round" />

        {STEPS.map((s, i) => (
          <g key={s.n} className={`ss-pt ss-d${i + 1}`}>
            <text x={s.x} y={s.y - 38 - s.lift} textAnchor={s.anchor} fontSize="12" fontWeight="600" letterSpacing="2" fill="rgba(255,255,255,0.7)">{s.n}</text>
            <text x={s.x} y={s.y - 20 - s.lift} textAnchor={s.anchor} fontSize="18" fontWeight="700" fill="#fff">{s.t}</text>
            {i === 2 ? (
              <>
                <circle cx={s.x} cy={s.y} r="18" fill="rgba(255,255,255,0.28)" />
                <circle cx={s.x} cy={s.y} r="10" fill="#fff" />
              </>
            ) : (
              <circle cx={s.x} cy={s.y} r="8" fill="#4C34D0" stroke="#fff" strokeWidth="2" />
            )}
          </g>
        ))}
      </svg>

      <div className="ss-feats">
        <span className="ss-feat">
          <svg {...icon}><path d="M12 3l9 9-9 9-9-9z" /></svg>Draw BPMN
        </span>
        <span className="ss-feat">
          <svg {...icon}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M6 8.5v3a4 4 0 0 0 4 4h5.5" /></svg>Compare scenarios
        </span>
        <span className="ss-feat">
          <svg {...icon}><path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" /></svg>Ask AI
        </span>
      </div>
    </div>
  );
}
