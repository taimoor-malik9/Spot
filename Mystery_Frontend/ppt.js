const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "SPOT - FYP Mid Presentation";

// ── Palette ──────────────────────────────────────────────────
const C = {
  navy:    "0D1B2A",   // deep navy bg (title / section slides)
  teal:    "0B6E6E",   // primary accent
  tealLt:  "14A8A8",   // lighter teal
  mint:    "7FCDCD",   // soft mint for chips/tags
  white:   "FFFFFF",
  offWht:  "F0F4F8",   // content slide bg
  gray:    "64748B",   // muted text
  grayLt:  "CBD5E1",   // borders
  darkTxt: "0D1B2A",
  orange:  "F97316",   // warning / highlight accent
};

// ── Helpers ───────────────────────────────────────────────────
const makeShadow = () => ({
  type: "outer", blur: 8, offset: 3, angle: 135, color: "000000", opacity: 0.10
});

function darkSlide(slide) {
  slide.background = { color: C.navy };
}
function lightSlide(slide) {
  slide.background = { color: C.offWht };
}

// Pill / tag chip
function addChip(slide, text, x, y, w = 1.8, bg = C.teal, fg = C.white) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h: 0.28, fill: { color: bg }, line: { color: bg }, rectRadius: 0.14,
  });
  slide.addText(text, {
    x, y, w, h: 0.28, fontSize: 9, bold: true, color: fg,
    align: "center", valign: "middle", margin: 0,
  });
}

// Section divider (dark slide with centered text)
function sectionSlide(title, subtitle) {
  const s = pres.addSlide();
  darkSlide(s);
  // teal accent bar left
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 5.625, fill: { color: C.teal }, line: { color: C.teal },
  });
  s.addText(title, {
    x: 0.4, y: 1.8, w: 9.2, h: 1.0,
    fontSize: 40, bold: true, color: C.white, align: "left",
  });
  if (subtitle) {
    s.addText(subtitle, {
      x: 0.4, y: 2.9, w: 9.2, h: 0.6,
      fontSize: 18, color: C.mint, align: "left",
    });
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════
// SLIDE 1 — TITLE
// ═══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  darkSlide(s);

  // teal left bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 5.625, fill: { color: C.teal }, line: { color: C.teal },
  });

  // SPOT big logo-style text
  s.addText("SPOT", {
    x: 0.4, y: 0.5, w: 9, h: 1.3,
    fontSize: 72, bold: true, color: C.teal, align: "left", charSpacing: 8,
  });

  s.addText("Simulation Platform for Optimization using Digital Twin", {
    x: 0.4, y: 1.75, w: 8.5, h: 0.7,
    fontSize: 20, color: C.white, align: "left", italic: true,
  });

  // divider line
  s.addShape(pres.shapes.LINE, {
    x: 0.4, y: 2.55, w: 9.2, h: 0, line: { color: C.teal, width: 1.5 },
  });

  // team block
  s.addText([
    { text: "Zahra Iftikhar (BSE231025)   |   Rabia Tahir (BSE231032)   |   Muhammad Taimoor Malik (BSE231069)", options: { breakLine: true } },
    { text: "Supervised by: Dr. Nadeem Anjum", options: { breakLine: true } },
    { text: "Spring 2026  •  BS Software Engineering  •  CUST, Islamabad" },
  ], {
    x: 0.4, y: 2.75, w: 9.2, h: 1.1,
    fontSize: 13, color: C.mint, align: "left",
  });

  // MID EVALUATION chip
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.4, y: 4.5, w: 2.2, h: 0.38,
    fill: { color: C.teal }, line: { color: C.teal }, rectRadius: 0.19,
  });
  s.addText("MID EVALUATION", {
    x: 0.4, y: 4.5, w: 2.2, h: 0.38,
    fontSize: 11, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
  });
}

