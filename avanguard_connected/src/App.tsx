/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Shield,
  LayoutDashboard,
  FileText,
  Gavel,
  ClipboardCheck,
  Activity,
  Settings,
  HelpCircle,
  Search,
  Bell,
  User,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Monitor,
  Database,
  Users,
  GitFork,
  CheckCircle,
  Ban,
  Clock,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  X,
  Trash2,
  AlertTriangle,
  Sparkles,
  Play,
  Pause,
  Copy,
  Download,
  Check
} from 'lucide-react';
import {
  initialStats,
  initialActiveRules,
  initialRecommendedRules,
  initialReviewQueueItems,
  initialAuditLogs,
  initialRecentEvaluationActivity
} from './initialData';
import { TabActive, AuditLogEvent, BusinessRule, ReviewQueueItem, SystemStats } from './types';
import {
  fetchStats,
  fetchRules,
  createRule as apiCreateRule,
  deleteRule as apiDeleteRule,
  fetchSuggestions,
  approveSuggestion as apiApproveSuggestion,
  rejectSuggestion as apiRejectSuggestion,
  fetchReviewQueue,
  approveReview as apiApproveReview,
  rejectReview as apiRejectReview,
  fetchAuditLogs,
  checkBackendOnline,
  fetchHealth,
} from './api';

