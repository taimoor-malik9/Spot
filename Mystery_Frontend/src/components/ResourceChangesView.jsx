import React from 'react';
import { ArrowRight, Users, CheckCircle2, Clock, Layers } from 'lucide-react';

export default function ResourceChangesView({
  changes = [],
  taskChanges = [],
  task_changes = [],
  target = null,
  title = 'Changes from baseline',
  isCompact = false,
  showTitle = true,
  onResourceClick = null,
  onTaskClick = null,
}) {
  const changeList = Array.isArray(changes) ? changes : [];
  const taskList = Array.isArray(taskChanges) && taskChanges.length > 0
    ? taskChanges
    : (Array.isArray(task_changes) ? task_changes : []);

  // Helper to format color and badges for resources
  const getResourceBadgeStyle = (item) => {
    const dir = item.direction;
    if (dir === 'increase' || dir === 'new') {
      return {
        bg: '#dcfce7',
        color: '#15803d',
        border: '#bbf7d0',
        prefix: item.delta > 0 && !String(item.delta_text || '').startsWith('+') ? '+' : '',
      };
    }
    if (dir === 'decrease' || dir === 'removed') {
      return {
        bg: '#fef2f2',
        color: '#dc2626',
        border: '#fecaca',
        prefix: '',
      };
    }
    // edit / cost / schedule -> amber
    return {
      bg: '#fef3c7',
      color: '#b45309',
      border: '#fde68a',
      prefix: '',
    };
  };

  // Helper to format badge for task duration
  const getTaskBadgeStyle = (item) => {
    const dir = item.direction;
    if (dir === 'decrease') {
      return {
        bg: '#dcfce7',
        color: '#15803d',
        border: '#bbf7d0',
      };
    }
    return {
      bg: '#fef2f2',
      color: '#dc2626',
      border: '#fecaca',
    };
  };

  const targetPct = target?.target_pct ?? (typeof target === 'number' ? target : null);
  const targetMetric = target?.metric ? target.metric.replace('_', ' ') : 'improvement';
  const targetDir = target?.direction === 'increase' ? '+' : '-';

  return (
    <div
      data-testid="resource-changes-section"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: isCompact ? 10 : 12,
        padding: isCompact ? '12px 14px' : '16px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Main Header with Title and Target */}
      {showTitle && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: '#f5f3ff',
                color: '#6b4de6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Layers size={15} />
            </div>
            <div>
              <h3
                style={{
                  fontSize: isCompact ? 13.5 : 14.5,
                  fontWeight: 700,
                  color: '#0f172a',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>{title}</span>
              </h3>
            </div>
          </div>

          {targetPct != null && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 999,
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#166534',
                fontSize: 11.5,
                fontWeight: 700,
              }}
            >
              <span>Target: {targetDir}{targetPct}% {targetMetric}</span>
            </div>
          )}
        </div>
      )}

      {/* SECTION 1: Resource Changes */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Users size={14} color="#6b4de6" />
          <h4 style={{ margin: 0, fontSize: isCompact ? 12.5 : 13.5, fontWeight: 700, color: '#1e293b' }}>
            Resource changes
          </h4>
          {changeList.length > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 999,
                background: '#ede9fe',
                color: '#6b4de6',
              }}
            >
              {changeList.length}
            </span>
          )}
        </div>

        {changeList.length === 0 ? (
          <div
            data-testid="no-resource-changes-msg"
            style={{
              padding: isCompact ? '8px 12px' : '10px 14px',
              borderRadius: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              fontSize: isCompact ? 12 : 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={15} color="#94a3b8" />
            <span>None (No resource changes)</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: isCompact ? 11.5 : 12.5,
                textAlign: 'left',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Resource</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Property</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Before</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>After</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Change</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Affected Tasks</th>
                </tr>
              </thead>
              <tbody>
                {changeList.map((item, index) => {
                  const badge = getResourceBadgeStyle(item);
                  const isClickable = Boolean(onResourceClick);
                  return (
                    <tr
                      key={index}
                      style={{
                        borderBottom: index < changeList.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: index % 2 === 0 ? '#ffffff' : '#fafafa',
                        cursor: isClickable ? 'pointer' : 'default',
                      }}
                      onClick={() => onResourceClick && onResourceClick(item)}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                        <span
                          style={{
                            textDecoration: isClickable ? 'underline' : 'none',
                            color: isClickable ? '#4f46e5' : '#0f172a',
                          }}
                        >
                          {item.name}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>
                        {item.property_label || item.property}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#64748b' }}>
                        {item.before != null ? String(item.before) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                        {item.after != null ? String(item.after) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '2px 7px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {badge.prefix}{item.delta_text || (item.delta > 0 ? `+${item.delta}` : item.delta)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569', fontSize: 11.5 }}>
                        {item.tasks_display || (Array.isArray(item.affected_tasks) && item.affected_tasks.length > 0 ? item.affected_tasks.join(', ') : 'None')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 2: Task Changes */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Clock size={14} color="#6b4de6" />
          <h4 style={{ margin: 0, fontSize: isCompact ? 12.5 : 13.5, fontWeight: 700, color: '#1e293b' }}>
            Task changes
          </h4>
          {taskList.length > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 999,
                background: '#ede9fe',
                color: '#6b4de6',
              }}
            >
              {taskList.length}
            </span>
          )}
        </div>

        {taskList.length === 0 ? (
          <div
            data-testid="no-task-changes-msg"
            style={{
              padding: isCompact ? '8px 12px' : '10px 14px',
              borderRadius: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              fontSize: isCompact ? 12 : 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={15} color="#94a3b8" />
            <span>None</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: isCompact ? 11.5 : 12.5,
                textAlign: 'left',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Task</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Property</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Before</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>After</th>
                  <th style={{ padding: '7px 10px', fontWeight: 600 }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {taskList.map((item, index) => {
                  const badge = getTaskBadgeStyle(item);
                  const isClickable = Boolean(onTaskClick);
                  return (
                    <tr
                      key={index}
                      style={{
                        borderBottom: index < taskList.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: index % 2 === 0 ? '#ffffff' : '#fafafa',
                        cursor: isClickable ? 'pointer' : 'default',
                      }}
                      onClick={() => onTaskClick && onTaskClick(item)}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                        <span
                          style={{
                            textDecoration: isClickable ? 'underline' : 'none',
                            color: isClickable ? '#4f46e5' : '#0f172a',
                          }}
                        >
                          {item.task || item.name || item.label}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>
                        {item.property_label || item.property || 'Duration'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#64748b' }}>
                        {item.before != null ? String(item.before) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                        {item.after != null ? String(item.after) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '2px 7px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.delta_text || (item.delta_pct > 0 ? `+${item.delta_pct}%` : `${item.delta_pct}%`)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
