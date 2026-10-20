// ============================================================================
// MazenOS Phase 5 (Organ 1): Study Locations & Commute Friction Interception
// File: locations.js
// ============================================================================

import { compileStateSnapshot } from './worker-ai.js';

/**
 * Evaluates whether traveling to a study location is a legitimate productivity move
 * or procrastination disguised as commuting (Organ 1 Context Interception).
 */
export async function evaluateCommuteFeasibility(db, location) {
  const snapshot = await compileStateSnapshot(db);
  const commuteOneWay = Number(location.commute_minutes_one_way) || 20;
  const roundTripMinutes = commuteOneWay * 2;
  const costSar = Number(location.average_cost_sar) || 0;

  // 1. Check Budget Gate
  if (costSar > snapshot.budget_balance_sar) {
    return {
      approved: false,
      interception_code: 'BUDGET_INSUFFICIENT',
      reason: `Ari Interception: "${location.name}" averages ${costSar.toFixed(2)} SAR, exceeding live balance (${snapshot.budget_balance_sar.toFixed(2)} SAR). Stay at your desk.`
    };
  }

  // 2. Check Active P1 Task Deadline & Rest Window Collision
  const activeP1Row = await db.prepare(`
    SELECT id, title, due_timestamp, estimated_duration_minutes
    FROM tasks
    WHERE status IN ('pending', 'in_progress') AND priority = 1
    ORDER BY due_timestamp ASC LIMIT 1
  `).first();

  if (activeP1Row) {
    const taskDuration = Number(activeP1Row.estimated_duration_minutes) || 45;
    const totalRequiredMinutes = commuteOneWay + taskDuration;
    const projectedFinishMs = Date.now() + totalRequiredMinutes * 60 * 1000;

    if (activeP1Row.due_timestamp) {
      const dueMs = Date.parse(activeP1Row.due_timestamp);
      if (!Number.isNaN(dueMs) && projectedFinishMs > dueMs) {
        return {
          approved: false,
          interception_code: 'DEADLINE_COLLISION',
          reason: `Ari Interception: ${commuteOneWay}m commute + ${taskDuration}m work pushes P1 task "${activeP1Row.title}" past its ${snapshot.active_p1?.due || 'scheduled'} deadline. Execute immediately where you are.`
        };
      }
    }

    // Check collision with rest window (e.g., "00:00 - 00:45")
    const [restStart] = (snapshot.rest_window || '00:00 - 00:45').split('-').map(s => s.trim());
    const finishRiyadhHHMM = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(projectedFinishMs));

    if (restStart === '00:00' && finishRiyadhHHMM >= '00:00' && finishRiyadhHHMM <= '04:00') {
      return {
        approved: false,
        interception_code: 'REST_WINDOW_BREACH',
        reason: `Ari Interception: Traveling to "${location.name}" (${commuteOneWay}m one-way) forces task completion into your ${snapshot.rest_window} circadian rest window.`
      };
    }
  }

  return {
    approved: true,
    interception_code: 'CLEAR',
    round_trip_minutes: roundTripMinutes,
    estimated_cost_sar: costSar,
    reason: `Commute approved (${commuteOneWay}m one-way, ${costSar} SAR). Transit timer armed.`
  };
}

/**
 * Handles /api/locations and /api/locations/check-commute
 */
export async function handleLocationsRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET') {
    const rows = await db.prepare(`
      SELECT * FROM study_locations
      ORDER BY quietness_rating DESC, commute_minutes_one_way ASC
    `).all();
    return { status: 200, data: { locations: rows?.results || [] } };
  }

  // POST /api/locations/check-commute
  if (method === 'POST' && pathParts[2] === 'check-commute') {
    const body = await request.json();
    const loc = await db.prepare(`SELECT * FROM study_locations WHERE id = ?`).bind(body.location_id).first();
    if (!loc) {
      return { status: 404, data: { error: 'Study location not found' } };
    }
    const verdict = await evaluateCommuteFeasibility(db, loc);
    return { status: 200, data: { location: loc, ...verdict } };
  }

  // POST /api/locations (Add new study spot)
  if (method === 'POST') {
    const body = await request.json();
    const name = String(body.name || '').trim();
    if (!name) {
      return { status: 400, data: { error: 'Location name is required' } };
    }
    const id = body.id || `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const quietness = Math.min(5, Math.max(1, Number(body.quietness_rating) || 4));
    const commuteMins = Math.max(0, Number(body.commute_minutes_one_way) || 15);
    const avgCost = Math.max(0, Number(body.average_cost_sar) || 0);

    await db.prepare(`
      INSERT INTO study_locations (
        id, name, google_maps_url, service_type, quietness_rating,
        commute_minutes_one_way, average_cost_sar, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      name,
      body.google_maps_url || '',
      body.service_type || 'Cafe / Library',
      quietness,
      commuteMins,
      avgCost,
      body.notes || ''
    ).run();

    return {
      status: 201,
      data: {
        id,
        name,
        quietness_rating: quietness,
        commute_minutes_one_way: commuteMins,
        average_cost_sar: avgCost
      }
    };
  }

  if (method === 'DELETE' && pathParts[2]) {
    await db.prepare(`DELETE FROM study_locations WHERE id = ?`).bind(pathParts[2]).run();
    return { status: 200, data: { deleted: pathParts[2] } };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