// ═══════════════════════════════════════════════════════════════
// SLIDE 2 — AGENDA / TABLE OF CONTENTS
// ═══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("Agenda", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 32, bold: true, color: C.darkTxt,
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 0.95, w: 9, h: 0.04,
    fill: { color: C.grayLt }, line: { color: C.grayLt },
  });

  const items = [
    ["01", "Introduction & Problem Statement"],
    ["02", "All Epics Overview"],
    ["03", "E1 — Manual Process Builder"],
    ["04", "E3 — Resource Configuration & Simulation Setup"],
    ["05", "E4 — Simulation Engine"],
    ["06", "Q&A"],
  ];

  items.forEach(([num, label], i) => {
    const row = i % 3;
    const col = i < 3 ? 0 : 1;
    const x = col === 0 ? 0.5 : 5.2;
    const y = 1.15 + row * 1.2;

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: 4.3, h: 0.95,
      fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(), rectRadius: 0.08,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.55, h: 0.95,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(num, {
      x, y, w: 0.55, h: 0.95,
      fontSize: 18, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
    });
    s.addText(label, {
      x: x + 0.65, y: y + 0.05, w: 3.55, h: 0.85,
      fontSize: 13, color: C.darkTxt, valign: "middle",
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SLIDE 3 — INTRODUCTION / PROBLEM STATEMENT
// ═══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("Introduction", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 32, bold: true, color: C.darkTxt,
  });

  // left column — problem
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.05, w: 4.2, h: 3.9,
    fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
    shadow: makeShadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.05, w: 4.2, h: 0.42,
    fill: { color: C.teal }, line: { color: C.teal },
  });
  s.addText("The Problem", {
    x: 0.5, y: 1.05, w: 4.2, h: 0.42,
    fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
  });
  s.addText([
    { text: "SMB owners rely on gut-feeling, spreadsheets, and whiteboards to manage operations.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "Simple tools (e.g. Visio) let you draw but not test.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "Complex tools (Arena, AnyLogic) require specialist training and high budgets.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "The gap between the two extremes is where most business owners find themselves stuck." },
  ], {
    x: 0.65, y: 1.6, w: 3.9, h: 3.2,
    fontSize: 12.5, color: C.darkTxt, valign: "top",
  });

  // right column — solution
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 1.05, w: 4.4, h: 3.9,
    fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
    shadow: makeShadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.1, y: 1.05, w: 4.4, h: 0.42,
    fill: { color: C.tealLt }, line: { color: C.tealLt },
  });
  s.addText("SPOT — The Solution", {
    x: 5.1, y: 1.05, w: 4.4, h: 0.42,
    fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
  });
  s.addText([
    { text: "Web-based BPM and simulation platform for non-technical business owners.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "Drag-and-drop BPMN canvas or plain-English AI-generated process model.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "DES + Monte Carlo simulation with visual results.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "AI-generated suggestions identifying bottlenecks and improvement areas.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "What-if scenario module to compare configurations before real-world change." },
  ], {
    x: 5.25, y: 1.6, w: 4.1, h: 3.2,
    fontSize: 12.5, color: C.darkTxt, valign: "top",
  });
}

