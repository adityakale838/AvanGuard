/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TabActive =
  | 'overview'
  | 'audit_logs'
  | 'business_rules'
  | 'review_queue'
  | 'security_insights'
  | 'settings'
  | 'support';

export interface AuditLogEvent {
  id: string;
  timestamp: string;      // "YYYY-MM-DD HH:MM:SS.SSS" or relative
  action: 'BLOCK' | 'SANITIZE' | 'PASS' | 'QUEUED';
  sessionID: string;
  latencyNum: number;      // milliseconds
  latencyStr: string;      // "42ms" or "-"
  guardStage: string;      // e.g. "Input Guard", "Hallucination Panel", etc.
  description: string;     // trigger description
  originalPayload: string;  // prompt JSON or string
  sanitizedPayload?: string; // sanitized JSON or string if any
  confidenceScore?: number; // percentage value: e.g. 0.985 for 98.5%
  triggerRule?: string;    // e.g. "deny_pii_strict"
}

export interface BusinessRule {
  id: string;
  targetField: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'CONTAINS' | 'GREATER_THAN_EQ';
  thresholdValue: string;
  description: string;
}

export interface RecommendedRule {
  id: string;
  targetField: string;
  operator: 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'CONTAINS' | 'GREATER_THAN_EQ';
  thresholdValue: string;
  confidence: number; // e.g., 94 for 94%
  description: string;
}

export interface ReviewQueueItem {
  id: string;
  timestamp: string;
  session: string;
  guardStage: string;
  confidence: number; // e.g., 0.85
  status: 'PENDING' | 'REJECTED' | 'APPROVED';
  promptContent: string;
  guardReason: string;
}

export interface SystemStats {
  totalRequests: number;
  totalRequestsDelta: string;
  threatsBlocked: number;
  threatsBlockedDelta: string;
  queuedForReview: number;
  falsePositiveRate: string;
  vectorDbLatency: string;
  activeSessions: number;
}
