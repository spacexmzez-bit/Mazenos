// ============================================================================
// MazenOS Phase 1 & 4: Central Cloudflare Worker Router, Hardware Lock & Cron
// File: worker.js
// ============================================================================

import {
  compileStateSnapshot,
  getRiyadhDateString,
  handleChatRequest,
  handleChatHistory,
  handleProviderSwitch
} from './worker-ai.js';
import {
  handleTasksRequest,
  revertUntouchedBonusTasks,
  cascadeConsecutiveDependents
} from './taskitator.js';
import {
  handleProofAuditRequest,
  handleMediaAuditRequest
} from './taskitator-audit.js';
import { handleBudgetRequest } from './budget.js';
import { handleCurryRequest } from './curry.js';
import { handleLocationsRequest } from './locations.js';
import { handleIdeasRequest } from './ideas.js';
import { handleHealthRequest } from './health.js';
import { handleDiaryRequest } from './diary.js';
import { handleLeisureRequest } from './leisure.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MazenOS-Token'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

/**
 * Single-Operator Master Token Verification:
 * Verifies Authorization: Bearer <token> against env.MASTER_TOKEN or D1 master_token.
 */
async function verifyOperatorToken(request, env, db) {
  const configuredToken = env?.MASTER_TOKEN;
  if (!configuredToken) {
    // Check D1 system_settings if MASTER_TOKEN is stored there
    const row = await db.prepare(`SELECT value FROM system_settings WHERE key = 'master_token'`).first().catch(() => null);
    if (!row?.value) return true; // Local/unconfigured bootstrap mode
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim() || request.headers.get('X-MazenOS-Token');
    return token === row.value;
  }

  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim() || request.headers.get('X-MazenOS-Token');
  return bearerToken === configuredToken;
}

/**
 * GET /status — MacroDroid Hardware Lock Endpoint (Organ 10):
 * Polled every 5-15 minutes by Android MacroDroid.
 * Evaluates active P1 tasks, due timestamps, Riyadh regional rest windows, and is_sick status.
 * Returns {"device_unlocked": boolean, "active_task": string|null, "reason": string}.
 */
export async function handleMacroDroidStatus(db) {
  const snapshot = await compileStateSnapshot(db);

  if (snapshot.health.is_sick) {
    return {
      device_unlocked: true,
      active_task: snapshot.active_p1?.title || null,
      reason: 'Sickness Circuit Breaker active (is_sick=true). Device unlocked for recovery.',
      state_snapshot: snapshot
    };
  }

  const nowHHMM = snapshot.time_now.slice(11, 16);
  const [restStart, restEnd] = (snapshot.rest_window || '00:00 - 00:45').split('-').map(s => s.trim());
  const inRestWindow = nowHHMM >= restStart && nowHHMM <= restEnd;

  if (inRestWindow) {
    return {
      device_unlocked: true,
      active_task: snapshot.active_p1?.title || null,
      reason: `Within scheduled Riyadh rest window (${snapshot.rest_window}).`,
      state_snapshot: snapshot
    };
  }

  if (snapshot.locked && snapshot.active_p1) {
    return {
      device_unlocked: false,
      active_task: snapshot.active_p1.title,
      reason: `Overdue P1 task "${snapshot.active_p1.title}" (due ${snapshot.active_p1.due}) requires verified Multimodal Audit Receipt to unlock device.`,
      state_snapshot: snapshot
    };
  }

  return {
    device_unlocked: true,
    active_task: snapshot.active_p1?.title || null,
    reason: snapshot.active_p1
      ? `Active P1 "${snapshot.active_p1.title}" on track (due ${snapshot.active_p1.due || 'flexible'}).`
      : 'No overdue P1 tasks. Device unlocked.',
    state_snapshot: snapshot
  };
}

/**
 * 03:00 AM Asia/Riyadh (00:00 UTC) Daily Scheduled Cron Engine (Organ 10):
 * 1. Resets daily medicine counters and daily entertainment usage for the new date.
 * 2. Reverts untouched bonus tasks back to their original slots with zero penalty.
 * 3. Cascades uncompleted core P1-P3 consecutive chains forward into the new day.
 */