// ═══════════════════════════════════════════════════════════════
// SLIDE 4 — TECH STACK
// ═══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("Technology Stack", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 32, bold: true, color: C.darkTxt,
  });

  const cols = [
    { label: "Frontend", items: ["Next.js / React", "ReactFlow (BPMN Canvas)", "Tailwind CSS"], color: C.teal },
    { label: "Backend", items: ["Node.js + Express", "MongoDB", "REST APIs"], color: C.tealLt },
    { label: "Simulation Engine", items: ["Python + SimPy", "FastAPI Microservice", "Monte Carlo / DES"], color: C.orange },
    { label: "AI / LLM", items: ["Claude API (Primary)", "Prompt Engineering", "AI Optimization Layer"], color: "6366F1" },
  ];

  cols.forEach(({ label, items, color }, i) => {
    const x = 0.5 + i * 2.3;
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.1, w: 2.15, h: 3.8,
      fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.1, w: 2.15, h: 0.44,
      fill: { color: color }, line: { color: color },
    });
    s.addText(label, {
      x, y: 1.1, w: 2.15, h: 0.44,
      fontSize: 12, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
    });
    items.forEach((item, j) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: x + 0.12, y: 1.72 + j * 0.82, w: 1.91, h: 0.62,
        fill: { color: C.offWht }, line: { color: C.grayLt, width: 1 }, rectRadius: 0.06,
      });
      s.addText(item, {
        x: x + 0.12, y: 1.72 + j * 0.82, w: 1.91, h: 0.62,
        fontSize: 11, color: C.darkTxt, align: "center", valign: "middle", margin: 4,
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SLIDE 5 — ALL EPICS OVERVIEW
// ═══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("Epics Overview", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 32, bold: true, color: C.darkTxt,
  });

  const epics = [
    { id: "E1", title: "Manual Process Builder", desc: "Drag-and-drop BPMN canvas" },
    { id: "E2", title: "AI Process Generation", desc: "Natural language → BPMN" },
    { id: "E3", title: "Resource Config & Sim Setup", desc: "Resources, durations, arrival" },
    { id: "E4", title: "Simulation Engine", desc: "DES + Monte Carlo execution" },
    { id: "E5", title: "Simulation Results", desc: "Metrics, charts, reports, export" },
    { id: "E6", title: "AI Optimization Feedback", desc: "Bottleneck & improvement AI" },
    { id: "E7", title: "What-If Scenario Analysis", desc: "Baseline + scenario comparison" },
    { id: "E8", title: "User Authentication", desc: "Register, login, password reset" },
    { id: "E9", title: "Process Dashboard", desc: "Central project management hub" },
    { id: "E10", title: "Simulation History", desc: "Audit log & result replay" },
    { id: "E11", title: "User Profile & Account", desc: "Profile, password, email, delete" },
    { id: "E12", title: "Notifications & Alerts", desc: "In-app error/warning alerts" },
  ];

  // 3 cols × 4 rows
  epics.forEach(({ id, title, desc }, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * 3.15;
    const y = 1.05 + row * 1.1;
    const highlighted = ["E1","E3","E4"].includes(id);
    const cardColor = highlighted ? C.teal : C.white;
    const textColor = highlighted ? C.white : C.darkTxt;
    const descColor = highlighted ? C.mint : C.gray;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 2.95, h: 0.9,
      fill: { color: cardColor }, line: { color: highlighted ? C.teal : C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addText(id, {
      x: x + 0.1, y: y + 0.06, w: 0.5, h: 0.34,
      fontSize: 11, bold: true, color: highlighted ? C.mint : C.teal,
    });
    s.addText(title, {
      x: x + 0.6, y: y + 0.06, w: 2.25, h: 0.34,
      fontSize: 11, bold: true, color: textColor,
    });
    s.addText(desc, {
      x: x + 0.1, y: y + 0.44, w: 2.75, h: 0.32,
      fontSize: 10, color: descColor, italic: true,
    });
  });

  // legend
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.15, w: 0.18, h: 0.18,
    fill: { color: C.teal }, line: { color: C.teal },
  });
  s.addText("Covered in this presentation", {
    x: 0.75, y: 5.12, w: 3, h: 0.22,
    fontSize: 10, color: C.gray, italic: true,
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION — E1
// ═══════════════════════════════════════════════════════════════
sectionSlide("Epic 1", "Manual Process Builder");

// SLIDE — E1 User Stories
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E1 — Manual Process Builder", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });
  addChip(s, "5 User Stories", 0.5, 0.92, 1.6);

  const stories = [
    { id: "E1-US1", title: "Drag-and-Drop Workspace", desc: "Drag BPMN shapes (tasks, events, gateways) onto a blank canvas and place them exactly where needed." },
    { id: "E1-US2", title: "Connecting Process Steps", desc: "Draw sequence flow arrows between shapes to visualise the direction of work from one step to the next." },
    { id: "E1-US3", title: "Canvas Controls", desc: "Zoom in/out, undo, redo, and toggle the grid to work comfortably and correct mistakes without losing progress." },
    { id: "E1-US4", title: "Process Model Management", desc: "Upload, save, export, and download process models so work can be shared, preserved, and reopened later." },
    { id: "E1-US5", title: "Delete Shapes & Connections", desc: "Remove individual shapes or connections (along with their associated flows) without affecting the rest of the diagram." },
  ];

  stories.forEach(({ id, title, desc }, i) => {
    const col = i < 3 ? 0 : 1;
    const row = i < 3 ? i : i - 3;
    const x = col === 0 ? 0.5 : 5.15;
    const y = 1.35 + row * 1.35;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 4.35, h: 1.2,
      fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h: 1.2,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(id, {
      x: x + 0.14, y: y + 0.1, w: 1.0, h: 0.28,
      fontSize: 9, bold: true, color: C.teal,
    });
    s.addText(title, {
      x: x + 0.14, y: y + 0.3, w: 4.1, h: 0.3,
      fontSize: 13, bold: true, color: C.darkTxt,
    });
    s.addText(desc, {
      x: x + 0.14, y: y + 0.62, w: 4.1, h: 0.52,
      fontSize: 11, color: C.gray,
    });
  });
}

// SLIDE — E1 Acceptance Criteria
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E1 — Acceptance Criteria", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const criteria = [
    { us: "US1", items: ["Shape dragged and dropped stays at exact position and can be renamed immediately."] },
    { us: "US2", items: ["Connection between two shapes creates a sequence flow arrow showing direction."] },
    { us: "US3", items: ["Zoom in/out does not affect shapes. Undo reverses last action. Redo reapplies it. Grid toggles without affecting diagram."] },
    { us: "US4", items: ["Save preserves current state. Upload restores exact saved model. Download generates file. Export produces shareable format."] },
    { us: "US5", items: ["Deleting a shape also removes all connected sequence flows. Deleting a connection removes only that connection. No other elements affected."] },
  ];

  criteria.forEach(({ us, items }, i) => {
    const y = 1.0 + i * 0.88;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.78,
      fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addText(`E1-${us}`, {
      x: 0.55, y: y + 0.08, w: 0.75, h: 0.25,
      fontSize: 10, bold: true, color: C.teal,
    });
    s.addText(items.join("  •  "), {
      x: 1.3, y: y + 0.06, w: 7.95, h: 0.65,
      fontSize: 11.5, color: C.darkTxt, valign: "middle",
    });
  });
}

