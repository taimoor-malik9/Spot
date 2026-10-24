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

const ProcessSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  resources: {
    type: [ResourceSchema],
    default: []
  },
  nodes: {
    type: Array,
    default: []
  },
  edges: [{
    id: { type: String },
    source: { type: String, required: true },
    target: { type: String, required: true },
    type: { type: String },
    flowType: { type: String },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }],
  layoutElements: {
    type: mongoose.Schema.Types.Mixed,
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
    enum: ['waiting', 'cost', 'throughput', null],
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

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

ProcessSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  try {
    const { invalidateSuggestionsCache } = require('../services/testedSuggestionsService');
    invalidateSuggestionsCache(this._id);
  } catch (err) {
    // Non-blocking
  }
  if (Array.isArray(this.edges)) {
    this.edges = this.edges.map(e => ({
      ...e,
      data: normalizeEdgeData(e.data)
    }));
  }
  if (typeof next === 'function') next();
});

ProcessSchema.post('init', function () {
  if (Array.isArray(this.edges)) {
    this.edges = this.edges.map(e => ({
      ...e,
      data: normalizeEdgeData(e.data)
    }));
  }
});

module.exports = mongoose.model('Process', ProcessSchema);