/**
 * AvanGuard API Service Layer
 * Maps backend responses → frontend types, with graceful fallback to mock data.
 * Backend: FastAPI @ http://localhost:8000
 * All admin endpoints require X-Admin-Key header.
 */

import {
  AuditLogEvent,
  BusinessRule,
  RecommendedRule,
  ReviewQueueItem,
  SystemStats,
} from './types';
import {
  initialStats,
  initialActiveRules,
  initialRecommendedRules,
  initialReviewQueueItems,
  initialAuditLogs,
  initialRecentEvaluationActivity,
} from './initialData';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || '';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'dev-insecure-key-change-me';

const adminHeaders = {
  'Content-Type': 'application/json',
  'X-Admin-Key': ADMIN_KEY,
};

// ─── Operator mapping ────────────────────────────────────────────────────────
// Backend uses: <=, >=, <, >, ==, !=
// Frontend uses: LESS_THAN_EQ, GREATER_THAN_EQ, LESS_THAN, GREATER_THAN, EQUALS, NOT_EQUALS

const backendOpToFrontend = (op: string): BusinessRule['operator'] => {
  const map: Record<string, BusinessRule['operator']> = {
    '<=': 'LESS_THAN',       // frontend has no LESS_THAN_EQ so use LESS_THAN
    '>=': 'GREATER_THAN_EQ',
    '<':  'LESS_THAN',
    '>':  'GREATER_THAN',
    '==': 'EQUALS',
    '!=': 'NOT_EQUALS',
  };
  return map[op] ?? 'EQUALS';
};

const frontendOpToBackend = (op: BusinessRule['operator']): string => {
  const map: Record<BusinessRule['operator'], string> = {
    LESS_THAN:       '<=',
    GREATER_THAN_EQ: '>=',
    GREATER_THAN:    '>',
    EQUALS:          '==',
    NOT_EQUALS:      '!=',
    CONTAINS:        '>=', // no direct equivalent, approximate
  };
  return map[op] ?? '==';
};

// ─── Health check (used to decide if backend is reachable) ───────────────────
export async function fetchHealth(): Promise<{
  status: string;
  ollama: string;
  db: string;
  cache_entries: number;
  active_sessions: number;
} | null> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Metrics → SystemStats ───────────────────────────────────────────────────
export async function fetchStats(): Promise<SystemStats> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return initialStats;
    const d = await res.json();

    const health = await fetchHealth();

    return {
      totalRequests: d.total_requests ?? initialStats.totalRequests,
      totalRequestsDelta: '+live',
      threatsBlocked: (d.blocked_input ?? 0) + (d.blocked_output ?? 0),
      threatsBlockedDelta: '+live',
      queuedForReview: d.queued_for_review ?? 0,
      falsePositiveRate: d.false_positive_rate != null
        ? `${(d.false_positive_rate * 100).toFixed(2)}%`
        : initialStats.falsePositiveRate,
      vectorDbLatency: health ? `${health.cache_entries} cached` : initialStats.vectorDbLatency,
      activeSessions: health?.active_sessions ?? initialStats.activeSessions,
    };
  } catch {
    return initialStats;
  }
}

// ─── Business Rules ──────────────────────────────────────────────────────────
export async function fetchRules(): Promise<BusinessRule[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/rules`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return initialActiveRules;
    const data = await res.json();
    // Backend returns: [{id, target_field, operator, rule_value, description}]
    const rules: BusinessRule[] = (data.rules ?? data ?? []).map((r: any) => ({
      id: String(r.id),
      targetField: r.target_field ?? r.targetField ?? '',
      operator: backendOpToFrontend(r.operator),
      thresholdValue: String(r.rule_value ?? r.value ?? r.thresholdValue ?? ''),
      description: r.description ?? '',
    }));
    return rules.length > 0 ? rules : initialActiveRules;
  } catch {
    return initialActiveRules;
  }
}

export async function createRule(rule: Omit<BusinessRule, 'id'>): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/rules`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        target_field: rule.targetField,
        operator: frontendOpToBackend(rule.operator),
        rule_value: parseFloat(rule.thresholdValue),
        description: rule.description,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteRule(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/rules/${id}`, {
      method: 'DELETE',
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Suggested Rules ─────────────────────────────────────────────────────────
export async function fetchSuggestions(): Promise<RecommendedRule[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/suggestions`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return initialRecommendedRules;
    const data = await res.json();
    const suggestions = data.suggestions ?? data ?? [];
    if (!Array.isArray(suggestions) || suggestions.length === 0) return initialRecommendedRules;
    return suggestions.map((s: any) => ({
      id: String(s.id),
      targetField: s.target_field ?? '',
      operator: backendOpToFrontend(s.operator ?? '<='),
      thresholdValue: String(s.suggested_value ?? ''),
      confidence: Math.round((s.confidence ?? 0.7) * 100),
      description: s.description ?? '',
    }));
  } catch {
    return initialRecommendedRules;
  }
}