// SLIDE — E1 Test Cases
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E1 — Test Cases", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const headers = [
    [{ text: "Test ID", options: { bold: true, color: C.white } }, { text: "Description", options: { bold: true, color: C.white } }, { text: "Input", options: { bold: true, color: C.white } }, { text: "Expected Result", options: { bold: true, color: C.white } }]
  ];
  const rows = [
    ["E1-US1-TC1", "Element dropped outside canvas bounds", "Shape dragged and released outside visible canvas area", "Placement rejected. No shape added. No crash."],
    ["E1-US2-TC1", "Self-loop connection attempted", "Connection arrow drawn from a task back to itself", "Connection not created. Action silently ignored."],
    ["E1-US3-TC3", "Undo with no action history", "Fresh canvas, no actions performed. User clicks Undo.", "Undo button disabled. No crash. Canvas unchanged."],
    ["E1-US3-TC4", "Redo with nothing undone", "No prior undo. User clicks Redo.", "Redo button disabled. No crash. Canvas unchanged."],
    ["E1-US4-TC1", "Upload corrupted or incompatible file", "User uploads random binary/unsupported file", "Graceful error: 'File could not be loaded.' No partial data on canvas."],
    ["E1-US5-TC2", "Delete with nothing selected", "Shapes exist on canvas. User deselects all and presses Delete.", "No element removed. Action silently ignored."],
  ];

  const tableData = [
    headers[0].map(h => ({ text: h.text, options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } })),
    ...rows.map((r, i) => r.map(cell => ({
      text: cell,
      options: { fontSize: 10, fill: { color: i % 2 === 0 ? C.white : "F8FBFB" }, color: C.darkTxt },
    })))
  ];

  s.addTable(tableData, {
    x: 0.5, y: 0.95, w: 9, h: 4.3,
    colW: [1.3, 1.9, 2.3, 3.5],
    border: { pt: 0.5, color: C.grayLt },
    autoPage: false,
  });
}

