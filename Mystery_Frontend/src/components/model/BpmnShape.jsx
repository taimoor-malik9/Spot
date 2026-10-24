import { NW, NH } from './bpmnGeometry';

/**
 * Shared BPMN glyph used by both the Model editor and the Simulate canvas.
 */
export function Shape({ type, sel, w, h, stroke, fill, strokeWidth, glow: glowProp }) {
  const str = stroke ?? (sel ? '#0284c7' : '#4b5563');
  const fil = fill ?? (sel ? '#e0f2fe' : '#ffffff');
  const sw = strokeWidth ?? (sel ? 2.5 : 1.8);
  const glow = glowProp ?? (sel
    ? 'drop-shadow(0 0 7px rgba(2,132,199,.5))'
    : 'drop-shadow(0 1px 3px rgba(0,0,0,.13))');

  const bW = 120, bH = 120;

  return (
    <svg viewBox={`0 0 ${bW} ${bH}`} width={w || NW} height={h || NH} preserveAspectRatio="none" style={{ filter: glow, display: 'block' }}>
      {type === 'start-event' && <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />}

      {type === 'message-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="47" y="50" width="26" height="18" rx="1.5" fill="none" stroke={str} strokeWidth={sw} />
        <polyline points="47,52.5 60,60 73,52.5" fill="none" stroke={str} strokeWidth={sw} />
      </>}

      {type === 'timer-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="16" fill="none" stroke={str} strokeWidth={sw} />
        <polyline points="60,49 60,60 68,60" fill="none" stroke={str} strokeWidth={sw} />
        <line x1="60" y1="41" x2="60" y2="44" stroke={str} strokeWidth={sw} />
        <line x1="60" y1="76" x2="60" y2="79" stroke={str} strokeWidth={sw} />
        <line x1="41" y1="60" x2="44" y2="60" stroke={str} strokeWidth={sw} />
        <line x1="76" y1="60" x2="79" y2="60" stroke={str} strokeWidth={sw} />
      </>}

      {type === 'conditional-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="49" y="47" width="22" height="26" rx="1" fill="none" stroke={str} strokeWidth={sw} />
        <line x1="53" y1="53" x2="67" y2="53" stroke={str} strokeWidth={sw - 0.4} />
        <line x1="53" y1="60" x2="67" y2="60" stroke={str} strokeWidth={sw - 0.4} />
        <line x1="53" y1="67" x2="63" y2="67" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'signal-start-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <polygon points="60,45 76,71 44,71" fill="none" stroke={str} strokeWidth={sw} />
      </>}

      {type === 'intermediate-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'message-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <rect x="47" y="50" width="26" height="18" rx="1.5" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <polyline points="47,52.5 60,60 73,52.5" fill="none" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'message-intermediate-throw' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <rect x="47" y="50" width="26" height="18" rx="1.5" fill={str} stroke={str} strokeWidth={sw - 0.4} />
        <polyline points="47,52.5 60,60 73,52.5" fill="none" stroke={fil} strokeWidth={sw - 0.4} />
      </>}

      {type === 'timer-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <circle cx="60" cy="60" r="14" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <polyline points="60,51 60,60 67,60" fill="none" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'conditional-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <rect x="49" y="47" width="22" height="26" rx="1" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <line x1="53" y1="53" x2="67" y2="53" stroke={str} strokeWidth={sw - 0.6} />
        <line x1="53" y1="60" x2="67" y2="60" stroke={str} strokeWidth={sw - 0.6} />
      </>}

      {type === 'signal-intermediate-catch' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <polygon points="60,45 76,71 44,71" fill="none" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'signal-intermediate-throw' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="25" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <polygon points="60,45 76,71 44,71" fill={str} stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 4.5} />
        <circle cx="60" cy="60" r="24" fill="#000000" stroke="none" />
      </>}

      {type === 'message-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 4.5} />
        <rect x="48" y="51" width="24" height="16" rx="1" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <polyline points="48,53.5 60,60 72,53.5" fill="none" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'error-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 4.5} />
        <polygon points="59,44 49,60 59,60 57,75 69,57 59,57" fill="none" stroke={str} strokeWidth={sw - 0.2} />
      </>}

      {type === 'escalation-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 4.5} />
        <polygon points="60,46 72,66 60,59 48,66" fill="none" stroke={str} strokeWidth={sw - 0.2} />
      </>}

      {type === 'signal-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 4.5} />
        <polygon points="60,45 76,71 44,71" fill="none" stroke={str} strokeWidth={sw - 0.2} />
      </>}

      {type === 'terminate-end-event' && <>
        <circle cx="60" cy="60" r="32" fill={fil} stroke={str} strokeWidth={sw + 4.5} />
        <circle cx="60" cy="60" r="15" fill={str} stroke="none" />
      </>}

      {type === 'task' && <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />}

      {type === 'user-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="26" cy="35" r="5" fill="none" stroke={str} strokeWidth="1.5" />
        <path d="M17,47 C17,42 21,42 26,42 C31,42 35,42 35,47" fill="none" stroke={str} strokeWidth="1.5" />
      </>}

      {type === 'service-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="26" cy="36" r="4.5" fill="none" stroke={str} strokeWidth="1.5" />
        <circle cx="26" cy="36" r="7.5" fill="none" stroke={str} strokeWidth="1.5" strokeDasharray="3 2" />
      </>}

      {type === 'script-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="18" y="29" width="14" height="16" rx="1" fill="none" stroke={str} strokeWidth="1.5" />
        <line x1="21" y1="33" x2="29" y2="33" stroke={str} strokeWidth="1" />
        <line x1="21" y1="37" x2="29" y2="37" stroke={str} strokeWidth="1" />
        <line x1="21" y1="41" x2="26" y2="41" stroke={str} strokeWidth="1" />
      </>}

      {type === 'manual-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <path d="M19,45 L19,37 C19,35 20.5,35 20.5,37 L20.5,33 C20.5,31.5 22,31.5 22,33 L22,32 C22,30.5 23.5,30.5 23.5,32 L23.5,33 C23.5,31.5 25,31.5 25,33 L25,45" fill="none" stroke={str} strokeWidth="1.2" />
      </>}

      {type === 'send-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="18" y="32" width="16" height="11" rx="1" fill="none" stroke={str} strokeWidth="1.2" />
        <polyline points="18,34 26,39 34,34" fill="none" stroke={str} strokeWidth="1.2" />
        <path d="M30,29 L36,29 L36,35 M36,29 L28,37" fill="none" stroke={str} strokeWidth="1.2" />
      </>}

      {type === 'receive-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="18" y="32" width="16" height="11" rx="1" fill="none" stroke={str} strokeWidth="1.2" />
        <polyline points="18,34 26,39 34,34" fill="none" stroke={str} strokeWidth={1.2} />
        <path d="M24,29 L18,29 L18,35 M18,29 L26,37" fill="none" stroke={str} strokeWidth="1.2" />
      </>}

      {type === 'business-rule-task' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="18" y="30" width="16" height="14" fill="none" stroke={str} strokeWidth="1.5" />
        <line x1="18" y1="37" x2="34" y2="37" stroke={str} strokeWidth="1" />
        <line x1="25" y1="30" x2="25" y2="44" stroke={str} strokeWidth="1" />
      </>}

      {type === 'subprocess' && <>
        <rect x="10" y="16" width="100" height="84" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        <rect x="50" y="88" width="20" height="13" rx="2" fill={fil} stroke={str} strokeWidth={sw - 0.5} />
        <line x1="60" y1="91" x2="60" y2="98" stroke={str} strokeWidth={1.4} />
        <line x1="57" y1="94.5" x2="63" y2="94.5" stroke={str} strokeWidth={1.4} />
      </>}

      {type === 'call-activity' && <>
        <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw + 1.5} />
      </>}

      {type === 'exclusive-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw} />
        <line x1="44" y1="44" x2="76" y2="76" stroke={str} strokeWidth={sw + 1} />
        <line x1="76" y1="44" x2="44" y2="76" stroke={str} strokeWidth={sw + 1} />
      </>}

      {type === 'parallel-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw} />
        <line x1="60" y1="36" x2="60" y2="84" stroke={str} strokeWidth={sw + 1.2} />
        <line x1="36" y1="60" x2="84" y2="60" stroke={str} strokeWidth={sw + 1.2} />
      </>}

      {type === 'inclusive-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="16" fill="none" stroke={str} strokeWidth={sw + 0.6} />
      </>}

      {type === 'complex-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw} />
        <line x1="60" y1="34" x2="60" y2="86" stroke={str} strokeWidth={sw + 0.8} />
        <line x1="34" y1="60" x2="86" y2="60" stroke={str} strokeWidth={sw + 0.8} />
        <line x1="42" y1="42" x2="78" y2="78" stroke={str} strokeWidth={sw + 0.8} />
        <line x1="78" y1="42" x2="42" y2="78" stroke={str} strokeWidth={sw + 0.8} />
      </>}

      {type === 'event-based-gateway' && <>
        <polygon points="60,8 112,60 60,112 8,60" fill={fil} stroke={str} strokeWidth={sw} />
        <circle cx="60" cy="60" r="18" fill="none" stroke={str} strokeWidth={sw - 0.4} />
        <circle cx="60" cy="60" r="11" fill="none" stroke={str} strokeWidth={sw - 0.4} />
      </>}

      {type === 'data-object' && <>
        <polygon points="22,12 80,12 98,32 98,108 22,108" fill={fil} stroke={str} strokeWidth={sw} />
        <polyline points="80,12 80,32 98,32" fill="none" stroke={str} strokeWidth={sw - 0.5} />
      </>}

      {type === 'data-store' && <>
        <path d="M22,30 C22,18 98,18 98,30 C98,42 22,42 22,30" fill={fil} stroke={str} strokeWidth={sw} />
        <path d="M22,30 L22,90 C22,102 98,102 98,90 L98,30" fill="none" stroke={str} strokeWidth={sw} />
        <path d="M22,50 C22,62 98,62 98,50" fill="none" stroke={str} strokeWidth={sw} />
        <path d="M22,70 C22,82 98,82 98,70" fill="none" stroke={str} strokeWidth={sw} />
      </>}

      {type === 'document' && <>
        <rect x="16" y="10" width="88" height="100" rx="3" fill={fil} stroke={str} strokeWidth={sw} />
        <line x1="30" y1="38" x2="90" y2="38" stroke={str} strokeWidth={1.3} />
        <line x1="30" y1="54" x2="90" y2="54" stroke={str} strokeWidth={1.3} />
        <line x1="30" y1="70" x2="70" y2="70" stroke={str} strokeWidth={1.3} />
        <path d="M16,90 Q36,80 56,90 Q76,100 104,88 L104,110 L16,110 Z" fill={str} opacity="0.07" />
      </>}

      {type === 'annotation' && <>
        <line x1="28" y1="14" x2="12" y2="14" stroke={str} strokeWidth={sw} />
        <line x1="12" y1="14" x2="12" y2="106" stroke={str} strokeWidth={sw} />
        <line x1="12" y1="106" x2="28" y2="106" stroke={str} strokeWidth={sw} />
      </>}

      {type === 'group' && <>
        <rect x="4" y="4" width="112" height="112" rx="8" fill="none" stroke={str} strokeWidth="1.2" strokeDasharray="5 5" />
      </>}

      {type === 'input' && <>
        <rect x="14" y="24" width="92" height="72" rx="4" fill={fil} stroke={str} strokeWidth={sw} />
        <polyline points="52,44 36,60 52,76" fill="none" stroke={str} strokeWidth={sw} />
        <line x1="36" y1="60" x2="84" y2="60" stroke={str} strokeWidth={sw} />
      </>}

      {type === 'output' && <>
        <rect x="14" y="24" width="92" height="72" rx="4" fill={fil} stroke={str} strokeWidth={sw} />
        <polyline points="68,44 84,60 68,76" fill="none" stroke={str} strokeWidth={sw} />
        <line x1="36" y1="60" x2="84" y2="60" stroke={str} strokeWidth={sw} />
      </>}

      {!['start-event', 'message-start-event', 'timer-start-event', 'conditional-start-event', 'signal-start-event',
        'intermediate-event', 'message-intermediate-catch', 'message-intermediate-throw', 'timer-intermediate-catch', 'conditional-intermediate-catch', 'signal-intermediate-catch', 'signal-intermediate-throw',
        'end-event', 'message-end-event', 'error-end-event', 'escalation-end-event', 'signal-end-event', 'terminate-end-event',
        'task', 'user-task', 'service-task', 'script-task', 'manual-task', 'send-task', 'receive-task', 'business-rule-task', 'subprocess', 'call-activity',
        'exclusive-gateway', 'parallel-gateway', 'inclusive-gateway', 'complex-gateway', 'event-based-gateway',
        'data-object', 'data-store', 'document', 'annotation', 'group', 'input', 'output', 'pool', 'lane'].includes(type) && (
          <rect x="10" y="20" width="100" height="80" rx="6" fill={fil} stroke={str} strokeWidth={sw} />
        )}
    </svg>
  );
}
