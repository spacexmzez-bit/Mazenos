// ============================================================================
// MazenOS Phase 5 (Organs 4, 5, 8): Leisure, Biological Maintenance & Weekly Debrief
// File: leisure.js
// ============================================================================

/**
 * Evaluates continuous focus intervals (Organ 4 Biological Maintenance):
 * If 150-180 minutes (2.5-3 hours) of continuous Pomodoro / Deep Work sessions
 * are logged without an intervening 'break' session, raises an unskippable
 * hydration/nutrition biological maintenance prompt.
 */
export async function checkBiologicalMaintenanceState(db) {
  const recentSessions = await db.prepare(`
    SELECT * FROM focus_sessions
    ORDER BY started_at DESC, rowid DESC
    LIMIT 15
  `).all();

  let continuousWorkMinutes = 0;
  for (const s of (recentSessions?.results || [])) {
    if (s.session_type === 'break') {
      break;
    }
    continuousWorkMinutes += Number(s.duration_minutes) || 25;
  }

  const requiresBioBreak = continuousWorkMinutes >= 150;
  return {
    continuous_focus_minutes: continuousWorkMinutes,
    threshold_minutes: 150,
    biological_maintenance_required: requiresBioBreak,
    banner_prompt: requiresBioBreak
      ? `BIOLOGICAL MAINTENANCE MANDATE: ${continuousWorkMinutes} mins of continuous focus detected (>= 2.5 hrs). Stand up, hydrate, and consume protein/electrolytes before unlocking next session.`
      : null,
    recent_sessions: (recentSessions?.results || []).slice(0, 6)
  };
}

/**
 * Computes Ari's Saturday Evening Weekly Retrospective (Organ 8):
 * Distinguishes Burnout (< 4.5h average sleep + high completion output)
 * from Avoidance (normal sleep >= 6.0h + high Idea Vault captures + low/failed audits).
 */
export async function generateWeeklyRetrospective(db) {
  const [tasksRes, auditsRes, healthRes, ideasRes, focusRes] = await Promise.all([
    db.prepare(`SELECT status, is_bonus, estimated_duration_minutes FROM tasks`).all(),
    db.prepare(`SELECT verdict, score FROM audit_receipts`).all(),
    db.prepare(`SELECT sleep_hours, energy_rating, workout_completed FROM daily_health_logs ORDER BY date DESC LIMIT 7`).all(),
    db.prepare(`SELECT COUNT(*) AS cnt FROM idea_vault`).first(),
    db.prepare(`SELECT SUM(duration_minutes) AS total_focus FROM focus_sessions WHERE session_type != 'break'`).first()
  ]);

  const tasks = tasksRes?.results || [];
  const audits = auditsRes?.results || [];
  const healthLogs = healthRes?.results || [];

  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const totalTasks = Math.max(1, tasks.length);
  const velocityPct = Math.round((completedTasks / totalTasks) * 100);

  const passedAudits = audits.filter(a => a.verdict === 'passed').length;
  const auditPassRatePct = audits.length ? Math.round((passedAudits / audits.length) * 100) : 100;

  const avgSleep = healthLogs.length
    ? Number((healthLogs.reduce((acc, h) => acc + (Number(h.sleep_hours) || 7), 0) / healthLogs.length).toFixed(1))
    : 7.0;

  const ideaCount = Number(ideasRes?.cnt || 0);
  const totalFocusMinutes = Number(focusRes?.total_focus || 0);

  let diagnosis = 'OPTIMAL_CADENCE';
  let ariDirective = 'Execution velocity and circadian recovery are aligned. Maintain current P1 chain discipline.';

  if (avgSleep < 4.5 && completedTasks >= 3) {
    diagnosis = 'BURNOUT_RISK';
    ariDirective = `Burnout signature detected: Average sleep is ${avgSleep}h (<4.5h) alongside sustained output. Enforce mandatory 00:00 AST lights-out and cap tomorrow's queue to core Main Objectives.`;
  } else if (avgSleep >= 6.0 && ideaCount >= 5 && (velocityPct < 50 || auditPassRatePct < 70)) {
    diagnosis = 'AVOIDANCE_PATTERN';
    ariDirective = `Avoidance signature detected: Sleep is adequate (${avgSleep}h), yet Idea Vault captures (${ideaCount}) outpace verified task completions (${velocityPct}%). Confinement tightened; submit proof artifacts.`
  }

  return {
    diagnosis,
    ari_directive: ariDirective,
    metrics: {
      completed_tasks: completedTasks,
      total_tasks: tasks.length,
      velocity_pct: velocityPct,
      audit_pass_rate_pct: auditPassRatePct,
      avg_sleep_hours: avgSleep,
      captured_ideas_count: ideaCount,
      total_focus_minutes: totalFocusMinutes
    }
  };
}

