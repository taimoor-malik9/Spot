import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Grid2X2,
  Plus,
  Search,
  Copy,
  Trash2,
  ExternalLink,
  Clock,
  Layers,
  Play,
  Shuffle,
  AlertTriangle,
  Loader2,
  LayoutGrid,
  Table as TableIcon,
  Activity,
  ArrowRight,
  TrendingUp,
  Filter,
  CheckSquare,
  Square,
  X,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  RotateCw,
  Pencil,
  CheckCircle2,
  Info,
} from 'lucide-react';
import {
  getAllProcesses,
  deleteProcess,
  duplicateProcess,
  getProcess,
  listRuns,
  getRun,
  deleteRun,
  getRecentScenarios,
  getAllScenarios,
  deleteScenario,
  duplicateScenario,
  runScenarioSimulation,
  shapeBackendToFrontend,
} from '../lib/apiService';
import { useAnalystView, Hint, formatPlainLanguage } from '../lib/labels';
import '../styles/account-pages.css';

function formatRelativeTime(dateInput) {
  if (!dateInput) return '—';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '—';
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatFullDate(dateInput) {
  if (!dateInput) return '—';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTime(mins) {
  if (mins == null || isNaN(mins)) return null;
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Number(mins).toFixed(1)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtThroughput(rate) {
  if (rate == null || isNaN(rate)) return null;
  const num = Number(rate);
  const perHr = num * 60;
  if (perHr >= 1) return `${perHr.toFixed(1)}/hr`;
  return `${num.toFixed(2)}/min`;
}

function fmtCost(amount) {
  if (amount == null || isNaN(amount)) return null;
  return `Rs ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const [isAnalystView] = useAnalystView();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active tab: 'processes' | 'scenarios' | 'runs'
  const activeTabParam = searchParams.get('tab');
  const activeTab = activeTabParam === 'scenarios' || activeTabParam === 'runs' ? activeTabParam : 'processes';
  const setActiveTab = (tab) => {
    setSearchParams(tab === 'processes' ? {} : { tab });
  };

  // Data states
  const [processes, setProcesses] = useState([]);
  const [allScenarios, setAllScenarios] = useState([]);
  const [recentRuns, setRecentRuns] = useState([]);
  const [recentScenarios, setRecentScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tab API availability flags
  const [hasScenariosApi, setHasScenariosApi] = useState(true);
  const [hasRunsApi, setHasRunsApi] = useState(true);

  // Processes Tab States
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('last_edited_desc');
  const [viewMode, setViewMode] = useState('table'); // Table view is default

  // Inline Rename States
  const [editingProcessId, setEditingProcessId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Confirmation & Action States
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [deleteConfirmProcess, setDeleteConfirmProcess] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Scenarios Tab States (Module P2)
  const [scenarioSearch, setScenarioSearch] = useState('');
  const [processFilter, setProcessFilter] = useState('all');
  const [scenarioSortBy, setScenarioSortBy] = useState('created_desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [deleteConfirmScenario, setDeleteConfirmScenario] = useState(null);
  const [runningScenarioId, setRunningScenarioId] = useState(null);

  // Drawer States (Module P2 / H1)
  const [drawerScenario, setDrawerScenario] = useState(null);
  const [drawerRun, setDrawerRun] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Notification Toast State
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = useCallback((msg, type = 'info') => {
    setToastMessage({ text: msg, type });
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // Fetch initial dashboard data with 10s timeout guarantee
  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    let timerId;

    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error('Dashboard request timed out after 10 seconds.'));
      }, 10000);
    });

    try {
      const fetchPromise = Promise.allSettled([
        getAllProcesses(),
        listRuns({ limit: 50 }),
        getRecentScenarios(10),
        getAllScenarios(),
      ]);

      const results = await Promise.race([fetchPromise, timeoutPromise]);
      clearTimeout(timerId);

      // 1. Processes
      if (results[0].status === 'fulfilled') {
        const procs = results[0].value;
        setProcesses(Array.isArray(procs) ? procs : []);
      } else {
        console.warn('[Dashboard] GET /api/process failed:', results[0].reason?.message);
        setProcesses([]);
      }

      // 2. Runs API
      if (results[1].status === 'fulfilled') {
        setHasRunsApi(true);
        const runsData = results[1].value;
        const runsList = runsData?.runs || (Array.isArray(runsData) ? runsData : []);
        setRecentRuns(runsList);
      } else {
        console.warn('[Dashboard] GET /api/runs failed or unavailable:', results[1].reason?.message);
        setHasRunsApi(false);
        setRecentRuns([]);
      }

      // 3. Recent Scenarios
      if (results[2].status === 'fulfilled') {
        setRecentScenarios(Array.isArray(results[2].value) ? results[2].value : []);
      } else {
        setRecentScenarios([]);
      }

      // 4. Scenarios List API & Data Check (Item 7)
      if (results[3].status === 'fulfilled') {
        setHasScenariosApi(true);
        const scens = results[3].value;
        const count = Array.isArray(scens) ? scens.length : 0;
        console.log(`[Dashboard Data Check] GET /api/scenario?all=true -> HTTP 200 OK (returned count: ${count}). Note: existing scenario documents in DB have no userId field, so account-scoped filter returns 0.`);
        setAllScenarios(Array.isArray(scens) ? scens : []);
      } else {
        console.warn('[Dashboard Data Check] GET /api/scenario failed:', results[3].reason?.message);
        setHasScenariosApi(false);
        setAllScenarios([]);
      }
    } catch (err) {
      console.error('[Dashboard] Error loading dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      clearTimeout(timerId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Handle New Process
  const handleNewProcess = () => {
    localStorage.removeItem('spot:processId');
    localStorage.removeItem('spot:processTitle');
    localStorage.removeItem('spot:model:nodes');
    localStorage.removeItem('spot:activeScenarioId');
    localStorage.removeItem('spot:globalResources');
    navigate('/model');
  };

  // Handle Open process (sets localStorage exactly like Model page's load path)
  const handleOpenProcess = useCallback(
    async (proc) => {
      try {
        let fullProc = proc;
        if (!proc.nodes || !proc.edges) {
          fullProc = await getProcess(proc._id || proc.id);
        }
        const { elements: els, connections: conns } = shapeBackendToFrontend(fullProc);
        const processId = fullProc._id || fullProc.id;
        const processTitle = fullProc.title || 'Untitled Process';

        localStorage.setItem('spot:processId', processId);
        localStorage.setItem('spot:processTitle', processTitle);
        localStorage.setItem('spot:model:nodes', JSON.stringify({ nodes: els, connections: conns }));
        localStorage.removeItem('spot:activeScenarioId');

        if (fullProc.resources && Array.isArray(fullProc.resources)) {
          localStorage.setItem('spot:globalResources', JSON.stringify(fullProc.resources));
        }
        navigate('/model');
      } catch (err) {
        showToast(`Could not open process: ${err.message}`, 'error');
      }
    },
    [navigate, showToast]
  );

  // Handle Duplicate Process
  const handleDuplicateProcess = useCallback(
    async (proc, e) => {
      e?.stopPropagation();
      const pId = proc._id || proc.id;
      setDuplicatingId(pId);
      try {
        const res = await duplicateProcess(pId);
        const newProc = res.process;
        showToast(`Duplicated "${proc.title || 'Process'}" as "${newProc?.title || 'Copy'}"`, 'success');
        const updated = await getAllProcesses();
        setProcesses(Array.isArray(updated) ? updated : []);
      } catch (err) {
        showToast(`Duplicate failed: ${err.message}`, 'error');
      } finally {
        setDuplicatingId(null);
      }
    },
    [showToast]
  );

  // Handle Delete Process Confirm
  const handleConfirmDeleteProcess = useCallback(async () => {
    if (!deleteConfirmProcess) return;
    const pId = deleteConfirmProcess._id || deleteConfirmProcess.id;
    setDeletingId(pId);
    try {
      await deleteProcess(pId);
      showToast(`Deleted process "${deleteConfirmProcess.title || 'Untitled'}"`, 'info');

      if (localStorage.getItem('spot:processId') === pId) {
        localStorage.removeItem('spot:processId');
        localStorage.removeItem('spot:processTitle');
        localStorage.removeItem('spot:model:nodes');
        localStorage.removeItem('spot:activeScenarioId');
        localStorage.removeItem('spot:globalResources');
      }

      setProcesses((prev) => prev.filter((p) => (p._id || p.id) !== pId));
      setAllScenarios((prev) => prev.filter((s) => (s.baseProcessId?._id || s.baseProcessId) !== pId));
      setRecentRuns((prev) => prev.filter((r) => r.processId !== pId));
      setDeleteConfirmProcess(null);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  }, [deleteConfirmProcess, showToast]);

  // Inline Rename Process
  const startRename = (proc, e) => {
    e?.stopPropagation();
    setEditingProcessId(proc._id || proc.id);
    setEditTitle(proc.title || 'Untitled Process');
  };

  const handleSaveRename = async (pId) => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setEditingProcessId(null);
      return;
    }
    setRenaming(true);
    try {
      const token = localStorage.getItem('spot_token') || sessionStorage.getItem('spot_token');
      const res = await fetch(`/api/process/${pId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProcesses((prev) =>
        prev.map((p) => ((p._id || p.id) === pId ? { ...p, title: trimmed } : p))
      );
      showToast('Process renamed', 'success');
    } catch (err) {
      showToast(`Could not rename process: ${err.message}`, 'error');
    } finally {
      setRenaming(false);
      setEditingProcessId(null);
    }
  };

  // Header Sort Toggle
  const toggleSort = (col) => {
    if (col === 'name') {
      setSortBy((prev) => (prev === 'name_asc' ? 'name_desc' : 'name_asc'));
    } else if (col === 'cycle_time') {
      setSortBy((prev) => (prev === 'cycle_time_asc' ? 'cycle_time_desc' : 'cycle_time_asc'));
    } else {
      setSortBy((prev) => (prev === 'last_edited_desc' ? 'last_edited_asc' : 'last_edited_desc'));
    }
  };

  // Filter & Sort Processes
  const displayedProcesses = useMemo(() => {
    let list = [...processes];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((p) => (p.title || '').toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
      }
      if (sortBy === 'name_desc') {
        return (b.title || 'Untitled').localeCompare(a.title || 'Untitled');
      }
      if (sortBy === 'cycle_time_asc') {
        const ca = a.lastRunSummary?.avg_cycle_time ?? Infinity;
        const cb = b.lastRunSummary?.avg_cycle_time ?? Infinity;
        return ca - cb;
      }
      if (sortBy === 'cycle_time_desc') {
        const ca = a.lastRunSummary?.avg_cycle_time ?? -1;
        const cb = b.lastRunSummary?.avg_cycle_time ?? -1;
        return cb - ca;
      }
      if (sortBy === 'last_edited_asc') {
        const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return da - db;
      }
      // default: last_edited_desc
      const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return db - da;
    });

    return list;
  }, [processes, searchQuery, sortBy]);

  // Compute Summary Tiles data
  const runsThisWeek = useMemo(() => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return recentRuns.filter((r) => {
      const dateMs = new Date(r.createdAt || r.timestamp || 0).getTime();
      return dateMs >= oneWeekAgo;
    }).length;
  }, [recentRuns]);

  const bestGain = useMemo(() => {
    let maxGain = null;
    recentRuns.forEach((r) => {
      const gain = r.summary?.cycleTimeGainPct ?? r.summary?.improvement_pct;
      if (typeof gain === 'number' && Number.isFinite(gain) && gain > 0) {
        if (maxGain === null || gain > maxGain) maxGain = gain;
      }
    });
    return maxGain !== null ? `+${maxGain.toFixed(1)}%` : '—';
  }, [recentRuns]);

  // Recent Activity Items (Last 10 runs and scenarios combined)
  const recentActivity = useMemo(() => {
    const items = [];

    (recentRuns || []).forEach((r) => {
      items.push({
        id: `run_${r._id || r.id}`,
        type: 'run',
        title: r.title || r.scenarioTitle || 'Simulation Run',
        processTitle: r.processTitle || r.processName,
        date: new Date(r.createdAt || r.timestamp || Date.now()),
        metric: r.summary?.avg_cycle_time ? fmtTime(r.summary.avg_cycle_time) : (r.summary?.cycleTime ? fmtTime(r.summary.cycleTime) : null),
        target: r,
      });
    });

    (recentScenarios || []).forEach((s) => {
      items.push({
        id: `scen_${s._id || s.id}`,
        type: 'scenario',
        title: s.title || 'What-If Scenario',
        processTitle: s.baseProcessId?.title || s.baseProcessName,
        date: new Date(s.updatedAt || s.createdAt || Date.now()),
        metric: s.lastRun?.summary?.avg_cycle_time ? fmtTime(s.lastRun.summary.avg_cycle_time) : null,
        target: s,
      });
    });

    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    return items.slice(0, 10);
  }, [recentRuns, recentScenarios]);

  const handleOpenActivity = (item) => {
    if (item.type === 'scenario') {
      const bId = item.target.baseProcessId?._id || item.target.baseProcessId;
      if (bId) localStorage.setItem('spot:processId', bId.toString());
      localStorage.setItem('spot:activeScenarioId', (item.target._id || item.target.id).toString());
      navigate('/scenarios');
    } else if (item.type === 'run') {
      navigate(`/results?runId=${item.target._id || item.target.id}`);
    }
  };

  return (
    <div className="spot-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 60,
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: toastMessage.type === 'error' ? '#fef2f2' : toastMessage.type === 'success' ? '#f0fdf4' : '#0f172a',
            color: toastMessage.type === 'error' ? '#b91c1c' : toastMessage.type === 'success' ? '#166534' : '#ffffff',
            border: `1px solid ${toastMessage.type === 'error' ? '#fecaca' : toastMessage.type === 'success' ? '#bbf7d0' : '#334155'}`,
          }}
        >
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* 1) Header: Title + one-line subtitle on left; Single filled "New process" button on right */}
      <div className="spot-dashboard-header">
        <div>
          <h1 className="spot-header-title">Dashboard</h1>
          <p className="spot-header-subtitle">
            Manage your business processes, what-if scenarios, and simulation runs.
          </p>
        </div>
        <button
          type="button"
          className="spot-btn spot-btn-primary"
          onClick={handleNewProcess}
        >
          <Plus size={16} />
          <span>New process</span>
        </button>
      </div>

      {/* 2) Four summary tiles */}
      <div className="spot-tile-grid">
        <div className="spot-tile">
          <div className="spot-tile-label">Processes</div>
          <div className="spot-tile-value">{loading ? '…' : processes.length}</div>
        </div>
        <div className="spot-tile">
          <div className="spot-tile-label">{isAnalystView ? "Scenarios" : <Hint term="scenarios">Ideas to try</Hint>}</div>
          <div className="spot-tile-value">{loading ? '…' : allScenarios.length}</div>
        </div>
        <div className="spot-tile">
          <div className="spot-tile-label">{isAnalystView ? "Runs this week" : <Hint term="simulation">Test runs this week</Hint>}</div>
          <div className="spot-tile-value">{loading ? '…' : runsThisWeek}</div>
        </div>
        <div className="spot-tile">
          <div className="spot-tile-label">{isAnalystView ? "Best cycle time gain" : <Hint term="cycle_time">Best time saved</Hint>}</div>
          <div className="spot-tile-value">{loading ? '…' : bestGain}</div>
        </div>
      </div>

      {/* Error state alert */}
      {error && (
        <div className="spot-alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadDashboardData}
            className="spot-btn spot-btn-outline"
            style={{ height: 32, padding: '0 12px', fontSize: 12 }}
          >
            <RotateCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* 3) Tabs row: Processes | Scenarios | Run history with search box at right of same row */}
      <div className="spot-toolbar-row">
        <div className="spot-tabs">
          <button
            type="button"
            className={`spot-tab-btn ${activeTab === 'processes' ? 'active' : ''}`}
            onClick={() => setActiveTab('processes')}
          >
            Processes ({processes.length})
          </button>
          {hasScenariosApi && (
            <button
              type="button"
              className={`spot-tab-btn ${activeTab === 'scenarios' ? 'active' : ''}`}
              onClick={() => setActiveTab('scenarios')}
            >
              {isAnalystView ? 'Scenarios' : 'Ideas to try'} ({allScenarios.length})
            </button>
          )}
          {hasRunsApi && (
            <button
              type="button"
              className={`spot-tab-btn ${activeTab === 'runs' ? 'active' : ''}`}
              onClick={() => setActiveTab('runs')}
            >
              {isAnalystView ? 'Run history' : 'Test run history'} ({recentRuns.length})
            </button>
          )}
        </div>

        <div className="spot-toolbar-right">
          {activeTab === 'processes' && (
            <>
              {/* Sort Dropdown */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="spot-btn spot-btn-outline"
                style={{ height: 40, padding: '0 12px', fontSize: 13, background: '#fff', cursor: 'pointer' }}
                aria-label="Sort processes by"
              >
                <option value="last_edited_desc">Last edited</option>
                <option value="name_asc">Name (A–Z)</option>
                <option value="name_desc">Name (Z–A)</option>
                <option value="cycle_time_asc">Cycle time (low to high)</option>
                <option value="cycle_time_desc">Cycle time (high to low)</option>
              </select>

              {/* View Toggle */}
              <div className="spot-toggle-group">
                <button
                  type="button"
                  className={`spot-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setViewMode('table')}
                  title="Table view"
                  aria-label="Table view"
                >
                  <TableIcon size={16} />
                </button>
                <button
                  type="button"
                  className={`spot-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="Card view"
                  aria-label="Card view"
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
            </>
          )}

          {/* Search Box */}
          <div className="spot-input-wrap" style={{ width: 220 }}>
            <Search size={15} className="spot-input-icon" />
            <input
              type="text"
              className="spot-input"
              placeholder={
                activeTab === 'processes'
                  ? 'Search processes…'
                  : activeTab === 'scenarios'
                  ? 'Search scenarios…'
                  : 'Search runs…'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 4) Processes Tab Content */}
      {activeTab === 'processes' && (
        <>
          {loading ? (
            /* Skeleton Loading State */
            <div className="spot-table-container">
              <table className="spot-table">
                <thead>
                  <tr>
                    <th className="spot-table-th">Name</th>
                    <th className="spot-table-th">{isAnalystView ? "Scenarios" : <Hint term="scenarios">Ideas</Hint>}</th>
                    <th className="spot-table-th">{isAnalystView ? "Cycle time" : <Hint term="cycle_time">Time to complete</Hint>}</th>
                    <th className="spot-table-th">{isAnalystView ? "Throughput" : <Hint term="throughput">Customers / hr</Hint>}</th>
                    <th className="spot-table-th" style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="spot-table-tr" style={{ cursor: 'default' }}>
                      <td className="spot-table-td">
                        <div className="spot-skeleton" style={{ height: 16, width: '60%', marginBottom: 6 }} />
                        <div className="spot-skeleton" style={{ height: 12, width: '30%' }} />
                      </td>
                      <td className="spot-table-td"><div className="spot-skeleton" style={{ height: 14, width: 40 }} /></td>
                      <td className="spot-table-td"><div className="spot-skeleton" style={{ height: 14, width: 50 }} /></td>
                      <td className="spot-table-td"><div className="spot-skeleton" style={{ height: 14, width: 50 }} /></td>
                      <td className="spot-table-td" style={{ textAlign: 'right' }}>
                        <div className="spot-skeleton" style={{ height: 28, width: 80, marginLeft: 'auto' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : displayedProcesses.length === 0 ? (
            /* Empty State */
            <div className="spot-card spot-empty-state">
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#ede9fe',
                  color: '#5E43F3',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <Layers size={24} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                {searchQuery ? 'No matching processes' : 'No processes yet'}
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px 0', maxWidth: 420 }}>
                {searchQuery
                  ? `No processes match "${searchQuery}". Try another search term.`
                  : (isAnalystView ? 'Create your first business process to start modeling and simulating workflows.' : 'Create your first business process to map and test your operations.')}
              </p>
              {searchQuery ? (
                <button
                  type="button"
                  className="spot-btn spot-btn-outline"
                  onClick={() => setSearchQuery('')}
                >
                  Clear search
                </button>
              ) : (
                <button
                  type="button"
                  className="spot-btn spot-btn-outline"
                  onClick={handleNewProcess}
                >
                  <Plus size={16} />
                  <span>New process</span>
                </button>
              )}
            </div>
          ) : viewMode === 'table' ? (
            /* Bordered Table View (Default) */
            <div className="spot-table-container">
              <table className="spot-table">
                <thead>
                  <tr>
                    <th className="spot-table-th sortable" onClick={() => toggleSort('name')}>
                      Name {sortBy.startsWith('name') && (sortBy === 'name_asc' ? '↑' : '↓')}
                    </th>
                    <th className="spot-table-th">{isAnalystView ? "Scenarios" : <Hint term="scenarios">Ideas</Hint>}</th>
                    <th className="spot-table-th sortable" onClick={() => toggleSort('cycle_time')}>
                      {isAnalystView ? "Cycle time" : <Hint term="cycle_time">Time to complete</Hint>} {sortBy.startsWith('cycle_time') && (sortBy === 'cycle_time_asc' ? '↑' : '↓')}
                    </th>
                    <th className="spot-table-th">{isAnalystView ? "Throughput" : <Hint term="throughput">Customers / hr</Hint>}</th>
                    <th className="spot-table-th" style={{ textAlign: 'right', width: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedProcesses.map((proc) => {
                    const pId = proc._id || proc.id;
                    const lastEdited = formatRelativeTime(proc.updatedAt || proc.createdAt);
                    const scenCount = proc.scenarioCount || 0;
                    const runSum = proc.lastRunSummary;
                    const cycleTimeStr = fmtTime(runSum?.avg_cycle_time);
                    const throughputStr = fmtThroughput(runSum?.throughput_rate);

                    return (
                      <tr
                        key={pId}
                        className="spot-table-tr"
                        onClick={() => handleOpenProcess(proc)}
                      >
                        <td className="spot-table-td">
                          {editingProcessId === pId ? (
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                className="spot-inline-input"
                                value={editTitle}
                                autoFocus
                                disabled={renaming}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(pId);
                                  if (e.key === 'Escape') setEditingProcessId(null);
                                }}
                              />
                              <button
                                type="button"
                                className="spot-icon-btn"
                                title="Save"
                                aria-label="Save name"
                                disabled={renaming}
                                onClick={() => handleSaveRename(pId)}
                              >
                                <CheckSquare size={16} color="#15803d" />
                              </button>
                              <button
                                type="button"
                                className="spot-icon-btn"
                                title="Cancel"
                                aria-label="Cancel editing"
                                disabled={renaming}
                                onClick={() => setEditingProcessId(null)}
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                  style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}
                                  onDoubleClick={(e) => startRename(proc, e)}
                                  title="Double-click to rename"
                                >
                                  {proc.title || 'Untitled Process'}
                                </span>
                                <button
                                  type="button"
                                  className="spot-icon-btn"
                                  title="Rename process"
                                  aria-label="Rename process"
                                  onClick={(e) => startRename(proc, e)}
                                  style={{ width: 22, height: 22 }}
                                >
                                  <Pencil size={12} />
                                </button>
                              </div>
                              <span style={{ fontSize: 12, color: '#64748b' }}>
                                Edited {lastEdited}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="spot-table-td" style={{ color: '#475569' }}>
                          {scenCount}
                        </td>
                        <td className="spot-table-td" style={{ color: '#0f172a', fontWeight: 500 }}>
                          {cycleTimeStr || '—'}
                        </td>
                        <td className="spot-table-td" style={{ color: '#0f172a', fontWeight: 500 }}>
                          {throughputStr || '—'}
                        </td>
                        <td className="spot-table-td" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <button
                              type="button"
                              className="spot-icon-btn"
                              onClick={() => handleOpenProcess(proc)}
                              aria-label="Open process"
                              title="Open process in modeler"
                            >
                              <ExternalLink size={15} />
                            </button>
                            <button
                              type="button"
                              className="spot-icon-btn"
                              onClick={(e) => handleDuplicateProcess(proc, e)}
                              aria-label="Duplicate process"
                              title="Duplicate process"
                              disabled={duplicatingId === pId}
                            >
                              {duplicatingId === pId ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Copy size={15} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="spot-icon-btn danger"
                              onClick={() => setDeleteConfirmProcess(proc)}
                              aria-label="Delete process"
                              title="Delete process"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Card View (Secondary Toggle, cards min 280px, padding 20px, 16px gaps) */
            <div className="spot-process-grid">
              {displayedProcesses.map((proc) => {
                const pId = proc._id || proc.id;
                const lastEdited = formatRelativeTime(proc.updatedAt || proc.createdAt);
                const scenCount = proc.scenarioCount || 0;
                const runSum = proc.lastRunSummary;
                const cycleTimeStr = fmtTime(runSum?.avg_cycle_time);
                const throughputStr = fmtThroughput(runSum?.throughput_rate);

                return (
                  <div
                    key={pId}
                    className="spot-process-card"
                    onClick={() => handleOpenProcess(proc)}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        {editingProcessId === pId ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              className="spot-inline-input"
                              value={editTitle}
                              autoFocus
                              disabled={renaming}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(pId);
                                if (e.key === 'Escape') setEditingProcessId(null);
                              }}
                            />
                            <button
                              type="button"
                              className="spot-icon-btn"
                              title="Save"
                              aria-label="Save name"
                              disabled={renaming}
                              onClick={() => handleSaveRename(pId)}
                            >
                              <CheckSquare size={16} color="#15803d" />
                            </button>
                            <button
                              type="button"
                              className="spot-icon-btn"
                              title="Cancel"
                              aria-label="Cancel editing"
                              disabled={renaming}
                              onClick={() => setEditingProcessId(null)}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <h3
                              style={{
                                fontSize: 15,
                                fontWeight: 600,
                                color: '#0f172a',
                                margin: 0,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              onDoubleClick={(e) => startRename(proc, e)}
                              title="Double-click to rename"
                            >
                              {proc.title || 'Untitled Process'}
                            </h3>
                            <button
                              type="button"
                              className="spot-icon-btn"
                              title="Rename process"
                              aria-label="Rename process"
                              onClick={(e) => startRename(proc, e)}
                              style={{ width: 22, height: 22, flexShrink: 0 }}
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                        )}

                        <span className="spot-badge" style={{ background: '#f1f5f9', color: '#475569', flexShrink: 0 }}>
                          <Layers size={11} />
                          <span>{scenCount} {scenCount === 1 ? 'scenario' : 'scenarios'}</span>
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        <span>Edited {lastEdited}</span>
                      </div>

                      <div
                        style={{
                          marginTop: 14,
                          padding: '10px 12px',
                          borderRadius: 8,
                          background: '#f8fafc',
                          border: '1px solid #f1f5f9',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em', marginBottom: 4 }}>
                          Last run summary
                        </div>
                        {runSum ? (
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0f172a', fontWeight: 600 }}>
                            <div>Cycle: {cycleTimeStr || '—'}</div>
                            <div>Throughput: {throughputStr || '—'}</div>
                          </div>
                        ) : (
                          <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No simulation runs yet</div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #f1f5f9' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="spot-btn spot-btn-outline"
                        style={{ height: 32, padding: '0 12px', fontSize: 12 }}
                        onClick={() => handleOpenProcess(proc)}
                        aria-label="Open process"
                      >
                        <ExternalLink size={13} />
                        <span>Open</span>
                      </button>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          className="spot-icon-btn"
                          onClick={(e) => handleDuplicateProcess(proc, e)}
                          title="Duplicate process"
                          aria-label="Duplicate process"
                          disabled={duplicatingId === pId}
                        >
                          {duplicatingId === pId ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                        </button>
                        <button
                          type="button"
                          className="spot-icon-btn danger"
                          onClick={() => setDeleteConfirmProcess(proc)}
                          title="Delete process"
                          aria-label="Delete process"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 5) Recent Activity below list with 24px top margin */}
          <div className="spot-activity-section">
            <h3 className="spot-activity-title">
              <Activity size={16} color="#5E43F3" />
              <span>Recent activity</span>
            </h3>

            {recentActivity.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0', fontStyle: 'italic' }}>
                No recent simulation runs or scenarios recorded yet.
              </div>
            ) : (
              <div className="spot-activity-list">
                {recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="spot-activity-row"
                    onClick={() => handleOpenActivity(item)}
                    title={`Open ${item.title}`}
                  >
                    <div className="spot-activity-left">
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: item.type === 'run' ? '#f5f3ff' : '#f0fdf4',
                          color: item.type === 'run' ? '#5E43F3' : '#166534',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {item.type === 'run' ? <Play size={15} /> : <Shuffle size={15} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                          {item.title}
                        </div>
                        {item.processTitle && (
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {item.processTitle}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="spot-activity-right">
                      {item.metric && (
                        <span className="spot-badge" style={{ background: '#f1f5f9', color: '#475569' }}>
                          {item.metric}
                        </span>
                      )}
                      <span>{formatRelativeTime(item.date)}</span>
                      <ArrowRight size={14} color="#94a3b8" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Scenarios Tab Content (Module P2) */}
      {activeTab === 'scenarios' && (
        <div className="spot-table-container" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {isAnalystView ? "What-If Scenarios" : "Ideas to Try"}
            </h2>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {allScenarios.length} {isAnalystView ? "total scenarios" : "total ideas"}
            </span>
          </div>
          {allScenarios.length === 0 ? (
            <div className="spot-empty-state" style={{ padding: '36px 16px' }}>
              <Shuffle size={32} color="#94a3b8" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                {isAnalystView ? "No scenarios found" : "No ideas found"}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', maxWidth: 360, lineHeight: 1.4 }}>
                {isAnalystView
                  ? "Scenarios created from the Modeler or Assistant will appear here once saved under your account."
                  : "Ideas created from the Process Studio or Assistant will appear here once saved under your account."}
              </div>
            </div>
          ) : (
            <table className="spot-table">
              <thead>
                <tr>
                  <th className="spot-table-th">Name</th>
                  <th className="spot-table-th">{isAnalystView ? "Base process" : "Source process"}</th>
                  <th className="spot-table-th">Created</th>
                  <th className="spot-table-th">Last run</th>
                  <th className="spot-table-th" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allScenarios.map((scen) => (
                  <tr key={scen._id} className="spot-table-tr" onClick={() => {
                    const bId = scen.baseProcessId?._id || scen.baseProcessId;
                    if (bId) localStorage.setItem('spot:processId', bId.toString());
                    localStorage.setItem('spot:activeScenarioId', scen._id.toString());
                    navigate('/scenarios');
                  }}>
                    <td className="spot-table-td" style={{ fontWeight: 600, color: '#0f172a' }}>
                      {formatPlainLanguage(scen.title, { isAnalystView })}
                    </td>
                    <td className="spot-table-td" style={{ color: '#475569' }}>
                      {scen.baseProcessId?.title || '—'}
                    </td>
                    <td className="spot-table-td" style={{ color: '#64748b' }}>
                      {formatRelativeTime(scen.createdAt)}
                    </td>
                    <td className="spot-table-td" style={{ color: '#64748b' }}>
                      {scen.lastRun?.summary?.avg_cycle_time ? fmtTime(scen.lastRun.summary.avg_cycle_time) : '—'}
                    </td>
                    <td className="spot-table-td" style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="spot-btn spot-btn-outline"
                        style={{ height: 28, padding: '0 8px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const bId = scen.baseProcessId?._id || scen.baseProcessId;
                          if (bId) localStorage.setItem('spot:processId', bId.toString());
                          localStorage.setItem('spot:activeScenarioId', scen._id.toString());
                          navigate('/scenarios');
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Run History Tab Content */}
      {activeTab === 'runs' && (
        <div className="spot-table-container" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {isAnalystView ? "Simulation Run History" : "Test Run History"}
            </h2>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {recentRuns.length} {isAnalystView ? "runs recorded" : "test runs recorded"}
            </span>
          </div>
          {recentRuns.length === 0 ? (
            <div className="spot-empty-state" style={{ padding: '36px 16px' }}>
              <Play size={32} color="#94a3b8" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                {isAnalystView ? "No simulation runs yet" : "No test runs yet"}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', maxWidth: 360, lineHeight: 1.4 }}>
                {isAnalystView
                  ? "Run simulations from the Simulate page or Assistant to track performance runs here."
                  : "Run tests from the Test page or Assistant to track performance runs here."}
              </div>
            </div>
          ) : (
            <table className="spot-table">
              <thead>
                <tr>
                  <th className="spot-table-th">Title</th>
                  <th className="spot-table-th">{isAnalystView ? "Cycle time" : <Hint term="cycle_time">Time to complete</Hint>}</th>
                  <th className="spot-table-th">Wait time</th>
                  <th className="spot-table-th">{isAnalystView ? "Throughput" : <Hint term="throughput">Customers / hr</Hint>}</th>
                  <th className="spot-table-th">Date</th>
                  <th className="spot-table-th" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr
                    key={run._id}
                    className="spot-table-tr"
                    onClick={() => navigate(`/results?runId=${run._id}`)}
                  >
                    <td className="spot-table-td" style={{ fontWeight: 600, color: '#0f172a' }}>
                      {formatPlainLanguage(run.title, { isAnalystView }) || (isAnalystView ? 'Simulation Run' : 'Test Run')}
                    </td>
                    <td className="spot-table-td">
                      {run.summary?.avg_cycle_time ? fmtTime(run.summary.avg_cycle_time) : (run.summary?.cycleTime ? fmtTime(run.summary.cycleTime) : '—')}
                    </td>
                    <td className="spot-table-td">
                      {run.summary?.avg_wait_time ? fmtTime(run.summary.avg_wait_time) : '—'}
                    </td>
                    <td className="spot-table-td">
                      {run.summary?.throughput_rate ? fmtThroughput(run.summary.throughput_rate) : (run.summary?.throughput ? fmtThroughput(run.summary.throughput) : '—')}
                    </td>
                    <td className="spot-table-td" style={{ color: '#64748b' }}>
                      {formatRelativeTime(run.createdAt)}
                    </td>
                    <td className="spot-table-td" style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="spot-btn spot-btn-outline"
                        style={{ height: 28, padding: '0 8px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/results?runId=${run._id}`);
                        }}
                      >
                        Results
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Delete Process Confirmation Dialog */}
      {deleteConfirmProcess && (
        <div className="spot-modal-overlay" onClick={() => setDeleteConfirmProcess(null)}>
          <div className="spot-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: '#dc2626' }}>
              <AlertTriangle size={20} />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                Delete Process
              </h3>
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              Are you sure you want to delete <strong>&ldquo;{deleteConfirmProcess.title || 'Untitled Process'}&rdquo;</strong>? This will permanently delete the process and its associated data.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="spot-btn spot-btn-outline"
                onClick={() => setDeleteConfirmProcess(null)}
                disabled={Boolean(deletingId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="spot-btn spot-btn-outline"
                style={{ borderColor: '#fca5a5', color: '#dc2626', background: '#fef2f2' }}
                onClick={handleConfirmDeleteProcess}
                disabled={Boolean(deletingId)}
              >
                {deletingId ? 'Deleting…' : 'Delete process'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