// SLIDE — E1 UI
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E1 — UI Screens", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const screens = [
    { label: "Process Model Workspace", note: "BPMN palette on left, blank canvas with drag-drop hint, Save button top-right." },
    { label: "Active Process Modelling", note: "Shapes placed and connected on canvas; labels editable inline." },
    { label: "Delete Element", note: "Hover tooltip shows Delete option; connected flows auto-removed." },
  ];

  screens.forEach(({ label, note }, i) => {
    const x = 0.5 + i * 3.15;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.05, w: 2.95, h: 2.6,
      fill: { color: "E8F4F8" }, line: { color: C.teal, width: 1.5 },
      shadow: makeShadow(),
    });
    s.addText("[ Screenshot Placeholder ]", {
      x, y: 1.05, w: 2.95, h: 2.6,
      fontSize: 11, color: C.gray, align: "center", valign: "middle", italic: true,
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 3.75, w: 2.95, h: 0.38,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(label, {
      x, y: 3.75, w: 2.95, h: 0.38,
      fontSize: 11, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
    });
    s.addText(note, {
      x, y: 4.2, w: 2.95, h: 0.9,
      fontSize: 10, color: C.gray, align: "left",
    });
  });

  s.addText("Figures 2-1, 2-2, 2-3 from MIDs Report", {
    x: 0.5, y: 5.25, w: 9, h: 0.25,
    fontSize: 9, color: C.gray, italic: true, align: "right",
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION — E3
// ═══════════════════════════════════════════════════════════════
sectionSlide("Epic 3", "Resource Configuration & Simulation Setup");

// SLIDE — E3 User Stories
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E3 — Resource Config & Simulation Setup", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 24, bold: true, color: C.darkTxt,
  });
  addChip(s, "6 User Stories", 0.5, 0.92, 1.6);

  const stories = [
    { id: "E3-US1", title: "Allocate Resources to Process", desc: "Set total available resource quantities (staff, computers, equipment etc.) before running simulation." },
    { id: "E3-US2", title: "Assign Resources to Tasks", desc: "Assign specific resource types to individual tasks so simulation knows which resources each step consumes." },
    { id: "E3-US3", title: "Add Custom Resource", desc: "Add custom resource type with a name and quantity not covered by default options." },
    { id: "E3-US4", title: "Select Simulation Type & Duration", desc: "Choose Quick or Deep simulation and set duration in minutes to control detail level and runtime." },
    { id: "E3-US5", title: "Configure Task Duration", desc: "Set expected duration per task (minutes/hours) so simulation produces realistic time-based results." },
    { id: "E3-US6", title: "Set Case Arrival Rate", desc: "Define inter-arrival time for new cases/customers entering the process to match real workload." },
  ];

  stories.forEach(({ id, title, desc }, i) => {
    const col = i < 3 ? 0 : 1;
    const row = i < 3 ? i : i - 3;
    const x = col === 0 ? 0.5 : 5.15;
    const y = 1.35 + row * 1.35;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 4.35, h: 1.2,
      fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h: 1.2,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(id, {
      x: x + 0.14, y: y + 0.1, w: 1.0, h: 0.28,
      fontSize: 9, bold: true, color: C.teal,
    });
    s.addText(title, {
      x: x + 0.14, y: y + 0.3, w: 4.1, h: 0.3,
      fontSize: 13, bold: true, color: C.darkTxt,
    });
    s.addText(desc, {
      x: x + 0.14, y: y + 0.62, w: 4.1, h: 0.52,
      fontSize: 11, color: C.gray,
    });
  });
}

