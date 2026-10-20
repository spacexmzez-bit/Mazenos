// ============================================================================
// MazenOS Phase 3: Native Taskitator Core, Consecutive Cascading & Bonus Queue
// File: taskitator.js
// ============================================================================

import { getRiyadhDateString } from './worker-ai.js';

/**
 * Velocity-Weighted Priority Score (Organ 5):
 * A P2 project with 15 consecutive subtasks due in 5 days outranks a P1 task
 * with 2 steps due in 30 days.
 */
export function computeVelocityPriorityScore(task, subtaskCount = 0) {
  const basePriorityWeight = { 1: 100, 2: 75, 3: 45, 4: 20 }[task.priority] || 50;
  const nowMs = Date.now();
  const dueMs = task.due_timestamp ? Date.parse(task.due_timestamp) : nowMs + 7 * 86400000;
  const daysRemaining = Math.max(0.25, (dueMs - nowMs) / 86400000);

  const stepMultiplier = Math.max(1, subtaskCount) * (task.is_consecutive ? 1.5 : 1.0);
  const urgencyDensity = (stepMultiplier * 18) / daysRemaining;
  const bonusAdjustment = task.is_bonus ? -15 : 0;

  return Number((basePriorityWeight + urgencyDensity + bonusAdjustment).toFixed(2));
}

/**
 * Consecutive Dependency Cascading Engine (Organ 1):
 * When a parent task's due_timestamp shifts by deltaMs (or is set to newDueIso),
 * recursively cascades all dependent consecutive child tasks in D1 while
 * leaving independent tasks in flexible gaps untouched.
 */
export async function cascadeConsecutiveDependents(db, parentTaskId, newParentDueIso) {
  const cascadedIds = [];
  let currentParentId = parentTaskId;
  let currentParentDueMs = Date.parse(newParentDueIso);

  if (Number.isNaN(currentParentDueMs)) {
    return cascadedIds;
  }

  for (let depth = 0; depth < 25; depth++) {
    const children = await db.prepare(`
      SELECT id, due_timestamp, estimated_duration_minutes, is_consecutive
      FROM tasks
      WHERE depends_on_task_id = ? AND status NOT IN ('completed', 'archived')
    `).bind(currentParentId).all();

    const rows = children?.results || [];
    if (!rows.length) break;

    for (const child of rows) {
      if (!child.is_consecutive) continue;
      const durationMs = (Number(child.estimated_duration_minutes) || 45) * 60 * 1000;
      const childExistingDueMs = child.due_timestamp ? Date.parse(child.due_timestamp) : 0;

      // Ensure consecutive child is scheduled at least durationMs after parent completion
      const targetChildDueMs = Math.max(childExistingDueMs, currentParentDueMs + durationMs);
      const targetChildIso = new Date(targetChildDueMs).toISOString();

      await db.prepare(`
        UPDATE tasks SET due_timestamp = ? WHERE id = ?
      `).bind(targetChildIso, child.id).run();

      cascadedIds.push({ id: child.id, new_due_timestamp: targetChildIso });
      currentParentId = child.id;
      currentParentDueMs = targetChildDueMs;
    }
  }

  return cascadedIds;
}

/**
 * Elastic Bonus Task Engine (Organ 5):
 * When all today's active core (P1/P2) tasks are completed early, surfaces
 * upcoming future tasks as zero-penalty Bonus Tasks.
 */
export async function surfaceBonusTasks(db) {
  const todayStr = getRiyadhDateString(new Date());

  const candidateRows = await db.prepare(`
    SELECT id, title, priority, due_timestamp, estimated_duration_minutes, original_scheduled_date
    FROM tasks
    WHERE status = 'pending'
      AND is_bonus = 0
      AND due_timestamp > ?
    ORDER BY priority ASC, due_timestamp ASC
    LIMIT 3
  `).bind(`${todayStr}T23:59:59Z`).all();

  const surfaced = [];
  for (const row of (candidateRows?.results || [])) {
    const origDate = row.original_scheduled_date || (row.due_timestamp ? row.due_timestamp.slice(0, 10) : todayStr);
    await db.prepare(`
      UPDATE tasks
      SET is_bonus = 1, original_scheduled_date = ?
      WHERE id = ?
    `).bind(origDate, row.id).run();
    surfaced.push({ ...row, is_bonus: 1, original_scheduled_date: origDate });
  }

  return surfaced;
}

/**
 * Reverts untouched bonus tasks back to their original_scheduled_date with zero penalty.
 * Invoked by the 03:00 AM Riyadh cron job or on demand.
 */
export async function revertUntouchedBonusTasks(db) {
  const untouched = await db.prepare(`
    SELECT id, original_scheduled_date, estimated_duration_minutes
    FROM tasks
    WHERE is_bonus = 1 AND status = 'pending'
  `).all();

  const revertedIds = [];
  for (const t of (untouched?.results || [])) {
    const restoredDue = t.original_scheduled_date
      ? `${t.original_scheduled_date}T18:00:00.000Z`
      : null;
    await db.prepare(`
      UPDATE tasks
      SET is_bonus = 0, due_timestamp = COALESCE(?, due_timestamp)
      WHERE id = ?
    `).bind(restoredDue, t.id).run();
    revertedIds.push(t.id);
  }

  return revertedIds;
}

