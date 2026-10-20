// ============================================================================
// MazenOS Phase 5 (Organ 2): Circadian Health, Sleep Engine & Sickness Breaker
// File: health.js
// ============================================================================

import { getRiyadhDateString } from './worker-ai.js';

/**
 * Evaluates fatigue and compliance states from a daily health log row.
 * - Normal fatigue (>= 4.0h sleep): recorded without dropping task commitments.
 * - Acute fatigue (< 4.0h sleep): flags acute_fatigue = true.
 * - Sickness Circuit Breaker (is_sick = true): freezes academic P1 chains & unlocks phone.
 */
export function evaluateHealthThresholds(log) {
  const sleepHours = log?.sleep_hours != null ? Number(log.sleep_hours) : 7.0;
  const energyRating = log?.energy_rating != null ? Number(log.energy_rating) : 4;
  const isSick = Boolean(log?.is_sick);
  const medTarget = Number(log?.medicine_target_count ?? 2);
  const medTaken = Number(log?.medicine_taken_count ?? 0);

  return {
    date: log?.date || getRiyadhDateString(),
    sleep_hours: sleepHours,
    energy_rating: energyRating,
    is_sick: isSick,
    sickness_notes: log?.sickness_notes || '',
    workout_completed: Boolean(log?.workout_completed),
    workout_type: log?.workout_type || '',
    medicine_target_count: medTarget,
    medicine_taken_count: medTaken,
    medicine_compliant: medTaken >= medTarget,
    acute_fatigue: sleepHours < 4.0,
    normal_fatigue: sleepHours >= 4.0 && sleepHours < 6.5,
    sickness_circuit_breaker_active: isSick,
    policy_directive: isSick
      ? 'SICKNESS_BREAKER_ACTIVE: Academic P1 chains frozen; phone hardware lock bypassed for recovery.'
      : (sleepHours < 4.0
          ? 'ACUTE_FATIGUE_ALERT: Sleep under 4.0h threshold. Prioritize high-yield essentials and early rest window.'
          : 'STANDARD_EXECUTION: Normal circadian baseline. Full P1 commitment enforced.')
  };
}

/**
 * Freezes active P1 consecutive chains by shifting due timestamps +24 hours when Sickness Breaker triggers.
 */
async function freezeActiveP1ChainsForSickness(db) {
  const activeTasks = await db.prepare(`
    SELECT id, due_timestamp FROM tasks
    WHERE status IN ('pending', 'in_progress') AND priority = 1
  `).all();

  const shifted = [];
  for (const t of (activeTasks?.results || [])) {
    const baseMs = t.due_timestamp ? Date.parse(t.due_timestamp) : Date.now();
    const shiftedIso = new Date((Number.isNaN(baseMs) ? Date.now() : baseMs) + 24 * 3600 * 1000).toISOString();
    await db.prepare(`UPDATE tasks SET due_timestamp = ? WHERE id = ?`).bind(shiftedIso, t.id).run();
    shifted.push({ id: t.id, new_due_timestamp: shiftedIso });
  }
  return shifted;
}

/**
 * Handles /api/health, /api/health/medicine, and /api/health/sick
 */
export async function handleHealthRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'health', ...]
  const todayDate = getRiyadhDateString();

  // Ensure today's row exists
  await db.prepare(`
    INSERT OR IGNORE INTO daily_health_logs (
      date, sleep_hours, energy_rating, is_sick, medicine_target_count, medicine_taken_count, workout_completed
    ) VALUES (?, 7.0, 4, 0, 2, 0, 0)
  `).bind(todayDate).run();

  if (method === 'GET') {
    const [todayRow, historyRows] = await Promise.all([
      db.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(todayDate).first(),
      db.prepare(`SELECT * FROM daily_health_logs ORDER BY date DESC LIMIT 14`).all()
    ]);

    return {
      status: 200,
      data: {
        today: evaluateHealthThresholds(todayRow),
        history: (historyRows?.results || []).map(evaluateHealthThresholds)
      }
    };
  }

  // POST /api/health/medicine (Increment or set daily medicine counter)
  if (method === 'POST' && pathParts[2] === 'medicine') {
    const body = await request.json().catch(() => ({}));
    const current = await db.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(todayDate).first();
    const target = body.medicine_target_count != null
      ? Number(body.medicine_target_count)
      : Number(current?.medicine_target_count ?? 2);
    const nextTaken = body.reset
      ? 0
      : (body.medicine_taken_count != null
          ? Number(body.medicine_taken_count)
          : Number(current?.medicine_taken_count ?? 0) + 1);

    await db.prepare(`
      UPDATE daily_health_logs
      SET medicine_taken_count = ?, medicine_target_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE date = ?
    `).bind(nextTaken, target, todayDate).run();

    const updated = await db.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(todayDate).first();
    return { status: 200, data: evaluateHealthThresholds(updated) };
  }

  // POST /api/health/sick (Toggle Sickness Circuit Breaker)
  if (method === 'POST' && pathParts[2] === 'sick') {
    const body = await request.json();
    const isSick = Boolean(body.is_sick);
    const notes = String(body.sickness_notes || '').trim();

    await db.prepare(`
      UPDATE daily_health_logs
      SET is_sick = ?, sickness_notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE date = ?
    `).bind(isSick ? 1 : 0, notes, todayDate).run();

    let frozenTasks = [];
    if (isSick) {
      frozenTasks = await freezeActiveP1ChainsForSickness(db);
    }

    const updated = await db.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(todayDate).first();
    return {
      status: 200,
      data: {
        ...evaluateHealthThresholds(updated),
        device_unlocked: true,
        frozen_p1_tasks: frozenTasks
      }
    };
  }

  // POST /api/health (Log daily circadian intake: sleep, energy 1-5, workout)
  if (method === 'POST') {
    const body = await request.json();
    const current = await db.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(todayDate).first();

    const sleepHours = body.sleep_hours != null ? Number(body.sleep_hours) : Number(current?.sleep_hours ?? 7.0);
    const energy = body.energy_rating != null
      ? Math.min(5, Math.max(1, Number(body.energy_rating)))
      : Number(current?.energy_rating ?? 4);
    const isSick = body.is_sick !== undefined ? (body.is_sick ? 1 : 0) : Number(current?.is_sick ?? 0);
    const notes = body.sickness_notes !== undefined ? String(body.sickness_notes) : (current?.sickness_notes || '');
    const medTarget = body.medicine_target_count != null
      ? Number(body.medicine_target_count)
      : Number(current?.medicine_target_count ?? 2);
    const medTaken = body.medicine_taken_count != null
      ? Number(body.medicine_taken_count)
      : Number(current?.medicine_taken_count ?? 0);
    const workoutDone = body.workout_completed !== undefined
      ? (body.workout_completed ? 1 : 0)
      : Number(current?.workout_completed ?? 0);
    const workoutType = body.workout_type !== undefined ? String(body.workout_type) : (current?.workout_type || '');

    await db.prepare(`
      UPDATE daily_health_logs
      SET sleep_hours = ?, energy_rating = ?, is_sick = ?, sickness_notes = ?,
          medicine_target_count = ?, medicine_taken_count = ?,
          workout_completed = ?, workout_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE date = ?
    `).bind(
      sleepHours,
      energy,
      isSick,
      notes,
      medTarget,
      medTaken,
      workoutDone,
      workoutType,
      todayDate
    ).run();

    const updated = await db.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(todayDate).first();
    return { status: 200, data: evaluateHealthThresholds(updated) };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