/**
 * Handles /api/leisure, /api/focus, and /api/retrospective
 */
export async function handleLeisureRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'leisure' | 'focus' | 'retrospective']
  const rootEndpoint = pathParts[1];

  // GET /api/retrospective
  if (rootEndpoint === 'retrospective') {
    const retro = await generateWeeklyRetrospective(db);
    return { status: 200, data: retro };
  }

  // /api/focus (Pomodoro & Biological Maintenance tracker)
  if (rootEndpoint === 'focus') {
    if (method === 'GET') {
      const bio = await checkBiologicalMaintenanceState(db);
      return { status: 200, data: bio };
    }
    if (method === 'POST') {
      const body = await request.json();
      const sessionType = ['pomodoro', 'break', 'deep_work'].includes(body.session_type)
        ? body.session_type
        : 'pomodoro';
      const duration = Number(body.duration_minutes) || (sessionType === 'break' ? 15 : 25);
      const id = `foc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      await db.prepare(`
        INSERT INTO focus_sessions (id, task_id, duration_minutes, session_type, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, body.task_id || null, duration, sessionType, nowIso, nowIso).run();

      const bio = await checkBiologicalMaintenanceState(db);
      return { status: 201, data: { logged_session_id: id, ...bio } };
    }
  }

  // /api/leisure (Friday Hobby Safeguard, Weekend Saved Load & Entertainment Quota)
  if (method === 'GET') {
    const settingsRows = await db.prepare(`
      SELECT key, value FROM system_settings
      WHERE key IN ('friday_hobby_safeguard', 'weekend_saved_minutes', 'daily_entertainment_quota_mins', 'daily_entertainment_used_mins')
    `).all();
    const map = Object.fromEntries((settingsRows?.results || []).map(r => [r.key, r.value]));

    const riyadhWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      weekday: 'long'
    }).format(new Date());

    const quotaMins = Number(map.daily_entertainment_quota_mins || 90);
    const usedMins = Number(map.daily_entertainment_used_mins || 0);
    const weekendSavedMins = Number(map.weekend_saved_minutes || 0);

    return {
      status: 200,
      data: {
        riyadh_weekday: riyadhWeekday,
        is_friday_builder_day: riyadhWeekday === 'Friday',
        friday_hobby_safeguard_enabled: map.friday_hobby_safeguard !== '0',
        protected_hobby_domains: ['Arduino & Embedded Electronics', 'Game Development', 'Vibe Coding & Systems Architecture'],
        daily_entertainment_quota_mins: quotaMins,
        daily_entertainment_used_mins: usedMins,
        daily_entertainment_remaining_mins: Math.max(0, quotaMins - usedMins),
        weekend_workload_reduction_minutes: weekendSavedMins
      }
    };
  }

  if (method === 'POST') {
    const body = await request.json();
    if (body.spend_entertainment_minutes != null) {
      const row = await db.prepare(`
        SELECT value FROM system_settings WHERE key = 'daily_entertainment_used_mins'
      `).first();
      const nextUsed = (Number(row?.value) || 0) + Number(body.spend_entertainment_minutes);
      await db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('daily_entertainment_used_mins', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(String(nextUsed)).run();
    }

    if (body.friday_hobby_safeguard !== undefined) {
      await db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('friday_hobby_safeguard', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(body.friday_hobby_safeguard ? '1' : '0').run();
    }

    return handleLeisureRequest(new Request(request.url, { method: 'GET' }), url, db);
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