// SLIDE — E3 Acceptance Criteria
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E3 — Acceptance Criteria", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const criteria = [
    { us: "US1", ac: "Adjusting resource quantity (Staff, Computer, Equipment, Vehicle, Room, Specialist) saves the value and uses it during simulation." },
    { us: "US2", ac: "Clicking a task and selecting resources assigns one or more resource types to that task, and the assignment is saved." },
    { us: "US3", ac: "Adding a custom resource with name and quantity makes it appear in the list and assignable to tasks like any default resource." },
    { us: "US4", ac: "Selecting Quick/Deep and entering a duration confirms selection; system uses those settings when simulation is triggered." },
    { us: "US5", ac: "Entering a duration with unit (minutes/hours) against a task saves it and uses it during simulation execution." },
    { us: "US6", ac: "Entering an inter-arrival time (e.g. one case every 5 minutes) saves that rate and generates incoming cases throughout the simulation run." },
  ];

  criteria.forEach(({ us, ac }, i) => {
    const y = 1.0 + i * 0.77;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.67,
      fill: { color: i % 2 === 0 ? C.white : "F0F6F6" }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addText(`E3-${us}`, {
      x: 0.55, y: y + 0.06, w: 0.75, h: 0.25,
      fontSize: 10, bold: true, color: C.teal,
    });
    s.addText(ac, {
      x: 1.3, y: y + 0.06, w: 8.0, h: 0.55,
      fontSize: 11.5, color: C.darkTxt, valign: "middle",
    });
  });
}

// SLIDE — E3 Test Cases
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E3 — Test Cases", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const rows = [
    ["E3-US1-TC1", "Negative resource quantity entered", "Resource quantity: -3. User clicks Save.", "Validation error: 'Resource quantity must be a positive number.'"],
    ["E3-US2-TC1", "Custom resource with blank name", "Name field empty. Quantity: 2. Click Add.", "Validation error: 'Resource name cannot be empty.' Resource not created."],
    ["E3-US4-TC1", "Zero entered as task duration", "Task duration: 0. Unit: minutes. Click Save.", "Validation error: 'Duration must be greater than zero.'"],
    ["E3-US4-TC3", "Simulation triggered with missing task duration", "Task 2 has no duration set. User clicks Run Simulation.", "Simulation blocked. Warning: 'Task 2 is missing a duration.'"],
    ["E3-US6-TC1", "Zero entered as arrival rate", "Arrival rate field: 0. Click Save.", "Validation error: 'Arrival rate must be greater than zero.'"],
  ];

  const tableData = [
    [
      { text: "Test ID", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
      { text: "Description", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
      { text: "Input", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
      { text: "Expected Result", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
    ],
    ...rows.map((r, i) => r.map(cell => ({
      text: cell,
      options: { fontSize: 10.5, fill: { color: i % 2 === 0 ? C.white : "F8FBFB" }, color: C.darkTxt },
    })))
  ];

  s.addTable(tableData, {
    x: 0.5, y: 0.95, w: 9, h: 4.35,
    colW: [1.3, 2.0, 2.3, 3.4],
    border: { pt: 0.5, color: C.grayLt },
  });
}

// SLIDE — E3 UI
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E3 — UI Screens", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const screens = [
    { label: "Resource Allocation Panel", note: "Left panel: Simulation Setup with resource pool, Quick/Deep mode, simulation scale, inter-arrival rate." },
    { label: "Simulation Setup", note: "Right panel: Task Setup overlay — task duration input and resource assignment checkboxes per task." },
  ];

  screens.forEach(({ label, note }, i) => {
    const x = 0.5 + i * 4.8;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.05, w: 4.4, h: 3.0,
      fill: { color: "E8F4F8" }, line: { color: C.teal, width: 1.5 },
      shadow: makeShadow(),
    });
    s.addText("[ Screenshot Placeholder ]", {
      x, y: 1.05, w: 4.4, h: 3.0,
      fontSize: 11, color: C.gray, align: "center", valign: "middle", italic: true,
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 4.12, w: 4.4, h: 0.38,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(label, {
      x, y: 4.12, w: 4.4, h: 0.38,
      fontSize: 12, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
    });
    s.addText(note, {
      x, y: 4.57, w: 4.4, h: 0.8,
      fontSize: 11, color: C.gray,
    });
  });

  s.addText("Figures 2-5, 2-6 from MIDs Report", {
    x: 0.5, y: 5.3, w: 9, h: 0.22,
    fontSize: 9, color: C.gray, italic: true, align: "right",
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION — E4
// ═══════════════════════════════════════════════════════════════
sectionSlide("Epic 4", "Simulation Engine");

// SLIDE — E4 User Stories
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E4 — Simulation Engine", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });
  addChip(s, "4 User Stories", 0.5, 0.92, 1.6);

  const stories = [
    { id: "E4-US1", title: "Run Simulation", desc: "Click a single Run button to start simulation of a configured process — no technical setup required." },
    { id: "E4-US2", title: "Simulation Status Feedback", desc: "See real-time status (progress indicator) while simulation is running to know the system is working." },
    { id: "E4-US3", title: "Simulation Error Handling", desc: "Be clearly notified if simulation fails with a natural-language error message explaining what went wrong." },
    { id: "E4-US4", title: "Cancel a Running Simulation", desc: "Stop a running simulation to make configuration changes without waiting for it to finish." },
  ];

  stories.forEach(({ id, title, desc }, i) => {
    const y = 1.3 + i * 1.05;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.92,
      fill: { color: C.white }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 0.06, h: 0.92,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(id, {
      x: 0.65, y: y + 0.1, w: 1.1, h: 0.25,
      fontSize: 9, bold: true, color: C.teal,
    });
    s.addText(title, {
      x: 1.7, y: y + 0.06, w: 3.5, h: 0.34,
      fontSize: 14, bold: true, color: C.darkTxt, valign: "middle",
    });
    s.addText(desc, {
      x: 0.65, y: y + 0.47, w: 8.6, h: 0.38,
      fontSize: 11.5, color: C.gray,
    });
  });
}

// SLIDE — E4 Acceptance Criteria
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E4 — Acceptance Criteria", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const criteria = [
    { us: "US1", ac: "Process model drawn and resources configured → Click Run → system sends model to simulation engine, shows progress indicator, and displays results on completion." },
    { us: "US2", ac: "Simulation triggered → progress indicator visible on screen and updates in real time until simulation completes or fails." },
    { us: "US3 (a)", ac: "Incomplete/invalid model → engine detects issue → clear natural-language error message showing exactly what is missing or incorrect." },
    { us: "US3 (b)", ac: "Disconnected shape → 'Your process has disconnected steps.' Missing Start Event → 'Your process is missing a Start Event.' Empty canvas → 'No process model found.'" },
    { us: "US4", ac: "Simulation in progress → click Cancel → simulation stops immediately, progress indicator cleared, returned to configuration state, no partial results saved." },
  ];

  criteria.forEach(({ us, ac }, i) => {
    const y = 1.0 + i * 0.88;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y, w: 9, h: 0.78,
      fill: { color: i % 2 === 0 ? C.white : "F0F6F6" }, line: { color: C.grayLt, width: 1 },
      shadow: makeShadow(),
    });
    s.addText(`E4-${us}`, {
      x: 0.55, y: y + 0.08, w: 0.85, h: 0.25,
      fontSize: 10, bold: true, color: C.teal,
    });
    s.addText(ac, {
      x: 1.45, y: y + 0.06, w: 7.85, h: 0.65,
      fontSize: 11.5, color: C.darkTxt, valign: "middle",
    });
  });
}