/**
 * Completes a task and handles Bonus Task weekend workload reduction rewards.
 */
export async function markTaskCompleted(db, taskId) {
  const task = await db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
  if (!task) return null;

  const nowIso = new Date().toISOString();
  await db.prepare(`
    UPDATE tasks
    SET status = 'completed', completed_at = ?
    WHERE id = ?
  `).bind(nowIso, taskId).run();

  let weekendSavedDelta = 0;
  if (task.is_bonus) {
    weekendSavedDelta = Number(task.estimated_duration_minutes) || 45;
    const row = await db.prepare(`
      SELECT value FROM system_settings WHERE key = 'weekend_saved_minutes'
    `).first();
    const totalSaved = (Number(row?.value) || 0) + weekendSavedDelta;
    await db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('weekend_saved_minutes', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(String(totalSaved)).run();
  }

  return {
    id: taskId,
    status: 'completed',
    completed_at: nowIso,
    was_bonus: Boolean(task.is_bonus),
    weekend_minutes_saved: weekendSavedDelta
  };
}

/**
 * Main HTTP Router Handler for /api/tasks
 */
export async function handleTasksRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'tasks', ...]

  // GET /api/tasks
  if (method === 'GET' && pathParts.length === 2) {
    const statusFilter = url.searchParams.get('status');
    const priorityFilter = url.searchParams.get('priority');

    let query = `SELECT * FROM tasks WHERE 1=1`;
    const params = [];
    if (statusFilter) {
      query += ` AND status = ?`;
      params.push(statusFilter);
    } else {
      query += ` AND status != 'archived'`;
    }
    if (priorityFilter) {
      query += ` AND priority = ?`;
      params.push(Number(priorityFilter));
    }
    query += ` ORDER BY priority ASC, CASE WHEN due_timestamp IS NULL THEN 1 ELSE 0 END, due_timestamp ASC`;

    const [tasksRes, subtasksRes, receiptsRes] = await Promise.all([
      db.prepare(query).bind(...params).all(),
      db.prepare(`SELECT * FROM subtasks ORDER BY created_at ASC`).all(),
      db.prepare(`SELECT * FROM audit_receipts ORDER BY evaluated_at DESC`).all()
    ]);

    const subtasksByTask = {};
    for (const st of (subtasksRes?.results || [])) {
      if (!subtasksByTask[st.task_id]) subtasksByTask[st.task_id] = [];
      subtasksByTask[st.task_id].push({
        ...st,
        is_completed: Boolean(st.is_completed)
      });
    }

    const receiptsByTask = {};
    for (const rc of (receiptsRes?.results || [])) {
      if (!receiptsByTask[rc.task_id]) receiptsByTask[rc.task_id] = [];
      receiptsByTask[rc.task_id].push(rc);
    }

    const enrichedTasks = (tasksRes?.results || []).map(t => {
      const subs = subtasksByTask[t.id] || [];
      const incompleteSubCount = subs.filter(s => !s.is_completed).length;
      return {
        ...t,
        is_consecutive: Boolean(t.is_consecutive),
        is_bonus: Boolean(t.is_bonus),
        requires_video: Boolean(t.requires_video),
        subtasks: subs,
        audit_receipts: receiptsByTask[t.id] || [],
        velocity_score: computeVelocityPriorityScore(t, incompleteSubCount)
      };
    });

    return { status: 200, data: { tasks: enrichedTasks } };
  }

  // POST /api/tasks/bonus (surface or revert bonus queue)
  if (method === 'POST' && pathParts[2] === 'bonus') {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'revert') {
      const reverted = await revertUntouchedBonusTasks(db);
      return { status: 200, data: { reverted_ids: reverted } };
    }
    const surfaced = await surfaceBonusTasks(db);
    return { status: 200, data: { surfaced_bonus_tasks: surfaced } };
  }

  // POST /api/tasks (Create task + optional subtasks)
  if (method === 'POST' && pathParts.length === 2) {
    const body = await request.json();
    const title = String(body.title || '').trim();
    if (!title) {
      return { status: 400, data: { error: 'Task title is required' } };
    }

    const id = body.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const priority = Math.min(4, Math.max(1, Number(body.priority) || 2));
    const isConsecutive = body.is_consecutive ? 1 : 0;
    const dependsOn = body.depends_on_task_id || null;
    const dueTimestamp = body.due_timestamp || null;
    const duration = Number(body.estimated_duration_minutes) || 45;
    const isBonus = body.is_bonus ? 1 : 0;
    const origDate = body.original_scheduled_date || (dueTimestamp ? dueTimestamp.slice(0, 10) : getRiyadhDateString());
    const auditCriteria = body.ai_audit_criteria || 'Clear handwritten or digital completion evidence matching task scope.';
    const requiresVideo = body.requires_video ? 1 : 0;

    await db.prepare(`
      INSERT INTO tasks (
        id, title, description, priority, is_consecutive, depends_on_task_id,
        due_timestamp, estimated_duration_minutes, status, is_bonus,
        original_scheduled_date, ai_audit_criteria, requires_video
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).bind(
      id,
      title,
      body.description || '',
      priority,
      isConsecutive,
      dependsOn,
      dueTimestamp,
      duration,
      isBonus,
      origDate,
      auditCriteria,
      requiresVideo
    ).run();

    const createdSubtasks = [];
    if (Array.isArray(body.subtasks)) {
      for (const stTitle of body.subtasks) {
        if (!stTitle) continue;
        const stId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await db.prepare(`
          INSERT INTO subtasks (id, task_id, title, is_completed)
          VALUES (?, ?, ?, 0)
        `).bind(stId, id, String(stTitle).trim()).run();
        createdSubtasks.push({ id: stId, task_id: id, title: String(stTitle).trim(), is_completed: false });
      }
    }

    return {
      status: 201,
      data: {
        id,
        title,
        priority,
        is_consecutive: Boolean(isConsecutive),
        depends_on_task_id: dependsOn,
        due_timestamp: dueTimestamp,
        estimated_duration_minutes: duration,
        status: 'pending',
        is_bonus: Boolean(isBonus),
        ai_audit_criteria: auditCriteria,
        subtasks: createdSubtasks
      }
    };
  }

  // PATCH or PUT /api/tasks/:id (Update task, status, or trigger consecutive cascade)
  if ((method === 'PATCH' || method === 'PUT') && pathParts.length === 3) {
    const taskId = pathParts[2];
    const body = await request.json();

    // Authority Clause check: Ari rejects comfort excuses for deadline extensions
    if (body.reason && /tired|bored|sleepy|don't feel like|lazy/i.test(body.reason)) {
      return {
        status: 403,
        data: {
          error: 'AUTHORITY_CLAUSE_VIOLATION',
          message: 'Ari Guardrail: Deadline modifications due to comfort excuses (tiredness/boredom) are strictly rejected.'
        }
      };
    }

    const existing = await db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
    if (!existing) {
      return { status: 404, data: { error: 'Task not found' } };
    }

    if (body.status === 'completed' && existing.status !== 'completed') {
      const completionResult = await markTaskCompleted(db, taskId);
      return { status: 200, data: completionResult };
    }

    const newTitle = body.title ?? existing.title;
    const newDesc = body.description ?? existing.description;
    const newPriority = body.priority != null ? Number(body.priority) : existing.priority;
    const newStatus = body.status ?? existing.status;
    const newDue = body.due_timestamp !== undefined ? body.due_timestamp : existing.due_timestamp;
    const newDuration = body.estimated_duration_minutes != null
      ? Number(body.estimated_duration_minutes)
      : existing.estimated_duration_minutes;
    const newConsecutive = body.is_consecutive !== undefined
      ? (body.is_consecutive ? 1 : 0)
      : existing.is_consecutive;

    await db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, priority = ?, status = ?,
          due_timestamp = ?, estimated_duration_minutes = ?, is_consecutive = ?
      WHERE id = ?
    `).bind(
      newTitle,
      newDesc,
      newPriority,
      newStatus,
      newDue,
      newDuration,
      newConsecutive,
      taskId
    ).run();

    let cascaded = [];
    if (newDue && newDue !== existing.due_timestamp) {
      cascaded = await cascadeConsecutiveDependents(db, taskId, newDue);
    }

    return {
      status: 200,
      data: {
        id: taskId,
        due_timestamp: newDue,
        status: newStatus,
        cascaded_dependents: cascaded
      }
    };
  }

  // POST /api/tasks/:id/subtasks (Add or toggle subtask)
  if (method === 'POST' && pathParts.length === 4 && pathParts[3] === 'subtasks') {
    const taskId = pathParts[2];
    const body = await request.json();

    if (body.subtask_id) {
      const isCompleted = body.is_completed ? 1 : 0;
      await db.prepare(`
        UPDATE subtasks SET is_completed = ? WHERE id = ? AND task_id = ?
      `).bind(isCompleted, body.subtask_id, taskId).run();
      return { status: 200, data: { id: body.subtask_id, is_completed: Boolean(isCompleted) } };
    }

    const stId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.prepare(`
      INSERT INTO subtasks (id, task_id, title, is_completed)
      VALUES (?, ?, ?, 0)
    `).bind(stId, taskId, String(body.title || '').trim()).run();

    return {
      status: 201,
      data: { id: stId, task_id: taskId, title: String(body.title || '').trim(), is_completed: false }
    };
  }

  // DELETE /api/tasks/:id
  if (method === 'DELETE' && pathParts.length === 3) {
    const taskId = pathParts[2];
    await db.prepare(`DELETE FROM tasks WHERE id = ?`).bind(taskId).run();
    return { status: 200, data: { deleted: taskId } };
  }

  return { status: 404, data: { error: 'Task endpoint not found' } };
}