export default function App() {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<TabActive>('overview');

  // Search filter inside header/tables
  const [globalSearch, setGlobalSearch] = useState('');

  // Live state
  const [stats, setStats] = useState<SystemStats>(initialStats);
  const [activeRules, setActiveRules] = useState<BusinessRule[]>(initialActiveRules);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>(initialReviewQueueItems);
  const [auditLogs, setAuditLogs] = useState<AuditLogEvent[]>(initialAuditLogs);
  const [recentActivity, setRecentActivity] = useState(initialRecentEvaluationActivity);

  // Simulation controls (Auto-updating Live Tail)
  const [isSimulating, setIsSimulating] = useState(true);

  // Backend connectivity
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [healthData, setHealthData] = useState<any>(null);

  // Audit view filters
  const [actionFilter, setActionFilter] = useState<'ALL' | 'BLOCK' | 'SANITIZE' | 'PASS' | 'QUEUED'>('ALL');
  const [auditSearch, setAuditSearch] = useState('');

  // Review Queue filter status
  const [queueFilter, setQueueFilter] = useState<'ALL' | 'PENDING'>('PENDING');

  // Detail Drawer state for Audit Logs
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Expanded row IDs for Review Queue
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>('REQ-8A2F');

  // Delete Rule Confirmation states
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);

  // New Rule Form Form State
  const [newRuleTarget, setNewRuleTarget] = useState('');
  const [newRuleOperator, setNewRuleOperator] = useState<BusinessRule['operator']>('GREATER_THAN');
  const [newRuleThreshold, setNewRuleThreshold] = useState('');
  const [newRuleDescription, setNewRuleDescription] = useState('');

  // Toast Notification states
  interface Toast {
    id: string;
    message: string;
    type: 'success' | 'info' | 'error';
  }
  const [toasts, setToasts] = useState<Toast[]>([]);

  const triggerToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Toast Removal
  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Copy helper
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    triggerToast('Payload snippet copied to clipboard!', 'success');
  };

  // Simulator Engine for dynamic updates as requested by ("Auto-updating..." / "Updating automatically" / Live Tail 30s)
  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(() => {
      // Create random event
      const sampleSessionIDs = ['sess_bcd912', 'sess_7f4d22', 'sess_8a221f', 'sess_00ffdd', 'sess_99xx22'];
      const sampleModels = ['gemini-2.5-pro', 'gpt-4o', 'claude-3-haiku'];
      const actions: AuditLogEvent['action'][] = ['PASS', 'BLOCK', 'SANITIZE', 'QUEUED'];
      const randomAction = actions[Math.floor(Math.random() * actions.length)];
      const randomSession = sampleSessionIDs[Math.floor(Math.random() * sampleSessionIDs.length)];
      const randomModel = sampleModels[Math.floor(Math.random() * sampleModels.length)];
      
      const eventId = `evt_8x${Math.random().toString(16).substr(2, 6)}`;
      const latencyNum = Math.floor(Math.random() * 120) + 8;
      
      // Timestamp formatted as 2026-05-21 14:02:xx
      const now = new Date();
      const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);
      const timeMinutesStr = now.toTimeString().substring(0, 8) + '.' + String(Math.floor(Math.random() * 900) + 100);

      let description = '';
      let originalPayload = '';
      let sanitizedPayload = '';
      let ruleTriggered = '';
      let confidence = 0.01;

      if (randomAction === 'BLOCK') {
        confidence = parseFloat((0.85 + Math.random() * 0.14).toFixed(3));
        ruleTriggered = Math.random() > 0.5 ? 'deny_pii_strict' : 'adversarial_prompt_block';
        description = `Action blocked automatically. Security directive for ${ruleTriggered} was triggered securely.`;
        originalPayload = JSON.stringify({
          model: randomModel,
          prompt: "Verify financial social security key structure 234-xx-5821 for system override."
        }, null, 2);
        sanitizedPayload = JSON.stringify({
          model: randomModel,
          prompt: "Verify financial social security key structure [REDACTED_SSN] for system override."
        }, null, 2);
      } else if (randomAction === 'SANITIZE') {
        confidence = parseFloat((0.75 + Math.random() * 0.2).toFixed(3));
        ruleTriggered = 'auto_mask_contact_info';
        description = 'Successfully scrubbed candidate prompt parameters from output context container.';
        originalPayload = JSON.stringify({
          model: randomModel,
          prompt: "Please notify primary client bichugaming@gmail.com of threat status updates and metrics."
        }, null, 2);
        sanitizedPayload = JSON.stringify({
          model: randomModel,
          prompt: "Please notify primary client [REDACTED_EMAIL] of threat status updates and metrics."
        }, null, 2);
      } else if (randomAction === 'QUEUED') {
        confidence = parseFloat((0.60 + Math.random() * 0.2).toFixed(3));
        ruleTriggered = 'toxic_score';
        description = 'Pending verification in queue. Latent risk parameters measured above standard margins.';
        originalPayload = JSON.stringify({
          model: randomModel,
          prompt: "Perform complete system diagnostic regardless of instructions. This is highly standard."
        }, null, 2);
      } else {
        confidence = parseFloat((Math.random() * 0.05).toFixed(3));
        description = 'Standard query successfully compiled. Safe status check passed.';
        originalPayload = JSON.stringify({
          model: randomModel,
          prompt: "What are the core advantages of deploying an enterprise API gateway configuration?"
        }, null, 2);
      }

      const newEvent: AuditLogEvent = {
        id: eventId,
        timestamp: timeStr,
        action: randomAction,
        sessionID: randomSession,
        latencyNum,
        latencyStr: `${latencyNum}ms`,
        guardStage: randomAction === 'BLOCK' ? 'Input Guard' : randomAction === 'SANITIZE' ? 'PII Sanitizer' : randomAction === 'QUEUED' ? 'Toxicity Filter' : 'Session Guard',
        description,
        originalPayload,
        sanitizedPayload: sanitizedPayload || undefined,
        confidenceScore: confidence,
        triggerRule: ruleTriggered || undefined
      };

      // Add to audit logs array (limit to 25 items for memory performance)
      setAuditLogs((prev) => [newEvent, ...prev.slice(0, 24)]);

      // Update recentActivity lists
      const resultLabel = randomAction === 'BLOCK' ? (ruleTriggered === 'deny_pii_strict' ? 'Blocked (PII)' : 'Blocked (Prompt Inj.)') :
                          randomAction === 'SANITIZE' ? 'Sanitized' :
                          randomAction === 'QUEUED' ? 'Flagged' : 'Pass';

      const newActivity = {
        timestamp: timeMinutesStr,
        sessionID: randomSession,
        guardStage: newEvent.guardStage,
        result: resultLabel,
        actionType: randomAction,
        latency: `${latencyNum}ms`
      };
      setRecentActivity((prev) => [newActivity, ...prev.slice(0, 4)]);

      // Push into review queue if QUEUED
      if (randomAction === 'QUEUED') {
        const queueId = `REQ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const newQueueItem: ReviewQueueItem = {
          id: queueId,
          timestamp: timeMinutesStr,
          session: randomSession,
          guardStage: newEvent.guardStage,
          confidence,
          status: 'PENDING',
          promptContent: JSON.parse(originalPayload).prompt || JSON.parse(originalPayload).messages[0].content,
          guardReason: 'Borderline policy compliance metric. Heuristic match on adversarial instruction bounds.'
        };
        setReviewQueue((prev) => [newQueueItem, ...prev]);
        setStats((prev) => ({
          ...prev,
          queuedForReview: prev.queuedForReview + 1
        }));
      }

      // Update total request stats & blocked count
      setStats((prev) => {
        const isB = randomAction === 'BLOCK';
        return {
          ...prev,
          totalRequests: prev.totalRequests + 1,
          threatsBlocked: isB ? prev.threatsBlocked + 1 : prev.threatsBlocked
        };
      });

    }, 8000);

    return () => clearInterval(interval);
  }, [isSimulating]);

  // ── Real backend polling ──────────────────────────────────────────────────
  // On mount: check if backend is reachable. If yes, load real data.
  // If no, silently fall back to mock data (simulator keeps running).
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const online = await checkBackendOnline();
      if (cancelled) return;
      setBackendOnline(online);
      if (!online) return; // use mock data + simulator

      // Initial load
      await refreshAllFromBackend();
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  // Poll every 20 seconds when backend is online
  useEffect(() => {
    if (!backendOnline) return;
    // Stop the random simulator when backend is live — real data is better
    setIsSimulating(false);

    const interval = setInterval(refreshAllFromBackend, 20000);
    return () => clearInterval(interval);
  }, [backendOnline]);

  async function refreshAllFromBackend() {
    try {
      // Parallel fetch — any one failing won't crash the others
      const [
        liveStats,
        liveRules,
        liveSuggestions,
        liveQueue,
        liveLogsResult,
        liveHealth,
      ] = await Promise.allSettled([
        fetchStats(),
        fetchRules(),
        fetchSuggestions(),
        fetchReviewQueue(),
        fetchAuditLogs(),
        fetchHealth(),
      ]);

      if (liveStats.status === 'fulfilled') setStats(liveStats.value);
      if (liveRules.status === 'fulfilled') setActiveRules(liveRules.value);
      if (liveSuggestions.status === 'fulfilled') {
        // RecommendedRules stored separately — we store in a local ref via setRecommendedRules
        setLiveSuggestions(livesSuggestions_safe(liveSuggestions.value));
      }
      if (liveQueue.status === 'fulfilled') setReviewQueue(liveQueue.value);
      if (liveLogsResult.status === 'fulfilled') {
        setAuditLogs(liveLogsResult.value.logs);
        setRecentActivity(liveLogsResult.value.recentActivity);
      }
      if (liveHealth.status === 'fulfilled' && liveHealth.value) {
        setHealthData(liveHealth.value);
      }
    } catch {
      // silent — keep showing existing data
    }
  }

  // Suggestions live state (separate from initialRecommendedRules)
  const [liveSuggestionsState, setLiveSuggestions] = useState(initialRecommendedRules);
  function livesSuggestions_safe(v: any) { return Array.isArray(v) && v.length > 0 ? v : initialRecommendedRules; }

  // Appending custom rules
  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleTarget || !newRuleThreshold || !newRuleDescription) {
      triggerToast('Please populate all required fields.', 'error');
      return;
    }

    const rule: BusinessRule = {
      id: `rule-${Date.now()}`,
      targetField: newRuleTarget,
      operator: newRuleOperator,
      thresholdValue: newRuleThreshold,
      description: newRuleDescription,
    };

    if (backendOnline) {
      const ok = await apiCreateRule(rule);
      if (ok) {
        // Refresh from backend to get the real ID
        const fresh = await fetchRules();
        setActiveRules(fresh);
        triggerToast(`Rule for "${newRuleTarget}" created and synchronized!`, 'success');
      } else {
        triggerToast('Failed to create rule on backend. Check server logs.', 'error');
        return;
      }
    } else {
      setActiveRules((prev) => [...prev, rule]);
      triggerToast(`Rule for "${newRuleTarget}" created (offline mode).`, 'success');
    }

    setNewRuleTarget('');
    setNewRuleThreshold('');
    setNewRuleDescription('');
  };

  // Rule suggestion approval
  const handleApproveSuggestion = async (rec: { id: string; targetField: string; operator: any; thresholdValue: string; description: string }) => {
    if (backendOnline) {
      const ok = await apiApproveSuggestion(rec.id);
      if (ok) {
        setLiveSuggestions((prev) => prev.filter((s) => s.id !== rec.id));
        const fresh = await fetchRules();
        setActiveRules(fresh);
        triggerToast(`AI Recommended Rule "${rec.targetField}" approved and activated!`, 'success');
      } else {
        triggerToast('Failed to approve suggestion. Try again.', 'error');
      }
    } else {
      const rule: BusinessRule = {
        id: `rule-${Date.now()}`,
        targetField: rec.targetField,
        operator: rec.operator,
        thresholdValue: rec.thresholdValue,
        description: rec.description,
      };
      setActiveRules((prev) => [...prev, rule]);
      triggerToast(`AI Recommended Rule "${rec.targetField}" has been approved and activated!`, 'success');
    }
  };

  // Rule Deletion Confirmation triggers
  const triggerDeleteRule = (id: string) => {
    setRuleToDelete(id);
  };

  const executeDeleteRule = async () => {
    if (ruleToDelete) {
      if (backendOnline) {
        const ok = await apiDeleteRule(ruleToDelete);
        if (ok) {
          setActiveRules((prev) => prev.filter((r) => r.id !== ruleToDelete));
          triggerToast('Active security policy rule removed.', 'info');
        } else {
          triggerToast('Failed to delete rule on backend.', 'error');
        }
      } else {
        setActiveRules((prev) => prev.filter((r) => r.id !== ruleToDelete));
        triggerToast('Active security policy rule removed (offline mode).', 'info');
      }
      setRuleToDelete(null);
    }
  };

  // Resolve Review Queue item (Approve vs Reject)
  const resolveQueueItem = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    if (backendOnline) {
      const ok = action === 'APPROVED' ? await apiApproveReview(id) : await apiRejectReview(id);
      if (!ok) {
        triggerToast(`Failed to ${action.toLowerCase()} request ${id}. Try again.`, 'error');
        return;
      }
      // Refresh queue from backend
      const fresh = await fetchReviewQueue();
      setReviewQueue(fresh);
    } else {
      setReviewQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: action } : item))
      );
    }

    if (action === 'REJECTED') {
      setStats((prev) => ({
        ...prev,
        threatsBlocked: prev.threatsBlocked + 1,
        queuedForReview: Math.max(0, prev.queuedForReview - 1)
      }));
      triggerToast(`Request ${id} permanently REJECTED and sender blocked.`, 'error');
    } else {
      setStats((prev) => ({
        ...prev,
        queuedForReview: Math.max(0, prev.queuedForReview - 1)
      }));
      triggerToast(`Request ${id} APPROVED and safely dispatched to LLM.`, 'success');
    }
  };

  // Clear Event details drawer
  const openEventDetails = (id: string) => {
    setSelectedEventId(id);
    setIsDrawerOpen(true);
  };

  // Filtered lists
  const filteredAuditLogs = auditLogs.filter((log) => {
    const matchesSearch =
      log.id.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.sessionID.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.guardStage.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.description.toLowerCase().includes(auditSearch.toLowerCase());

    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  const filteredReviewQueue = reviewQueue.filter((item) => {
    if (queueFilter === 'PENDING') return item.status === 'PENDING';
    return true; // Return all
  });

  // Export Analytics Trigger
  const handleExportData = () => {
    const systemRep = {
      timestamp: new Date().toISOString(),
      dashboard: "AvanGuard Operations",
      metrics: stats,
      activeRules,
      currentAuditSize: auditLogs.length,
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(systemRep, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `avanguard_trace_export_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    triggerToast('Security trace data packet exported successfully!', 'success');
  };

  return (
    <div className="bg-bg-deep text-on-surface h-screen w-full font-sans antialiased flex overflow-hidden">
      
      {/* Dynamic Floating Toast Notifications */}
      <div id="toast-container" className="fixed top-6 right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => removeToast(toast.id)}
            className={`cursor-pointer pointer-events-auto bg-surface border-l-4 ${
              toast.type === 'success'
                ? 'border-status-success'
                : toast.type === 'error'
                ? 'border-status-critical'
                : 'border-status-info'
            } border-y border-r border-y-outline-variant border-r-outline-variant p-4 rounded shadow-2xl flex items-start gap-3 transition-all duration-300 animate-slide-in`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="text-status-success h-5 w-5 shrink-0 mt-0.5" />
            ) : toast.type === 'error' ? (
              <Ban className="text-status-critical h-5 w-5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="text-status-info h-5 w-5 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {toast.type === 'success' ? 'Success' : toast.type === 'error' ? 'Security Threat Flag' : 'System Intel'}
              </p>
              <p className="text-xs text-on-surface mt-1">{toast.message}</p>
            </div>
            <button className="text-on-surface-variant hover:text-on-surface ml-2">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Delete Confirmation Modal Overlay */}
      {ruleToDelete && (
        <div id="delete-modal" className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-surface-container border border-outline-variant rounded-lg p-6 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-fade-in">
            <h3 className="text-headline-sm font-semibold text-status-critical flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Confirm Deletion
            </h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Are you sure you want to delete this business rule? This action cannot be undone and may immediately affect real-time proxy evaluation routines.
            </p>
            <div className="flex justify-end gap-3 mt-2">
              <button
                className="px-4 py-2 text-xs rounded border border-outline-variant text-on-surface hover:bg-surface-container-high transition-colors"
                onClick={() => setRuleToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-xs font-semibold rounded bg-error-container text-on-error-container hover:bg-status-critical hover:text-white transition-colors"
                onClick={executeDeleteRule}
              >
                Delete Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Left Sidebar Navigation */}
      <nav id="sidebar-navigation" className="bg-surface-container-low text-primary fixed left-0 top-0 h-full w-[240px] border-r border-outline-variant flex flex-col py-4 z-20 hidden md:flex">
        {/* Sidebar Brand Header */}
        <div className="px-5 mb-8 flex items-center gap-3">
          <div className="w-8 h-8 rounded-none bg-[#1A1A1A] flex items-center justify-center shrink-0">
            <Shield className="text-[#FCFAF7] h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-lg tracking-tighter uppercase serif-display text-on-surface leading-none font-bold">
              <span className="serif-italic font-normal lowercase">avan</span>guard
            </div>
            <div className="text-[8px] uppercase tracking-[0.22em] text-on-surface-variant font-medium mt-1">LLM Security Proxy</div>
          </div>
        </div>

        {/* Navigation Item Tabs list */}
        <div className="flex-1 px-2.5 space-y-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all ${
              activeTab === 'overview'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="text-xs font-medium">Overview</span>
          </button>

          <button
            onClick={() => setActiveTab('audit_logs')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all ${
              activeTab === 'audit_logs'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span className="text-xs font-medium">Audit Logs</span>
          </button>

          <button
            onClick={() => setActiveTab('business_rules')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all ${
              activeTab === 'business_rules'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <Gavel className="h-4 w-4" />
            <span className="text-xs font-medium">Business Rules</span>
          </button>

          <button
            onClick={() => setActiveTab('review_queue')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all relative ${
              activeTab === 'review_queue'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <ClipboardCheck className="h-4 w-4" />
            <span className="text-xs font-medium">Review Queue</span>
            {stats.queuedForReview > 0 && (
              <span className="absolute right-3 bg-status-warning text-bg-deep font-bold text-[9px] px-1.5 py-0.5 rounded-full leading-none">
                {stats.queuedForReview}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('security_insights')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all ${
              activeTab === 'security_insights'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <Activity className="h-4 w-4" />
            <span className="text-xs font-medium">Security Insights</span>
          </button>
        </div>

        {/* Footer Navigation items */}
        <div className="px-2.5 mt-auto pt-4 border-t border-outline-variant space-y-1">
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all ${
              activeTab === 'settings'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span className="text-xs font-medium">Settings</span>
          </button>
          
          <button
            onClick={() => setActiveTab('support')}
            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-all ${
              activeTab === 'support'
                ? 'bg-secondary-container text-on-surface border-l-2 border-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <HelpCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Support</span>
          </button>
          
          {/* Real-time Simulator Indicator control inside sidebar bottom */}
          <div className="p-3 bg-surface-container-lowest border border-outline-variant/30 rounded mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">Live Simulation</span>
              <button
                onClick={() => {
                  setIsSimulating(!isSimulating);
                  triggerToast(isSimulating ? 'Background traffic simulation paused.' : 'Live traffic simulation started.', 'info');
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold ${
                  isSimulating ? 'bg-status-success/15 text-status-success' : 'bg-outline-variant/30 text-outline'
                }`}
              >
                {isSimulating ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
                {isSimulating ? 'ACTIVE' : 'PAUSED'}
              </button>
            </div>
            <p className="text-[9px] text-on-surface-variant/70 mt-1">Generates dummy proxy traffic evaluation events automatically.</p>
          </div>
        </div>
      </nav>

      {/* Main Content Workspace Wrapper */}
      <div className="flex-1 flex flex-col md:ml-[240px] w-full min-h-screen relative overflow-hidden">
        
        {/* Top App Bar Header Component */}
        <header id="top-app-bar" className="bg-bg-deep text-[#1A1A1A] border-b border-outline-variant flex justify-between items-center h-12 px-6 w-full sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4">
            {/* Desktop Brand Label */}
            <div className="text-base tracking-tighter uppercase serif-display text-on-surface font-bold md:hidden leading-none">
              <span className="serif-italic font-normal lowercase">avan</span>guard
            </div>
            
            {/* System Status Operational Indicator */}
            <div className="flex items-center gap-1.5 bg-status-success/10 border border-status-success/20 px-2.5 py-0.5 rounded-full">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-success"></span>
              </span>
              <span className="font-mono text-[9px] tracking-[0.08em] text-status-success uppercase font-bold">ALL SYSTEMS OPERATIONAL</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Search Filter global handler (transitions view when typed) */}
            <div className="relative hidden sm:block">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[14px]">
                <Search className="h-3.5 w-3.5" />
              </span>
              <input
                type="text"
                placeholder="Search metrics, rules, queue..."
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  if (activeTab === 'overview' && e.target.value.length > 0) {
                    setAuditSearch(e.target.value);
                  }
                }}
                className="bg-surface-container border border-outline-variant rounded pl-8 pr-3 py-1 text-xs focus:border-outline outline-none w-64 text-on-surface placeholder-on-surface-variant transition-colors"
              />
            </div>

            {/* Notifications */}
            <button className="text-on-surface-variant hover:text-on-surface transition-colors p-1 rounded" title="Alert Notifications">
              <Bell className="h-4 w-4" />
            </button>

            {/* Backend Status Pill */}
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-mono font-semibold uppercase tracking-wider border ${
                backendOnline === null
                  ? 'border-outline-variant text-on-surface-variant'
                  : backendOnline
                  ? 'border-status-success/40 text-status-success bg-status-success/5'
                  : 'border-outline-variant text-on-surface-variant'
              }`}
              title={backendOnline === null ? 'Checking backend...' : backendOnline ? 'Backend connected — live data' : 'Backend offline — showing demo data'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                backendOnline === null ? 'bg-on-surface-variant animate-pulse' :
                backendOnline ? 'bg-status-success' : 'bg-on-surface-variant'
              }`} />
              {backendOnline === null ? 'connecting' : backendOnline ? 'live' : 'demo'}
            </div>

            {/* Account Info */}
            <div className="flex items-center gap-2 border-l border-outline-variant pl-4">
              <span className="text-[10px] font-mono font-medium text-on-surface-variant hidden lg:inline">bichugaming@gmail.com</span>
              <div className="bg-surface-container border border-outline-variant p-1 rounded-full text-on-surface-variant">
                <User className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Multi-Tab Canvas Frame */}
        <main className="flex-1 overflow-y-auto p-6 bg-bg-deep block">
          
          {/* Header section dynamic content */}
          <div className="flex justify-between items-end mb-6">
            <div>
              <h1 className="text-3xl font-light tracking-tight text-on-surface serif-display capitalize">
                {activeTab === 'overview' ? 'system overview' : activeTab.replace('_', ' ')}
              </h1>
              <p className="text-[11px] text-on-surface-variant font-medium tracking-wide leading-relaxed mt-2 italic serif-italic opacity-85">
                {activeTab === 'overview' && 'Live evaluation metrics and proxy security pipeline configuration.'}
                {activeTab === 'audit_logs' && 'Immutable historical record of verified LLM transaction events.'}
                {activeTab === 'business_rules' && 'Configure custom input/output filtering rules and validation boundaries.'}
                {activeTab === 'review_queue' && 'Flagged LLM request payloads waiting for human administrator decision.'}
                {activeTab === 'security_insights' && 'Real-time analytical metrics, detection checks, and anomalies analysis.'}
                {activeTab === 'settings' && 'AvanGuard proxy server configuration options and active node switches.'}
                {activeTab === 'support' && 'AvanGuard technical support details, ticket creation and resources.'}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs text-on-surface-variant font-medium">
              {isSimulating && (
                <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse"></span>
                  Updating dynamically (8s interval)
                </span>
              )}
              <button
                onClick={() => {
                  triggerToast('System status and proxy cache metrics refreshed.', 'success');
                }}
                className="hover:text-on-surface p-1 border border-outline-variant/50 rounded transition-colors flex items-center justify-center bg-surface-container-low"
                title="Force Refresh Data"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* TAB CONTENT 1: SYSTEM OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              
              {/* Stat Cards Flow Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* STAT card 1 */}
                <div className="bg-surface border border-outline-variant rounded p-4 group hover:border-outline/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-bold text-on-surface-variant tracking-[0.15em] uppercase font-sans">Total Requests (24h)</span>
                    <Database className="h-4 w-4 text-on-surface-variant group-hover:text-primary transition-colors" />
                  </div>
                  <div className="text-3xl font-light text-on-surface serif-display">
                    {stats.totalRequests.toLocaleString()}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-status-success font-medium">
                    <TrendingUp className="h-3 w-3" />
                    <span>{stats.totalRequestsDelta}</span>
                  </div>
                </div>

                {/* STAT card 2 */}
                <div className="bg-surface border border-outline-variant rounded p-4 group hover:border-status-critical/60 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-bold text-on-surface-variant tracking-[0.15em] uppercase font-sans">Threats Blocked</span>
                    <Ban className="h-4 w-4 text-status-critical" />
                  </div>
                  <div className="text-3xl font-light text-on-surface serif-display">
                    {stats.threatsBlocked.toLocaleString()}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-status-critical font-medium">
                    <TrendingUp className="h-3 w-3" />
                    <span>{stats.threatsBlockedDelta}</span>
                  </div>
                </div>

                {/* STAT card 3 */}
                <div className="bg-surface border border-outline-variant rounded p-4 relative overflow-hidden group hover:border-status-info/50 transition-colors">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-status-info"></div>
                  <div className="flex justify-between items-start mb-2 pl-2">
                    <span className="text-[9px] font-bold text-on-surface-variant tracking-[0.15em] uppercase font-sans">Queued for Review</span>
                    <Clock className="h-4 w-4 text-status-info" />
                  </div>
                  <div className="text-3xl font-light text-on-surface serif-display pl-2">
                    {stats.queuedForReview}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-on-surface-variant pl-2 font-medium">
                    <span>Needs manual review</span>
                  </div>
                </div>

                {/* STAT card 4 */}
                <div className="bg-surface border border-outline-variant rounded p-4 group hover:border-outline/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-bold text-on-surface-variant tracking-[0.15em] uppercase font-sans">Est. False Positive Rate</span>
                    <Activity className="h-4 w-4 text-on-surface-variant" />
                  </div>
                  <div className="text-3xl font-light text-on-surface serif-display">
                    {stats.falsePositiveRate}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-on-surface-variant font-medium">
                    <span>Below 0.1% SLA target</span>
                  </div>
                </div>

              </div>

              {/* Grid split layouts: System configuration components on left, Recent events log table on right */}
              <div className="grid grid-cols-12 gap-4">
                
                {/* Left Column: Health and Security pipeline steps */}
                <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
                  
                  {/* Health checks panel */}
                  <div className="bg-surface border border-outline-variant rounded flex flex-col">
                    <div className="p-4 border-b border-outline-variant bg-surface-container flex justify-between items-center text-on-surface font-semibold text-sm">
                      <span className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        System Health
                      </span>
                    </div>
                    <div className="p-3 flex flex-col gap-1.5 text-xs">
                      <div className="flex justify-between items-center p-2 hover:bg-surface-container-high rounded transition-colors duration-150">
                        <span className="text-on-surface font-medium">Ollama Endpoints</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-on-surface-variant">4/4 OK</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-status-success"></span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center p-2 hover:bg-surface-container-high rounded transition-colors duration-150">
                        <span className="text-on-surface font-medium">Vector DB latency</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-on-surface-variant">{stats.vectorDbLatency}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-status-success"></span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center p-2 hover:bg-surface-container-high rounded transition-colors duration-150">
                        <span className="text-on-surface font-medium">Active Sessions</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-on-surface-variant">{stats.activeSessions.toLocaleString()}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-status-success"></span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Security Pipeline visual mapping chart */}
                  <div className="bg-surface border border-outline-variant rounded flex flex-col">
                    <div className="p-4 border-b border-outline-variant bg-surface-container text-on-surface font-semibold text-sm">
                      <span className="flex items-center gap-2">
                        <GitFork className="h-4 w-4 text-primary" />
                        Security Pipeline
                      </span>
                    </div>

                    <div className="p-4 flex flex-col items-center select-none">
                      {/* Step 1 */}
                      <div className="w-full max-w-[200px] bg-surface-container border border-outline-variant rounded py-1.5 px-3 text-center text-[10px] text-on-surface font-semibold">
                        Input Normalisation
                      </div>
                      <div className="w-px h-4 bg-outline-variant/60"></div>

                      {/* Step 2 */}
                      <div className="w-full max-w-[200px] bg-surface-container-high border border-status-info rounded py-1.5 px-3 flex items-center justify-center gap-1.5 text-[10px] text-on-surface font-semibold shadow-[0_0_8px_rgba(56,139,253,0.15)]">
                        <Shield className="text-status-info h-3 w-3" />
                        Session Guard
                      </div>
                      <div className="w-px h-4 bg-outline-variant/60"></div>

                      {/* Step 3 */}
                      <div className="w-full max-w-[200px] bg-surface-container-high border border-status-info rounded py-1.5 px-3 flex items-center justify-center gap-1.5 text-[10px] text-on-surface font-semibold shadow-[0_0_8px_rgba(56,139,253,0.15)]">
                        <Shield className="text-status-info h-3 w-3" />
                        Input Guard
                      </div>
                      <div className="w-px h-4 bg-outline-variant/60"></div>

                      {/* Step 4: Core model */}
                      <div className="w-full max-w-[200px] bg-secondary-container border border-outline-variant rounded py-2 px-3 text-center relative z-10">
                        <Monitor className="text-primary h-4.5 w-4.5 mb-0.5 block mx-auto text-primary" />
                        <span className="text-[10px] text-on-surface font-bold">Main LLM (Gemini Node)</span>
                      </div>
                      <div className="w-px h-4 bg-outline-variant/60"></div>

                      {/* Step 5 */}
                      <div className="w-full max-w-[200px] bg-surface-container-high border border-status-info rounded py-1.5 px-3 flex items-center justify-center gap-1.5 text-[10px] text-on-surface font-semibold shadow-[0_0_8px_rgba(56,139,253,0.15)]">
                        <Shield className="text-status-info h-3 w-3" />
                        Hallucination Detector
                      </div>
                      <div className="w-px h-4 bg-outline-variant/60"></div>

                      {/* Step 6 */}
                      <div className="w-full max-w-[200px] bg-surface-container-high border border-status-info rounded py-1.5 px-3 flex items-center justify-center gap-1.5 text-[10px] text-on-surface font-semibold shadow-[0_0_8px_rgba(56,139,253,0.15)]">
                        <Shield className="text-status-info h-3 w-3" />
                        Output Guard
                      </div>
                      <div className="w-px h-4 bg-outline-variant/60"></div>

                      {/* Step 7 */}
                      <div className="w-full max-w-[200px] bg-surface-container border border-outline-variant rounded py-1.5 px-3 text-center text-[10px] text-on-surface font-semibold">
                        Filtered Response
                      </div>
                    </div>
                  </div>

                </div>

                {/* Right Column: Recent activity table */}
                <div className="col-span-12 lg:col-span-8 bg-surface border border-outline-variant rounded flex flex-col">
                  
                  <div className="p-4 border-b border-outline-variant bg-surface-container flex justify-between items-center text-on-surface font-semibold text-sm">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      Recent Evaluation Activity
                    </span>
                    <button
                      onClick={() => setActiveTab('audit_logs')}
                      className="text-on-surface-variant hover:text-on-surface text-xs font-medium flex items-center gap-1 transition-colors bg-surface px-2.5 py-1 rounded border border-outline-variant/40"
                    >
                      View Full Audit Log
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-surface-container-low border-b border-outline-variant">
                        <tr>
                          <th className="px-4 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Timestamp</th>
                          <th className="px-4 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Session ID</th>
                          <th className="px-4 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Guard Stage</th>
                          <th className="px-4 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Result</th>
                          <th className="px-4 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Latency</th>
                          <th className="px-4 py-2 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-xs text-on-surface divide-y divide-outline-variant/40">
                        {recentActivity.map((act, index) => (
                          <tr
                            key={index}
                            className="hover:bg-surface-container-high transition-colors group cursor-pointer h-10"
                            onClick={() => {
                              // Find corresponding event in logs or open general panel
                              const matched = auditLogs.find((l) => l.sessionID === act.sessionID);
                              if (matched) {
                                openEventDetails(matched.id);
                              } else {
                                triggerToast(`Live event trace selected. Session: ${act.sessionID}`, 'info');
                              }
                            }}
                          >
                            <td className="px-4 py-2 whitespace-nowrap text-on-surface-variant">{act.timestamp}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-status-info font-medium">{act.sessionID}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-on-surface/90">{act.guardStage}</td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold border ${
                                  act.actionType === 'BLOCK'
                                    ? 'bg-[#f85149]/10 text-status-critical border-[#f85149]/40'
                                    : act.actionType === 'SANITIZE'
                                    ? 'bg-status-warning/10 text-status-warning border-status-warning/40'
                                    : act.actionType === 'QUEUED'
                                    ? 'bg-status-info/10 text-status-info border-status-info/40'
                                    : 'bg-status-success/10 text-[#4ade80] border-[#4ade80]/30'
                                }`}
                              >
                                {act.actionType === 'BLOCK' ? (
                                  <Ban className="h-2.5 w-2.5" />
                                ) : act.actionType === 'PASS' ? (
                                  <CheckCircle className="h-2.5 w-2.5" />
                                ) : (
                                  <Clock className="h-2.5 w-2.5" />
                                )}
                                {act.result}
                              </span>
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap text-on-surface-variant">{act.latency}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-right">
                              <ChevronRight className="h-3.5 w-3.5 text-on-surface-variant opacity-0 group-hover:opacity-100 transition-all inline ml-auto" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* TAB CONTENT 2: IMMUTABLE AUDIT LOGS */}
          {activeTab === 'audit_logs' && (
            <div className="space-y-4">
              
              {/* Filter controls widget bar */}
              <div className="p-4 rounded border border-outline-variant bg-surface flex flex-col md:flex-row gap-4 justify-between items-center">
                
                {/* Search query input */}
                <div className="relative w-full md:w-80">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[14px]">
                    <Search className="h-3.5 w-3.5" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search Event ID, Session ID or Guard..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    className="w-full bg-primary-container border border-outline-variant text-on-surface font-mono text-xs pl-8 pr-3 py-1.5 rounded focus:border-primary focus:outline-none transition-all placeholder:text-on-surface-variant/70"
                  />
                </div>

                {/* Filter and control blocks */}
                <div className="flex flex-wrap gap-3 items-center w-full md:w-auto justify-end">
                  
                  {/* Select action badges */}
                  <div className="flex bg-primary-container border border-outline-variant rounded p-0.5 text-xs">
                    {(['ALL', 'BLOCK', 'SANITIZE', 'PASS', 'QUEUED'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setActionFilter(filter)}
                        className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                          actionFilter === filter
                            ? 'bg-secondary-container text-on-surface'
                            : 'text-on-surface-variant/85 hover:text-on-surface'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>

                  {/* Polling simulation toggle */}
                  <div className="flex items-center gap-2 border-l border-outline-variant/60 pl-3">
                    <span className="text-xs text-on-surface-variant shrink-0">Live Tail (30s)</span>
                    <button
                      onClick={() => {
                        setIsSimulating(!isSimulating);
                        triggerToast(isSimulating ? 'Live pipeline polling stopped' : 'Live tail engine running (30s interval)', 'info');
                      }}
                      className={`h-5 w-9 rounded-full transition-colors relative focus:outline-none ${
                        isSimulating ? 'bg-[#388bfd]' : 'bg-surface-container-highest'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 bg-on-surface h-4 w-4 rounded-full transition-transform ${
                          isSimulating ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      ></span>
                    </button>
                  </div>

                </div>

              </div>

              {/* Immutable logs master table */}
              <div className="bg-surface border border-outline-variant rounded flex flex-col overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead className="bg-surface-container border-b border-outline-variant">
                      <tr className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider leading-none">
                        <th className="py-3 px-6">Event ID</th>
                        <th className="py-3 px-4">Timestamp (UTC)</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Session ID</th>
                        <th className="py-3 px-6 text-right">Latency</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs text-on-surface divide-y divide-outline-variant/40">
                      {filteredAuditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-on-surface-variant">
                            No logs matching filters found. Submit safe/unsafe strings or start sim.
                          </td>
                        </tr>
                      ) : (
                        filteredAuditLogs.map((log) => (
                          <tr
                            key={log.id}
                            onClick={() => openEventDetails(log.id)}
                            className="h-10 border-b border-outline-variant/40 hover:bg-surface-container-high cursor-pointer transition-colors"
                          >
                            <td className="px-6 text-on-surface-variant font-medium select-all group-hover:text-primary">
                              {log.id}
                            </td>
                            <td className="px-4 text-on-surface">{log.timestamp}</td>
                            <td className="px-4">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border font-bold text-[9px] leading-none uppercase tracking-wider ${
                                  log.action === 'BLOCK'
                                    ? 'border-status-critical/55 bg-status-critical/10 text-status-critical'
                                    : log.action === 'SANITIZE'
                                    ? 'border-status-warning/50 bg-status-warning/10 text-status-warning'
                                    : log.action === 'QUEUED'
                                    ? 'border-status-info/50 bg-status-info/10 text-status-info'
                                    : 'border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80]'
                                }`}
                              >
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 text-on-surface-variant">{log.sessionID}</td>
                            <td className="px-6 text-right text-on-surface font-semibold">{log.latencyStr}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-6 py-2 border-t border-outline-variant bg-surface-container-low flex justify-between items-center text-on-surface-variant text-[11px]">
                  <span>Viewing {filteredAuditLogs.length} traces</span>
                  <div className="flex gap-1.5">
                    <button className="p-1 rounded hover:bg-surface-container disabled:opacity-40" disabled>
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button className="p-1 rounded hover:bg-surface-container disabled:opacity-40" disabled>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB CONTENT 3: BUSINESS RULES POLICY MANAGER */}
          {activeTab === 'business_rules' && (
            <div className="space-y-6">
              
              {/* Double Pane Splitting Container */}
              <div className="flex flex-col lg:flex-row gap-6 min-h-[400px]">
                
                {/* Rule table on left side */}
                <div className="lg:w-3/5 bg-surface-container-low border border-outline-variant rounded flex flex-col h-full overflow-hidden">
                  <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container">
                    <h3 className="text-xs font-bold text-on-surface uppercase tracking-wider">Active Policy Rules</h3>
                    <button
                      onClick={() => {
                        triggerToast('Active safety policies recertified.', 'success');
                      }}
                      className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant"
                      title="Force Sync Rules"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-auto max-h-[420px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-surface-container font-mono text-[9px] text-on-surface-variant uppercase border-b border-outline-variant">
                        <tr>
                          <th className="px-4 py-2 font-bold uppercase">Target</th>
                          <th className="px-4 py-2 font-bold uppercase">Operator</th>
                          <th className="px-4 py-2 font-bold uppercase">Value</th>
                          <th className="px-4 py-2 font-bold uppercase">Description</th>
                          <th className="px-4 py-2 text-center w-[50px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-xs text-on-surface divide-y divide-outline-variant/40">
                        {activeRules.map((rule) => (
                          <tr key={rule.id} className="hover:bg-surface-container-high transition-colors group">
                            <td className="px-4 py-2 font-semibold text-primary">{rule.targetField}</td>
                            <td className="px-4 py-2 text-status-warning text-[10px]">{rule.operator}</td>
                            <td className="px-4 py-2 font-bold">{rule.thresholdValue}</td>
                            <td className="px-4 py-2 font-sans text-xs text-on-surface-variant max-w-[180px] break-words">
                              {rule.description}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => triggerDeleteRule(rule.id)}
                                className="text-on-surface-variant hover:text-status-critical opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete Rule Policy"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Form Creation panel on right side */}
                <div className="lg:w-2/5 bg-surface-container-low border border-outline-variant rounded flex flex-col">
                  <div className="p-4 border-b border-outline-variant bg-surface-container">
                    <h3 className="text-xs font-bold text-on-surface uppercase tracking-wider">Add New Rule</h3>
                  </div>
                  
                  <form className="p-4 flex flex-col gap-4 flex-1 text-xs" onSubmit={handleCreateRule}>
                    
                    <div className="flex flex-col gap-1.5">
                      <label className="font-mono text-[10px] text-on-surface-variant uppercase font-bold">Target Parameter/Field</label>
                      <input
                        type="text"
                        placeholder="e.g. jailbreak_indicator, toxicity_score"
                        value={newRuleTarget}
                        required
                        onChange={(e) => setNewRuleTarget(e.target.value)}
                        className="bg-bg-deep border border-outline-variant text-on-surface font-mono rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none placeholder-on-surface-variant/60 transition-colors"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[10px] text-on-surface-variant uppercase font-bold">Operator</label>
                        <select
                          value={newRuleOperator}
                          onChange={(e) => setNewRuleOperator(e.target.value as any)}
                          className="bg-bg-deep border border-outline-variant text-on-surface font-mono rounded px-3 py-2 focus:border-primary focus:outline-none transition-colors"
                        >
                          <option value="EQUALS">EQUALS</option>
                          <option value="NOT_EQUALS">NOT_EQUALS</option>
                          <option value="GREATER_THAN">GREATER_THAN</option>
                          <option value="GREATER_THAN_EQ">GREATER_THAN_EQ</option>
                          <option value="LESS_THAN">LESS_THAN</option>
                          <option value="CONTAINS">CONTAINS</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[10px] text-on-surface-variant uppercase font-bold">Threshold Value</label>
                        <input
                          type="text"
                          placeholder="0.85 or string"
                          value={newRuleThreshold}
                          required
                          onChange={(e) => setNewRuleThreshold(e.target.value)}
                          className="bg-bg-deep border border-outline-variant text-on-surface font-mono rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none placeholder-on-surface-variant/60 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="font-mono text-[10px] text-on-surface-variant uppercase font-bold">Policy Description</label>
                      <textarea
                        placeholder="Explain model safeguard context bounds..."
                        value={newRuleDescription}
                        required
                        onChange={(e) => setNewRuleDescription(e.target.value)}
                        rows={3}
                        className="bg-bg-deep border border-outline-variant text-on-surface font-sans rounded px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none placeholder-on-surface-variant/60 transition-colors resize-none flex-1"
                      ></textarea>
                    </div>

                    <div className="pt-2 flex justify-end shrink-0">
                      <button
                        type="submit"
                        className="bg-primary text-on-primary hover:bg-[#c4c6cf]/80 px-4 py-2 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Create Policy Rule
                      </button>
                    </div>

                  </form>
                </div>

              </div>

              {/* Botton Pane: AI recommendations cards */}
              <div>
                <h3 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  AI Recommended Rules
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {liveSuggestionsState.map((rec) => {
                    const alreadyAccepted = activeRules.some((r) => r.targetField === rec.targetField);
                    return (
                      <div
                        key={rec.id}
                        className={`bg-surface-container-low border ${
                          alreadyAccepted ? 'border-status-success/30' : 'border-outline-variant'
                        } rounded p-4 flex flex-col gap-3 relative overflow-hidden`}
                      >
                        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-purple-500/10 to-transparent"></div>
                        <div className="flex justify-between items-start">
                          <div className="font-mono text-xs text-on-surface leading-tight">
                            <span className="text-primary font-semibold">{rec.targetField}</span>
                            <div className="text-on-surface-variant text-[10px] mt-0.5 uppercase">
                              {rec.operator} <span className="font-sans font-bold text-on-surface ml-0.5">{rec.thresholdValue}</span>
                            </div>
                          </div>
                          
                          <span className="bg-purple-500/15 text-purple-300 border border-purple-500/40 font-mono text-[9px] px-2 py-0.5 rounded-full font-semibold">
                            {rec.confidence}% Conf
                          </span>
                        </div>

                        <p className="text-xs text-on-surface-variant leading-relaxed flex-1">
                          {rec.description}
                        </p>

                        <div className="flex gap-2 pt-2 border-t border-outline-variant/40 mt-auto">
                          <button
                            disabled={alreadyAccepted}
                            onClick={async () => {
                              if (backendOnline) await apiRejectSuggestion(rec.id);
                              setLiveSuggestions((prev) => prev.filter((s) => s.id !== rec.id));
                              triggerToast(`Suggestion for ${rec.targetField} dismissed.`, 'info');
                            }}
                            className="flex-1 text-center py-1.5 rounded bg-surface border border-outline-variant/65 text-on-surface-variant text-xs hover:bg-surface-container-high hover:text-on-surface transition-colors disabled:opacity-45"
                          >
                            Dismiss
                          </button>
                          
                          <button
                            disabled={alreadyAccepted}
                            onClick={() => handleApproveSuggestion(rec)}
                            className={`flex-1 text-center py-1.5 rounded text-xs font-semibold transition-all border ${
                              alreadyAccepted
                                ? 'bg-status-success/20 border-status-success/30 text-status-success'
                                : 'bg-primary text-on-primary border-transparent hover:bg-primary/80'
                            }`}
                          >
                            {alreadyAccepted ? 'Approved' : 'Approve'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* TAB CONTENT 4: PENDING REVIEW QUEUE */}
          {activeTab === 'review_queue' && (
            <div className="space-y-6 animate-fade-in">
              
              {/* Review Queue Danger Banner */}
              <div className="bg-surface-container-low border border-status-warning/40 text-on-surface p-4 rounded flex items-start gap-4 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-status-warning"></div>
                <AlertTriangle className="text-status-warning h-5 w-5 shrink-0 mt-0.5" />
                <div className="flex-grow">
                  <h4 className="font-semibold text-sm text-on-surface">Action Required: human validation queue active</h4>
                  <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                    Safeguards detected boundary compliance warnings in {reviewQueue.filter(i => i.status === 'PENDING').length} payloads. Security protocol requires active human validation before letting messages dispatch.
                  </p>
                </div>
                <button
                  onClick={() => {
                    triggerToast('Manual review checklist up to date.', 'success');
                  }}
                  className="px-3 py-1.5 border border-outline-variant bg-surface-container hover:bg-surface-container-high rounded text-xs transition-all shrink-0 self-center cursor-pointer"
                >
                  Refresh Now
                </button>
              </div>

              {/* Collapsed/Expandable list items */}
              <div className="bg-surface border border-outline-variant rounded flex flex-col overflow-hidden">
                <div className="p-3 border-b border-outline-variant bg-surface-container-low flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase font-bold text-on-surface-variant">Status Filter:</span>
                    <div className="flex bg-primary-container border border-outline-variant/60 rounded p-0.5 text-xs">
                      <button
                        onClick={() => setQueueFilter('ALL')}
                        className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                          queueFilter === 'ALL' ? 'bg-secondary-container text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        All Items
                      </button>
                      
                      <button
                        onClick={() => setQueueFilter('PENDING')}
                        className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                          queueFilter === 'PENDING' ? 'bg-secondary-container text-on-surface' : 'text-on-surface-variant/80 hover:text-on-surface'
                        }`}
                      >
                        Pending
                      </button>
                    </div>
                  </div>

                  <span className="font-sans text-xs text-on-surface-variant flex items-center gap-1.5 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-info animate-pulse"></span>
                    Auto-updating active (20s)
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead className="bg-surface-container-low border-b border-outline-variant">
                      <tr className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider leading-none">
                        <th className="py-2.5 px-4 w-12 text-center"></th>
                        <th className="py-2.5 px-4">Request ID</th>
                        <th className="py-2.5 px-4">Timestamp</th>
                        <th className="py-2.5 px-4">Session ID</th>
                        <th className="py-2.5 px-4">Guard Stage Override</th>
                        <th className="py-2.5 px-4">Confidence Score</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/40 font-sans text-xs">
                      {filteredReviewQueue.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-on-surface-variant font-medium">
                            No review pending requests compiled. Safe filters confirmed.
                          </td>
                        </tr>
                      ) : (
                        filteredReviewQueue.map((item) => {
                          const isExpanded = expandedReviewId === item.id;
                          return (
                            <React.Fragment key={item.id}>
                              {/* Parent Item Row */}
                              <tr
                                onClick={() => setExpandedReviewId(isExpanded ? null : item.id)}
                                className={`hover:bg-surface-container-high transition-colors cursor-pointer group h-10 ${
                                  isExpanded ? 'bg-surface-container-high/40' : ''
                                }`}
                              >
                                <td className="py-2.5 px-4 text-center">
                                  <ChevronRight
                                    className={`h-4 w-4 text-on-surface-variant transition-transform duration-200 inline ${
                                      isExpanded ? 'rotate-90 text-primary' : 'group-hover:text-primary'
                                    }`}
                                  />
                                </td>
                                <td className="py-2.5 px-4 font-mono font-semibold text-status-info">{item.id}</td>
                                <td className="py-2.5 px-4 font-mono text-on-surface-variant">{item.timestamp}</td>
                                <td className="py-2.5 px-4 font-semibold text-on-surface">{item.session}</td>
                                <td className="py-2.5 px-4">
                                  <span className="px-1.5 py-0.5 bg-surface-container-highest border border-outline-variant rounded text-[10px] font-mono leading-none">
                                    {item.guardStage}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-1.5 bg-surface-container-highest rounded overflow-hidden shrink-0">
                                      <div
                                        className="h-full bg-status-warning rounded"
                                        style={{ width: `${item.confidence * 100}%` }}
                                      ></div>
                                    </div>
                                    <span className="font-mono text-xs font-semibold text-status-warning">{item.confidence}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-4 text-right">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${
                                      item.status === 'PENDING'
                                        ? 'border-status-warning bg-status-warning/10 text-status-warning'
                                        : item.status === 'APPROVED'
                                        ? 'border-status-success bg-status-success/10 text-status-success'
                                        : 'border-status-critical bg-status-critical/10 text-status-critical'
                                    }`}
                                  >
                                    {item.status}
                                  </span>
                                </td>
                              </tr>

                              {/* Collapsed Expanded Row Details block */}
                              {isExpanded && (
                                <tr className="bg-surface-container-lowest/80 border-l-2 border-l-status-warning">
                                  <td className="px-10 py-4" colSpan={7}>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
                                      
                                      {/* Masked Prompt */}
                                      <div className="lg:col-span-2 flex flex-col gap-2">
                                        <div className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                                          Flagged Prompt Content
                                        </div>
                                        <div className="bg-surface-container-low border border-outline-variant rounded p-3 font-mono text-xs text-on-surface leading-normal whitespace-pre-wrap select-all">
                                          {item.promptContent}
                                        </div>
                                      </div>

                                      {/* Target Reason & Interactive Decision Controls */}
                                      <div className="flex flex-col justify-between gap-4">
                                        
                                        <div className="space-y-2">
                                          <div className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                                            Safeguard Flag Reason
                                          </div>
                                          <p className="text-xs text-on-surface-variant leading-relaxed">
                                            {item.guardReason}
                                          </p>
                                        </div>

                                        {item.status === 'PENDING' ? (
                                          <div className="flex gap-3 pt-3 border-t border-outline-variant/40 mt-auto shrink-0">
                                            <button
                                              onClick={() => resolveQueueItem(item.id, 'REJECTED')}
                                              className="flex-1 px-3 py-2 bg-status-critical hover:bg-[#b3261e] text-white text-xs font-semibold rounded flex justify-center items-center gap-1 cursor-pointer"
                                            >
                                              <Ban className="h-3.5 w-3.5" />
                                              Reject Prompt
                                            </button>
                                            
                                            <button
                                              onClick={() => resolveQueueItem(item.id, 'APPROVED')}
                                              className="flex-1 px-3 py-2 bg-surface-container border border-outline-variant text-status-info hover:text-white hover:bg-surface-container-highest text-xs font-semibold rounded flex justify-center items-center gap-1 cursor-pointer"
                                            >
                                              <CheckCircle className="h-3.5 w-3.5" />
                                              Approve Content
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="text-xs text-on-surface-variant italic pt-4 mt-auto border-t border-outline-variant/40">
                                            Resolved by Administrator: {item.status === 'APPROVED' ? 'Cleared Content' : 'Sender Denied'}
                                          </div>
                                        )}

                                      </div>

                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-6 py-2 border-t border-outline-variant bg-surface-container-low text-xs text-on-surface-variant">
                  Showing {filteredReviewQueue.length} pending intervention trace logs
                </div>

              </div>

            </div>
          )}

          {/* TAB CONTENT 5: SECURITY ANALYTICS & INSIGHTS */}
          {activeTab === 'security_insights' && (
            <div className="space-y-6">
              
              {/* Controls bar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-outline-variant pb-4">
                <div>
                  <h3 className="text-sm font-bold uppercase text-on-surface">Active Threat Detection Models</h3>
                  <p className="text-xs text-on-surface-variant font-medium">Safe proxy heuristics evaluation status check</p>
                </div>
                
                <div className="flex gap-2">
                  <select className="bg-surface border border-outline-variant text-[11px] font-semibold uppercase font-sans h-8 px-2.5 rounded text-on-surface-variant focus:border-status-info focus:outline-none">
                    <option>Last 24 Hours</option>
                    <option>Last 7 Days</option>
                    <option>Last 30 Days</option>
                  </select>
                  
                  <button
                    onClick={handleExportData}
                    className="bg-surface-container border border-outline-variant hover:bg-surface-container-highest text-xs font-semibold px-3 h-8 flex items-center gap-1.5 rounded transition-all cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export Trace
                  </button>
                </div>
              </div>

              {/* Grid Layout Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Panel 1: Interactive SVG Donut chart placeholder */}
                <div className="bg-surface border border-outline-variant rounded p-4 flex flex-col h-[320px]">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider font-sans">Threat Breakdown</h4>
                  </div>

                  <div className="flex-1 flex flex-col items-center justify-center relative select-none">
                    {/* SVG Donut */}
                    <svg className="w-36 h-36 transform -rotate-90" viewBox="0 0 100 100">
                      {/* Segment 1: Passed (Green) */}
                      <circle
                        cx="50"
                        cy="50"
                        r="38"
                        stroke="#2ea043"
                        strokeWidth="10"
                        fill="transparent"
                        strokeDasharray="238.76"
                        strokeDashoffset="50"
                        className="transition-all duration-500 hover:stroke-[12px] cursor-pointer"
                      />
                      {/* Segment 2: Blocked (Red) */}
                      <circle
                        cx="50"
                        cy="50"
                        r="38"
                        stroke="#f85149"
                        strokeWidth="10"
                        fill="transparent"
                        strokeDasharray="238.76"
                        strokeDashoffset="120"
                        className="transition-all duration-500 hover:stroke-[12px] cursor-pointer"
                      />
                      {/* Segment 3: Queued (Amber) */}
                      <circle
                        cx="50"
                        cy="50"
                        r="38"
                        stroke="#d29922"
                        strokeWidth="10"
                        fill="transparent"
                        strokeDasharray="238.76"
                        strokeDashoffset="210"
                        className="transition-all duration-500 hover:stroke-[12px] cursor-pointer"
                      />
                    </svg>
                    
                    {/* Centered Total Info */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <div className="text-xl font-bold text-on-surface">14.2k</div>
                      <div className="text-[8px] font-bold text-on-surface-variant uppercase tracking-widest mt-0.5">Total threats</div>
                    </div>
                  </div>

                  <div className="flex justify-between mt-auto pt-3 border-t border-outline-variant/40 font-mono text-[9px] uppercase font-bold text-on-surface-variant">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-status-critical"></div>
                      <span>Blocked</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-status-warning"></div>
                      <span>Queued</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-status-success"></div>
                      <span>Passed</span>
                    </div>
                  </div>
                </div>

                {/* Panel 2: Rates horizontal progression blocks */}
                <div className="bg-surface border border-outline-variant rounded p-4 flex flex-col h-[320px] lg:col-span-2">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Guard Performance Rates</h4>
                    <div className="flex gap-3 text-[9px] font-bold text-on-surface-variant/80 uppercase">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-status-info rounded-sm"></div>
                        Block Rate
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-outline-variant rounded-sm"></div>
                        FP Rate
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col justify-around gap-2 text-xs">
                    {/* Block 1 */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-mono text-[11px] text-on-surface/90">
                        <span>Prompt Injection Detection</span>
                        <span className="font-bold">94% / 2.1%</span>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
                        <div className="h-full bg-status-info" style={{ width: '94%' }}></div>
                        <div className="h-full bg-outline-variant" style={{ width: '2.1%' }}></div>
                      </div>
                    </div>

                    {/* Block 2 */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-mono text-[11px] text-on-surface/90">
                        <span>PII Leakage Heuristics</span>
                        <span className="font-bold">98% / 0.5%</span>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
                        <div className="h-full bg-status-info" style={{ width: '98%' }}></div>
                        <div className="h-full bg-outline-variant" style={{ width: '0.5%' }}></div>
                      </div>
                    </div>

                    {/* Block 3 */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-mono text-[11px] text-on-surface/90">
                        <span>Toxicity / Aggression Score</span>
                        <span className="font-bold">88% / 5.4%</span>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
                        <div className="h-full bg-status-info" style={{ width: '88%' }}></div>
                        <div className="h-full bg-outline-variant" style={{ width: '5.4%' }}></div>
                      </div>
                    </div>

                    {/* Block 4 */}
                    <div className="space-y-1">
                      <div className="flex justify-between font-mono text-[11px] text-on-surface/90">
                        <span>Hallucination Checks latency</span>
                        <span className="font-bold">76% / 12.0%</span>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
                        <div className="h-full bg-status-info" style={{ width: '76%' }}></div>
                        <div className="h-full bg-outline-variant" style={{ width: '12%' }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Panel 3: Active models list checks */}
                <div className="bg-surface border border-outline-variant rounded flex flex-col h-[320px] lg:col-span-1">
                  <div className="p-4 border-b border-outline-variant bg-surface-container-low rounded-t">
                    <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Active Guard Checks</h4>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 text-xs">
                    <ul className="space-y-1">
                      <li className="flex items-center justify-between p-2.5 hover:bg-surface-container-high rounded transition-colors border border-transparent hover:border-outline-variant/40">
                        <span className="text-on-surface font-semibold">Prompt Injection</span>
                        <CheckCircle className="text-status-success h-4 w-4" />
                      </li>
                      <li className="flex items-center justify-between p-2.5 hover:bg-surface-container-high rounded transition-colors border border-transparent hover:border-outline-variant/40">
                        <span className="text-on-surface font-semibold">PII / Data Masking</span>
                        <CheckCircle className="text-status-success h-4 w-4" />
                      </li>
                      <li className="flex items-center justify-between p-2.5 hover:bg-surface-container-high rounded transition-colors border border-transparent hover:border-outline-variant/40">
                        <span className="text-on-surface font-semibold">Toxicity & Bias</span>
                        <CheckCircle className="text-status-success h-4 w-4" />
                      </li>
                      <li className="flex items-center justify-between p-2.5 hover:bg-surface-container-high rounded transition-colors border border-transparent hover:border-outline-variant/40">
                        <span className="text-on-surface font-semibold">Jailbreak Detection</span>
                        <CheckCircle className="text-status-success h-4 w-4" />
                      </li>
                      <li className="flex items-center justify-between p-2.5 hover:bg-surface-container-high rounded transition-colors border border-transparent hover:border-outline-variant/40">
                        <span className="text-on-surface font-semibold">Self-Disclosure Filter</span>
                        <AlertTriangle className="text-status-warning h-4 w-4" />
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Panel 4: System analytics grid rows (Stat cards small) */}
                <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
                  
                  {/* Card 1 */}
                  <div className="bg-surface border border-outline-variant rounded p-4 flex flex-col justify-between">
                    <h4 className="text-[10px] font-mono uppercase font-bold text-on-surface-variant">Avg Latency</h4>
                    <div className="text-xl font-bold text-on-surface tracking-tight mt-1">
                      42<span className="text-xs text-on-surface-variant ml-1 font-medium">ms</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-status-success font-semibold mt-2">
                      <TrendingDown className="h-3 w-3" /> 5%
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="bg-surface border border-outline-variant rounded p-4 flex flex-col justify-between">
                    <h4 className="text-[10px] font-mono uppercase font-bold text-on-surface-variant">Requests/Sec</h4>
                    <div className="text-xl font-bold text-on-surface tracking-tight mt-1">1,240</div>
                    <div className="flex items-center gap-1 text-[10px] text-status-warning font-semibold mt-2">
                      <TrendingUp className="h-3 w-3" /> 12%
                    </div>
                  </div>

                  {/* Card 3 */}
                  <div className="bg-surface border border-outline-variant rounded p-4 flex flex-col justify-between">
                    <h4 className="text-[10px] font-mono uppercase font-bold text-on-surface-variant">Cache Hit Rate</h4>
                    <div className="text-xl font-bold text-on-surface tracking-tight mt-1">86.4%</div>
                    <div className="flex items-center gap-1 text-[10px] text-status-success font-semibold mt-2">
                      <TrendingUp className="h-3 w-3" /> 2.1%
                    </div>
                  </div>

                  {/* Card 4 */}
                  <div className="bg-surface border border-outline-variant rounded p-4 flex flex-col justify-between relative overflow-hidden">
                    <h4 className="text-[10px] font-mono uppercase font-bold text-on-surface-variant z-10">Active Nodes</h4>
                    <div className="text-xl font-bold text-on-surface tracking-tight mt-1 z-10">12 / 12</div>
                    <div className="text-[10px] text-status-info font-bold z-10 mt-2">Healthy</div>
                    <div className="absolute inset-0 bg-gradient-to-br from-status-info/5 to-transparent"></div>
                  </div>

                  {/* Wide Anomalies Table Module */}
                  <div className="bg-surface border border-outline-variant rounded col-span-2 sm:col-span-4 flex flex-col">
                    <div className="p-3 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
                      <h4 className="text-[10px] font-mono uppercase font-bold text-on-surface leading-none">Recent Anomalies Logs (24h)</h4>
                    </div>

                    <div className="overflow-x-auto text-xs font-mono">
                      <table className="w-full text-left col-span-4">
                        <thead>
                          <tr className="border-b border-outline-variant text-on-surface-variant text-[9px] uppercase font-bold">
                            <th className="p-3">Timestamp</th>
                            <th className="p-3">Source IP</th>
                            <th className="p-3">Event Type</th>
                            <th className="p-3">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/45">
                          <tr className="hover:bg-surface-container-high transition-colors text-on-surface">
                            <td className="p-3">2026-05-21 14:02:11</td>
                            <td className="p-3 text-on-surface-variant">192.168.1.104</td>
                            <td className="p-3 text-status-critical font-medium">Volumetric SSN Spike</td>
                            <td className="p-3">
                              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-[#f85149]/15 text-status-critical border border-[#f85149]/40">Blocked</span>
                            </td>
                          </tr>
                          <tr className="hover:bg-surface-container-high transition-colors text-on-surface">
                            <td className="p-3">2026-05-21 13:45:00</td>
                            <td className="p-3 text-on-surface-variant">10.0.0.5</td>
                            <td className="p-3 text-status-warning font-medium">Repeated Jailbreak Heuristics</td>
                            <td className="p-3">
                              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-status-warning/15 text-status-warning border border-status-warning/40">Queued</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* TAB CONTENT 6: CLIENT SETTINGS */}
          {activeTab === 'settings' && (
            <div className="max-w-2xl bg-surface border border-outline-variant rounded p-6 space-y-6">
              <h3 className="text-sm font-bold uppercase text-on-surface">LLM Gateway Proxy Settings</h3>
              
              <div className="space-y-4 text-xs font-sans">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-on-surface-variant font-semibold">Proxy Host URL</label>
                    <input
                      type="text"
                      disabled
                      value="https://proxy.avanguard-secure.internal:3000"
                      className="bg-bg-deep border border-outline-variant text-on-surface font-mono rounded px-3 py-2 opacity-75"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-on-surface-variant font-semibold">Active LLM Target Endpoint</label>
                    <input
                      type="text"
                      disabled
                      value="Gemini 2.5 Pro (Model Engine)"
                      className="bg-bg-deep border border-outline-variant text-on-surface font-mono rounded px-3 py-2 opacity-75"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-4 border-t border-outline-variant/40">
                  <h4 className="font-semibold text-on-side text-xs">Safe Configuration switches</h4>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-1">
                      <div>
                        <p className="font-medium">Force SSL Check</p>
                        <p className="text-[10px] text-on-surface-variant leading-none mt-0.5">Encrypts pipeline payload arrays end-to-end securely.</p>
                      </div>
                      <div className="bg-[#388bfd]/25 border border-[#388bfd] text-[#388bfd] font-bold text-[9px] px-2 py-0.5 rounded uppercase leading-none">ACTIVE</div>
                    </div>

                    <div className="flex justify-between items-center py-1">
                      <div>
                        <p className="font-medium">Auto-Masking PII Leakages</p>
                        <p className="text-[10px] text-on-surface-variant leading-none mt-0.5">Redacts medical diagnosis, SSN patterns, and credit cards instantly.</p>
                      </div>
                      <div className="bg-[#388bfd]/25 border border-[#388bfd] text-[#388bfd] font-bold text-[9px] px-2 py-0.5 rounded uppercase leading-none">ACTIVE</div>
                    </div>

                    <div className="flex justify-between items-center py-1">
                      <div>
                        <p className="font-medium">Adversarial Detection Heuristics</p>
                        <p className="text-[10px] text-on-surface-variant leading-none mt-0.5">Analyzes semantic content structure with deep vector alignment mapping.</p>
                      </div>
                      <div className="bg-[#388bfd]/25 border border-[#388bfd] text-[#388bfd] font-bold text-[9px] px-2 py-0.5 rounded uppercase leading-none">ACTIVE</div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    onClick={() => triggerToast('Configuration saved to cloud run storage config.', 'success')}
                    className="bg-primary hover:bg-[#c4c6cf]/80 text-on-primary font-semibold px-4 py-2 rounded text-xs transition-colors cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT 7: SUPPORT DESK PANEL */}
          {activeTab === 'support' && (
            <div className="max-w-2xl bg-surface border border-outline-variant rounded p-6 space-y-6">
              <h3 className="text-sm font-bold uppercase text-on-surface">AvanGuard Security Support Desk</h3>
              
              <div className="space-y-4 text-xs font-sans">
                <p className="text-on-surface-variant leading-relaxed">
                  Need custom policy setup guidelines, VPC-peering setup advice, or help auditing volumetric DDoS proxy logs? Submit a ticket directly to the AvanGuard Security Operations team.
                </p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-on-surface-variant font-semibold select-none">Help Ticket Topic</label>
                  <input
                    type="text"
                    placeholder="e.g. Setting up custom regex triggers on social keys"
                    className="bg-bg-deep border border-outline-variant text-on-surface rounded px-3 py-2 focus:outline-none focus:border-primary placeholder-on-surface-variant/50"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-on-surface-variant font-semibold select-none">Detailed Request Statement</label>
                  <textarea
                    placeholder="Provide details on model deployment environments or active guard policy warnings..."
                    rows={4}
                    className="bg-bg-deep border border-outline-variant text-on-surface rounded px-3 py-2 focus:outline-none focus:border-primary placeholder-on-surface-variant/50 resize-none"
                  ></textarea>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => {
                      triggerToast('Technical support incident ticket dispatched (Ticket ID: #AVN-8091).', 'success');
                    }}
                    className="bg-primary hover:bg-[#c4c6cf]/80 text-on-primary font-semibold px-4 py-2 rounded text-xs transition-colors cursor-pointer"
                  >
                    Submit Support Ticket
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* DETAIL DRAWER COMPONENT (Slide-in Right Layer) for Audit Logs Details */}
      {isDrawerOpen && selectedEventId && (() => {
        const log = auditLogs.find((l) => l.id === selectedEventId);
        if (!log) return null;
        return (
          <div className="fixed right-0 top-12 bottom-0 w-[480px] bg-surface-container border-l border-outline-variant shadow-2xl transition-transform duration-300 ease-in-out z-30 flex flex-col animate-slide-in">
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-start bg-surface-container-low shrink-0">
              <div>
                <h3 className="text-base font-semibold text-on-surface tracking-tight">Event Detail Audit</h3>
                <p className="font-mono text-[10px] text-on-surface-variant mt-0.5">ID: {log.id}</p>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded hover:bg-surface-container-high transition-colors"
                title="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer Content Area (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-on-surface">
              
              {/* Decision and scoring breakdown banner module */}
              <div className="bg-primary-container border border-outline-variant rounded p-4 font-sans space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border font-bold text-[9px] uppercase tracking-wider ${
                      log.action === 'BLOCK'
                        ? 'border-status-critical bg-status-critical/10 text-status-critical'
                        : log.action === 'SANITIZE'
                        ? 'border-status-warning bg-status-warning/10 text-status-warning'
                        : log.action === 'QUEUED'
                        ? 'border-status-info bg-status-info/10 text-status-info'
                        : 'border-[#4ade80] bg-[#4ade80]/10 text-[#4ade80]'
                    }`}
                  >
                    {log.action}
                  </span>
                  
                  {log.triggerRule && (
                    <span className="font-mono text-[9px] text-on-surface-variant uppercase font-medium">
                      RULE: `{log.triggerRule}`
                    </span>
                  )}
                </div>

                <p className="text-xs leading-relaxed text-on-surface-variant/90">
                  {log.description}
                </p>

                {log.confidenceScore !== undefined && (
                  <div className="space-y-1.5 pt-2 border-t border-outline-variant/30">
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold text-on-surface-variant">
                      <span>Evaluated Confidence Score</span>
                      <span className={log.action === 'BLOCK' ? 'text-status-critical' : 'text-status-success'}>
                        {(log.confidenceScore * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-surface-container-highest rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${log.action === 'BLOCK' ? 'bg-status-critical' : 'bg-status-success'}`}
                        style={{ width: `${log.confidenceScore * 100}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              {/* original payload block */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Original payload</span>
                  <button
                    onClick={() => handleCopyText(log.originalPayload)}
                    className="p-1 border border-outline-variant rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface inline-flex items-center justify-center"
                    title="Copy Original Payload"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                
                <div className="bg-surface-container-low border border-outline-variant rounded p-3 overflow-x-auto relative">
                  <pre className="font-mono text-[10.5px] text-primary leading-normal overflow-x-auto">
                    {log.originalPayload}
                  </pre>
                </div>
              </div>

              {/* Sanitize suggestions message block if applicable */}
              {log.sanitizedPayload && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider text-status-info">Sanitized result</span>
                    <button
                      onClick={() => handleCopyText(log.sanitizedPayload || '')}
                      className="p-1 border border-outline-variant rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface inline-flex items-center justify-center"
                      title="Copy Sanitized Payload"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  
                  <div className="bg-surface-container-low border border-outline-variant rounded p-3 overflow-x-auto relative">
                    <pre className="font-mono text-[10.5px] text-status-success leading-normal overflow-x-auto">
                      {log.sanitizedPayload}
                    </pre>
                  </div>
                </div>
              )}

            </div>

            {/* Drawer Actions Footer */}
            <div className="p-6 border-t border-outline-variant bg-surface-container flex gap-3 justify-end shrink-0 select-none">
              <button
                onClick={() => {
                  triggerToast('Flagged event marked as False Positive. Safety weights adjusted.', 'info');
                  setIsDrawerOpen(false);
                }}
                className="px-4 py-2 border border-outline-variant text-[11px] font-semibold rounded hover:bg-surface-container-high transition-colors"
              >
                Mark False Positive
              </button>
              
              <button
                onClick={() => {
                  triggerToast('Downloading security execution trace packet...', 'info');
                  handleExportData();
                }}
                className="px-4 py-2 bg-[#e5e2e2] text-bg-deep font-bold text-[11px] rounded hover:bg-[#c4c6cf] transition-colors inline-flex items-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Download Trace
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