export async function approveSuggestion(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/suggestions/${id}/approve`, {
      method: 'POST',
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function rejectSuggestion(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/suggestions/${id}/reject`, {
      method: 'POST',
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Review Queue ─────────────────────────────────────────────────────────────
export async function fetchReviewQueue(): Promise<ReviewQueueItem[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/review-queue`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return initialReviewQueueItems;
    const data = await res.json();
    const items = data.queue ?? data ?? [];
    if (!Array.isArray(items) || items.length === 0) return initialReviewQueueItems;
    return items.map((q: any) => ({
      id: String(q.id),
      timestamp: q.created_at ?? q.timestamp ?? '',
      session: q.session_id ?? q.session ?? '',
      guardStage: q.guard_stage === 'input' ? 'Input Guard' : 'Output Guard',
      confidence: q.guard_score ?? 0.6,
      status: (q.status ?? 'pending').toUpperCase() as ReviewQueueItem['status'],
      promptContent: q.masked_prompt ?? '[redacted]',
      guardReason: q.guard_reason ?? '',
    }));
  } catch {
    return initialReviewQueueItems;
  }
}

export async function approveReview(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/review-queue/${id}/approve`, {
      method: 'POST',
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function rejectReview(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/review-queue/${id}/reject`, {
      method: 'POST',
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Audit Logs ──────────────────────────────────────────────────────────────
// Backend audit_logs table: id, timestamp, masked_input, sanitization_results,
// validation_status, final_output, total_tokens, hallucination_score, canary_id

function mapActionFromBackend(san: any, val: any): AuditLogEvent['action'] {
  const valAction = val?.action_taken ?? '';
  const sanAction = san?.action ?? '';
  if (valAction === 'BLOCKED' || sanAction === 'BLOCK') return 'BLOCK';
  if (valAction === 'QUEUED' || sanAction === 'QUEUED') return 'QUEUED';
  if (sanAction === 'SANITIZE' || san?.has_pii) return 'SANITIZE';
  return 'PASS';
}

function mapGuardStage(san: any, val: any): string {
  if (val?.action_taken === 'BLOCKED') return 'Output Guard';
  if (san?.action === 'BLOCK') return 'Input Guard';
  if (san?.has_pii || san?.action === 'SANITIZE') return 'PII Sanitizer';
  if (san?.suspicious) return 'Session Guard';
  return 'Pipeline';
}

export async function fetchAuditLogs(): Promise<{
  logs: AuditLogEvent[];
  recentActivity: typeof initialRecentEvaluationActivity;
}> {
  try {
    // Backend doesn't have a paginated GET /api/admin/logs endpoint in the
    // original code — the SSE stream is the only log consumer. We attempt it
    // and fall back gracefully.
    const res = await fetch(`${BASE_URL}/api/admin/logs`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { logs: initialAuditLogs, recentActivity: initialRecentEvaluationActivity };

    const data = await res.json();
    const rows = data.logs ?? data ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { logs: initialAuditLogs, recentActivity: initialRecentEvaluationActivity };
    }

    const logs: AuditLogEvent[] = rows.map((r: any) => {
      const san = typeof r.sanitization_results === 'string'
        ? JSON.parse(r.sanitization_results || '{}')
        : (r.sanitization_results ?? {});
      const val = typeof r.validation_status === 'string'
        ? JSON.parse(r.validation_status || '{}')
        : (r.validation_status ?? {});

      const action = mapActionFromBackend(san, val);
      const latencyNum = Math.round(r.total_tokens ?? 0); // use tokens as proxy if no latency col

      return {
        id: `evt_${r.id}`,
        timestamp: r.timestamp ?? '',
        action,
        sessionID: r.session_id ?? 'unknown',
        latencyNum,
        latencyStr: latencyNum ? `${latencyNum}t` : '-',
        guardStage: mapGuardStage(san, val),
        description: val?.reason ?? san?.reason ?? (action === 'PASS' ? 'Request passed all guards.' : 'Guard triggered.'),
        originalPayload: r.masked_input ?? '',
        sanitizedPayload: san?.sanitized_prompt,
        confidenceScore: val?.confidence ?? san?.confidence,
        triggerRule: san?.detected_types?.join(', ') ?? val?.action_taken,
      };
    });

    const recentActivity = logs.slice(0, 5).map((l) => ({
      timestamp: l.timestamp.split(' ')[1] ?? l.timestamp,
      sessionID: l.sessionID,
      guardStage: l.guardStage,
      result: l.action === 'BLOCK' ? 'Blocked' : l.action === 'SANITIZE' ? 'Sanitized' : l.action === 'QUEUED' ? 'Flagged' : 'Pass',
      actionType: l.action,
      latency: l.latencyStr,
    }));

    return { logs, recentActivity };
  } catch {
    return { logs: initialAuditLogs, recentActivity: initialRecentEvaluationActivity };
  }
}

// ─── Backend connectivity status ─────────────────────────────────────────────
export async function checkBackendOnline(): Promise<boolean> {
  const h = await fetchHealth();
  return h !== null;
}
