const mongoose = require('mongoose');

// Shared Resource JSON Schema — must match ResourceConfigPanel (frontend)
// and ProcessInput/ScenarioInput (simulation engine) field-for-field.
const ResourceSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, required: true, enum: ['staff', 'equipment', 'vehicle', 'facility'] },
  quantity: { type: Number, required: true },
  hours_per_day: { type: Number, default: null },
  working_days_per_month: { type: Number, default: null },
  monthly_salary: { type: Number, default: null },
  purchase_price: { type: Number, default: null },
  lifespan_months: { type: Number, default: null },
  monthly_running_cost: { type: Number, default: null },
  monthly_rent: { type: Number, default: null }
}, { _id: false });

const ScenarioSchema = new mongoose.Schema({
    baseProcessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Process'
    },
    title: String,
    nodes: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    edges: Array,
    // Same container-box data Process.js now carries — without this,
    // scenarios forked from baseline lose their swimlanes the moment
    // they're saved to the backend and reloaded, even though the fork
    // itself (a pure in-memory clone) preserved them just fine.
    layoutElements: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    resources: {
        type: [ResourceSchema],
        default: []
    },
    simulationResults: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    simulationConfig: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    goal: {
        type: String,
        default: null
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
        default: null
    }
}, {
    timestamps: true
});

ScenarioSchema.index({ userId: 1, baseProcessId: 1, createdAt: -1 });

function normalizeEdgeData(data) {
  if (!data) return {};
  if (typeof data === 'object') return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return { type: data };
    }
  }
  return {};
}

function normalizeNodeOrigin(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map(n => {
    if (!n || typeof n !== 'object') return n;
    const d = n.data && typeof n.data === 'object' ? { ...n.data } : {};
    const origin = d.origin || n.origin || 'user';
    const kept = d.kept !== undefined ? Boolean(d.kept) : (n.kept !== undefined ? Boolean(n.kept) : false);
    const estimated = Boolean(d.estimated ?? n.estimated);
    return {
      ...n,
      origin,
      kept,
      data: {
        ...d,
        origin,
        kept,
        estimated,
      }
    };
  });
}

ScenarioSchema.pre('save', function (next) {
  if (Array.isArray(this.nodes)) {
    this.nodes = normalizeNodeOrigin(this.nodes);
  }
  if (Array.isArray(this.edges)) {
    this.edges = this.edges.map(e => ({
      ...e,
      data: normalizeEdgeData(e.data)
    }));
  }
  if (typeof next === 'function') next();
});

ScenarioSchema.post('init', function () {
  if (Array.isArray(this.nodes)) {
    this.nodes = normalizeNodeOrigin(this.nodes);
  }
  if (Array.isArray(this.edges)) {
    this.edges = this.edges.map(e => ({
      ...e,
      data: normalizeEdgeData(e.data)
    }));
  }
});

module.exports = mongoose.model('Scenario', ScenarioSchema);