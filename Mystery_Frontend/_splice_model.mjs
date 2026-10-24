import fs from 'fs';
const p = 'E:/SPOT/Mystery_Frontend/src/pages/model.jsx';
let s = fs.readFileSync(p, 'utf8');

s = s.replace(
  "import AiPanel from './AiPanel';\n",
  "import AiPanel from './AiPanel';\nimport { NW, NH, elCenter, bestPorts, isXorGateway, outlineAnchor } from '../components/model/bpmnGeometry';\nimport { Shape } from '../components/model/BpmnShape';\nimport { DiagramEdge as Edge, tempConnectionLine } from '../components/model/DiagramEdge';\n"
);

s = s.replace(
  'const NW = 80, NH = 80, GRID = 8;\nconst MIN_ZOOM = 0.15, MAX_ZOOM = 3;\nconst POOL_LANE_HDR = 30;\nconst LANE_HDR = 30;\n',
  'const GRID = 8;\nconst MIN_ZOOM = 0.15, MAX_ZOOM = 3;\nconst POOL_LANE_HDR = 30;\nconst LANE_HDR = 30;\n'
);

const startXor = s.indexOf('function isXorGateway(type)');
const endXor = s.indexOf('function poolLanes');
if (startXor < 0 || endXor < 0) throw new Error('xor markers missing');
s = s.slice(0, startXor) + s.slice(endXor);

const geoStart = s.indexOf('// ─── Geometry (shared with Simulate so both canvases match)');
const ctxStart = s.indexOf('// ─── Context pad');
if (geoStart < 0 || ctxStart < 0) throw new Error('geo markers missing ' + geoStart + ' ' + ctxStart);
s = s.slice(0, geoStart) + 'export { Shape, elCenter, bestPorts };\n\n' + s.slice(ctxStart);

const edgeStart = s.indexOf('// ─── Edge');
const gwStart = s.indexOf('// ─── Gateway "How Often" Popover');
if (edgeStart < 0 || gwStart < 0) throw new Error('edge markers missing ' + edgeStart + ' ' + gwStart);
s = s.slice(0, edgeStart) + s.slice(gwStart);

fs.writeFileSync(p, s);
console.log('ok', s.length);