// SLIDE — E4 Test Cases
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E4 — Test Cases", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const rows = [
    ["E4-US1-TC2", "Simulation triggered with incomplete config", "Process missing task durations. Click Run Simulation.", "Simulation does not start. Error: 'One or more tasks are missing a duration.'"],
    ["E4-US2-TC2", "Simulation fails mid-execution", "Simulation started; engine encounters internal error during processing.", "Progress indicator stops to failure state. Error: 'Simulation failed due to an internal error.'"],
    ["E4-US3-TC1", "Disconnected shape in model", "Task node with no incoming/outgoing connections. Click Run.", "Error: 'Your process has disconnected steps. Please connect all shapes.'"],
    ["E4-US3-TC2", "Model missing a Start Event", "Process has tasks and End Event but no Start Event. Click Run.", "Error: 'Your process is missing a Start Event.'"],
    ["E4-US3-TC3", "Empty canvas on Run", "Canvas is empty. Click Run Simulation.", "Error: 'No process model found. Please build or load a process.'"],
    ["E4-US4-TC2", "Cancel with no active simulation", "No simulation running. User clicks Cancel.", "Cancel button disabled. Action silently ignored. No crash."],
  ];

  const tableData = [
    [
      { text: "Test ID", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
      { text: "Description", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
      { text: "Input", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
      { text: "Expected Result", options: { bold: true, color: C.white, fill: { color: C.teal }, fontSize: 11 } },
    ],
    ...rows.map((r, i) => r.map(cell => ({
      text: cell,
      options: { fontSize: 10, fill: { color: i % 2 === 0 ? C.white : "F8FBFB" }, color: C.darkTxt },
    })))
  ];

  s.addTable(tableData, {
    x: 0.5, y: 0.95, w: 9, h: 4.35,
    colW: [1.3, 1.95, 2.3, 3.45],
    border: { pt: 0.5, color: C.grayLt },
  });
}

// SLIDE — E4 UI
{
  const s = pres.addSlide();
  lightSlide(s);

  s.addText("E4 — UI Screens", {
    x: 0.5, y: 0.3, w: 9, h: 0.55,
    fontSize: 26, bold: true, color: C.darkTxt,
  });

  const screens = [
    { label: "Simulation Running Screen", note: "Progress bar at bottom-left, Cancel button top-right, animated nodes on canvas showing active simulation state." },
    { label: "Simulation Results", note: "Results tab with Avg Cycle Time, Production Speed, Worst-Case Scenario, and Critical Bottleneck KPI cards." },
  ];

  screens.forEach(({ label, note }, i) => {
    const x = 0.5 + i * 4.8;

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 1.05, w: 4.4, h: 3.0,
      fill: { color: "E8F4F8" }, line: { color: C.teal, width: 1.5 },
      shadow: makeShadow(),
    });
    s.addText("[ Screenshot Placeholder ]", {
      x, y: 1.05, w: 4.4, h: 3.0,
      fontSize: 11, color: C.gray, align: "center", valign: "middle", italic: true,
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x, y: 4.12, w: 4.4, h: 0.38,
      fill: { color: C.teal }, line: { color: C.teal },
    });
    s.addText(label, {
      x, y: 4.12, w: 4.4, h: 0.38,
      fontSize: 12, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
    });
    s.addText(note, {
      x, y: 4.57, w: 4.4, h: 0.8,
      fontSize: 11, color: C.gray,
    });
  });

  s.addText("Figures 2-7, 2-8 from MIDs Report", {
    x: 0.5, y: 5.3, w: 9, h: 0.22,
    fontSize: 9, color: C.gray, italic: true, align: "right",
  });
}