export async function runDailyRiyadhCron(db) {
  const todayDate = getRiyadhDateString(new Date());

  // 1. Initialize new day's health log with reset medicine_taken_count = 0
  await db.prepare(`
    INSERT INTO daily_health_logs (
      date, sleep_hours, energy_rating, is_sick, medicine_target_count, medicine_taken_count, workout_completed
    ) VALUES (?, 7.0, 4, 0, 2, 0, 0)
    ON CONFLICT(date) DO UPDATE SET medicine_taken_count = 0, updated_at = CURRENT_TIMESTAMP
  `).bind(todayDate).run();

  // Reset daily entertainment used counter
  await db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('daily_entertainment_used_mins', '0', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP
  `).run();

  // 2. Revert untouched bonus tasks safely without penalty
  const revertedBonusIds = await revertUntouchedBonusTasks(db);

  // 3. Cascade uncompleted overdue consecutive root tasks into the new day
  const overdueRoots = await db.prepare(`
    SELECT id, due_timestamp, estimated_duration_minutes
    FROM tasks
    WHERE status IN ('pending', 'in_progress')
      AND is_consecutive = 1
      AND is_bonus = 0
      AND (depends_on_task_id IS NULL OR depends_on_task_id = '')
  `).all();

  const cascadedChains = [];
  for (const root of (overdueRoots?.results || [])) {
    const shiftedDueIso = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    await db.prepare(`UPDATE tasks SET due_timestamp = ? WHERE id = ?`).bind(shiftedDueIso, root.id).run();
    const children = await cascadeConsecutiveDependents(db, root.id, shiftedDueIso);
    cascadedChains.push({ root_id: root.id, new_due: shiftedDueIso, children });
  }

  return {
    executed_at_utc: new Date().toISOString(),
    riyadh_date: todayDate,
    medicine_counter_reset: true,
    reverted_bonus_task_ids: revertedBonusIds,
    cascaded_consecutive_chains: cascadedChains
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const db = env.DB;
    const kv = env.KV;

    try {
      // Verify single-operator master token on all API and status endpoints
      const isAuthorized = await verifyOperatorToken(request, env, db);
      if (!isAuthorized) {
        return jsonResponse({ error: 'UNAUTHORIZED_OPERATOR_TOKEN' }, 401);
      }

      // 1. MacroDroid Hardware Lock Polling Endpoint
      if (url.pathname === '/status' && request.method === 'GET') {
        const statusPayload = await handleMacroDroidStatus(db);
        return jsonResponse(statusPayload, 200);
      }

      // 2. Manual Cron Trigger Endpoint (for testing or administrative rebalance)
      if (url.pathname === '/api/cron/daily' && request.method === 'POST') {
        const cronSummary = await runDailyRiyadhCron(db);
        return jsonResponse(cronSummary, 200);
      }

      // 3. Dual-Agent Chat, Sliding Window & Session Rollback
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        const res = await handleChatRequest(request, db, env);
        return jsonResponse(res.data, res.status);
      }
      if (url.pathname === '/api/chat/history' || url.pathname === '/api/chat/rollback') {
        const res = await handleChatHistory(request, url, db);
        return jsonResponse(res.data, res.status);
      }
      if (url.pathname === '/api/settings/provider' && request.method === 'POST') {
        const res = await handleProviderSwitch(request, db);
        return jsonResponse(res.data, res.status);
      }

      // 4. Native Taskitator Core & Bonus Queue
      if (url.pathname.startsWith('/api/tasks')) {
        const res = await handleTasksRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      // 5. Multimodal Proof Audit & NewPipe Task-Aware Video Audit
      if (url.pathname === '/api/audit/media' && request.method === 'POST') {
        const res = await handleMediaAuditRequest(request, db, env);
        return jsonResponse(res.data, res.status);
      }
      if (url.pathname === '/api/audit' && request.method === 'POST') {
        const res = await handleProofAuditRequest(request, db, env);
        return jsonResponse(res.data, res.status);
      }

      // 6. Zero-Cost Bank SMS Regex Parser & Budget Ledger
      if (url.pathname.startsWith('/api/budget')) {
        const res = await handleBudgetRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      // 7. Smart Curriculum Assistant ("Curry")
      if (url.pathname.startsWith('/api/curry')) {
        const res = await handleCurryRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      // 8. Study Locations & Commute Friction Gatekeeper
      if (url.pathname.startsWith('/api/locations')) {
        const res = await handleLocationsRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      // 9. Distraction Confinement & 3-Minute Idea Vault
      if (url.pathname.startsWith('/api/ideas')) {
        const res = await handleIdeasRequest(request, url, db, kv);
        return jsonResponse(res.data, res.status);
      }

      // 10. Circadian Health, Medicine Tracker & Sickness Circuit Breaker
      if (url.pathname.startsWith('/api/health')) {
        const res = await handleHealthRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      // 11. Personal Diary & Longitudinal Mindset Analysis
      if (url.pathname.startsWith('/api/diary')) {
        const res = await handleDiaryRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      // 12. Leisure, Pomodoro Biological Maintenance & Weekly Retrospective
      if (
        url.pathname.startsWith('/api/leisure') ||
        url.pathname.startsWith('/api/focus') ||
        url.pathname.startsWith('/api/retrospective')
      ) {
        const res = await handleLeisureRequest(request, url, db);
        return jsonResponse(res.data, res.status);
      }

      return jsonResponse({ error: 'NOT_FOUND', path: url.pathname }, 404);
    } catch (err) {
      return jsonResponse({
        error: 'WORKER_UNHANDLED_EXCEPTION',
        message: err.message || 'Internal Worker Error'
      }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyRiyadhCron(env.DB));
  }
};