// ═══════════════════════════════════════════════════════════════
// SLIDE — CLOSING
// ═══════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  darkSlide(s);

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.08, h: 5.625, fill: { color: C.teal }, line: { color: C.teal },
  });

  s.addText("Thank You", {
    x: 0.4, y: 1.2, w: 9, h: 1.0,
    fontSize: 52, bold: true, color: C.white,
  });

  s.addText("Questions & Discussion", {
    x: 0.4, y: 2.3, w: 9, h: 0.6,
    fontSize: 22, color: C.mint, italic: true,
  });

  s.addShape(pres.shapes.LINE, {
    x: 0.4, y: 3.05, w: 9.2, h: 0, line: { color: C.teal, width: 1.5 },
  });

  s.addText([
    { text: "Zahra Iftikhar  |  Rabia Tahir  |  Muhammad Taimoor Malik", options: { breakLine: true } },
    { text: "Supervised by Dr. Nadeem Anjum  •  CUST, Islamabad  •  Spring 2026" },
  ], {
    x: 0.4, y: 3.25, w: 9.2, h: 0.9,
    fontSize: 13, color: C.mint, align: "left",
  });
}

// ── Write file ────────────────────────────────────────────────
pres.writeFile({ fileName: "/mnt/user-data/outputs/SPOT_FYP_Mid.pptx" })
  .then(() => console.log("Done: SPOT_FYP_Mid.pptx"))
  .catch(e => { console.error(e); process.exit(1); });