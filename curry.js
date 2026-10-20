// ============================================================================
// MazenOS Phase 5 (Organ 7): Smart Curriculum Assistant ("Curry")
// File: curry.js
// ============================================================================

/**
 * Generates the standardized zero-token syllabus extraction prompt for external
 * high-context web LLMs (Gemini Pro / ChatGPT Plus).
 */
export function buildExternalSyllabusExtractionPrompt(examName = 'Target Exam') {
  return [
    `You are extracting a structured syllabus for MazenOS Curry ("${examName}").`,
    `Convert the attached syllabus/textbook table of contents into a strict JSON array of curriculum units.`,
    `Output ONLY valid JSON with no markdown wrapper, adhering to this exact schema:`,
    `[`,
    `  {`,
    `    "exam_name": "${examName}",`,
    `    "unit_number": 1,`,
    `    "topic_title": "Concise chapter/unit title",`,
    `    "difficulty_level": 1..5,`,
    `    "estimated_hours": 2.0,`,
    `    "is_main_objective": true|false,`,
    `    "target_completion_date": "YYYY-MM-DD"`,
    `  }`,
    `]`,
    `RULES: Assign is_main_objective=true to the highest-weight core foundational unit (occupying 65-75% daily focus) and is_main_objective=false to secondary sub-objectives (25-35% focus). Rate difficulty_level 4-5 for dense analytical/problem-solving chapters and 1-2 for factual/terminology review chapters.`
  ].join('\n');
}

/**
 * Computes balanced daily study pairings:
 * Pairs high-difficulty main objectives (difficulty >= 4, 65-75% focus share)
 * with low-difficulty factual review sub-objectives (difficulty <= 2, 25-35% focus share).
 */
export function computeCurriculumAllocation(units) {
  const activeUnits = units.filter(u => u.status !== 'completed');
  const nowMs = Date.now();

  // Check if any unit has a target_completion_date within 5 days (exam proximity trigger)
  const urgentExamUnits = activeUnits.filter(u => {
    if (!u.target_completion_date) return false;
    const diffDays = (Date.parse(u.target_completion_date) - nowMs) / 86400000;
    return diffDays >= -1 && diffDays <= 5;
  });

  const mainObjectives = activeUnits.filter(u => Boolean(u.is_main_objective) || urgentExamUnits.includes(u));
  const subObjectives = activeUnits.filter(u => !mainObjectives.includes(u));

  const primaryMain = mainObjectives[0] || activeUnits[0] || null;
  let pairedSub = null;

  if (primaryMain && subObjectives.length) {
    if (Number(primaryMain.difficulty_level) >= 4) {
      // Pair heavy analytical main unit with light factual review unit
      pairedSub = subObjectives.find(u => Number(u.difficulty_level) <= 2) || subObjectives[0];
    } else {
      pairedSub = subObjectives[0];
    }
  }

  return {
    focus_split: {
      main_objective_share_pct: 70,
      sub_objective_share_pct: 30
    },
    active_main_objective: primaryMain,
    paired_sub_objective: pairedSub,
    urgent_exam_override_active: urgentExamUnits.length > 0,
    total_units: units.length,
    completed_units: units.filter(u => u.status === 'completed').length
  };
}

/**
 * Succession Trigger:
 * When a main objective is marked completed, automatically promotes the next
 * sub-objective or sequential unit in that exam track to is_main_objective = 1.
 */
export async function triggerMainObjectiveSuccession(db, completedUnit) {
  const nextCandidate = await db.prepare(`
    SELECT * FROM curriculum_units
    WHERE status != 'completed' AND id != ?
    ORDER BY
      CASE WHEN exam_name = ? THEN 0 ELSE 1 END,
      CASE WHEN target_completion_date IS NULL THEN 1 ELSE 0 END,
      target_completion_date ASC,
      unit_number ASC
    LIMIT 1
  `).bind(completedUnit.id, completedUnit.exam_name).first();

  if (!nextCandidate) return null;

  await db.prepare(`
    UPDATE curriculum_units
    SET is_main_objective = 1, status = 'in_progress'
    WHERE id = ?
  `).bind(nextCandidate.id).run();

  return {
    promoted_unit_id: nextCandidate.id,
    exam_name: nextCandidate.exam_name,
    topic_title: nextCandidate.topic_title
  };
}

/**
 * Handles /api/curry routes:
 * - GET /api/curry: lists units, focus allocation (70/30 split), and difficulty pairing
 * - GET /api/curry/prompt: returns standardized external LLM syllabus extraction prompt
 * - GET /api/curry/drills: proposes consensual spaced-retrieval drills for completed/in-progress units
 * - POST /api/curry/drills: confirms and inserts a consensual retrieval drill into Taskitator
 * - POST /api/curry: adds a single unit or bulk imports extracted JSON array
 * - PATCH /api/curry/:id: updates unit status and triggers Main Objective Succession
 */
export async function handleCurryRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'curry', ...]

  // GET /api/curry/prompt
  if (method === 'GET' && pathParts[2] === 'prompt') {
    const examName = url.searchParams.get('exam') || 'Qudurat / Tahsili / University Core';
    return {
      status: 200,
      data: {
        exam_name: examName,
        extraction_prompt: buildExternalSyllabusExtractionPrompt(examName)
      }
    };
  }

  // GET /api/curry/drills (Consensual Spaced-Retrieval Proposals)
  if (method === 'GET' && pathParts[2] === 'drills') {
    const units = await db.prepare(`
      SELECT * FROM curriculum_units
      WHERE status IN ('in_progress', 'completed')
      ORDER BY completed_at DESC, unit_number ASC
      LIMIT 5
    `).all();

    const proposals = (units?.results || []).map(u => ({
      proposal_id: `drill_${u.id}`,
      unit_id: u.id,
      exam_name: u.exam_name,
      topic_title: u.topic_title,
      suggested_task_title: `[Spaced Drill] ${u.exam_name} U${u.unit_number}: ${u.topic_title}`,
      estimated_duration_minutes: 25,
      priority: u.is_main_objective ? 1 : 2,
      requires_confirmation: true,
      ai_audit_criteria: `Submit scored practice drill or active-recall summary sheet for ${u.topic_title} (>=80% accuracy).`
    }));

    return { status: 200, data: { consensual_drill_proposals: proposals } };
  }

  // POST /api/curry/drills (Operator confirms inserting a drill into active Taskitator queue)
  if (method === 'POST' && pathParts[2] === 'drills') {
    const body = await request.json();
    if (!body.confirmed) {
      return { status: 400, data: { error: 'Consensual testing requires explicit confirmed=true flag' } };
    }

    const unit = await db.prepare(`SELECT * FROM curriculum_units WHERE id = ?`).bind(body.unit_id).first();
    if (!unit) {
      return { status: 404, data: { error: 'Curriculum unit not found' } };
    }

    const taskId = `t_drill_${Date.now()}`;
    const dueIso = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const title = `[Retrieval Drill] ${unit.exam_name} U${unit.unit_number}: ${unit.topic_title}`;
    const criteria = `Scored retrieval test or handwritten recall sheet covering ${unit.topic_title}.`;

    await db.prepare(`
      INSERT INTO tasks (
        id, title, description, priority, is_consecutive, due_timestamp,
        estimated_duration_minutes, status, is_bonus, ai_audit_criteria
      ) VALUES (?, ?, ?, ?, 0, ?, 25, 'pending', 0, ?)
    `).bind(
      taskId,
      title,
      `Consensual spaced-retrieval drill generated by Curry for ${unit.exam_name}.`,
      unit.is_main_objective ? 1 : 2,
      dueIso,
      criteria
    ).run();

    return {
      status: 201,
      data: {
        inserted_task_id: taskId,
        title,
        due_timestamp: dueIso
      }
    };
  }

  // GET /api/curry
  if (method === 'GET') {
    const rows = await db.prepare(`
      SELECT * FROM curriculum_units
      ORDER BY is_main_objective DESC, exam_name ASC, unit_number ASC
    `).all();
    const units = (rows?.results || []).map(u => ({
      ...u,
      is_main_objective: Boolean(u.is_main_objective)
    }));

    return {
      status: 200,
      data: {
        units,
        allocation: computeCurriculumAllocation(units)
      }
    };
  }

  // POST /api/curry (Single unit or bulk JSON import from external LLM)
  if (method === 'POST') {
    const body = await request.json();
    const items = Array.isArray(body.units) ? body.units : [body];
    const inserted = [];

    for (const item of items) {
      if (!item.topic_title || !item.exam_name) continue;
      const id = item.id || `cu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const unitNum = Number(item.unit_number) || 1;
      const diff = Math.min(5, Math.max(1, Number(item.difficulty_level) || 3));
      const estHours = Number(item.estimated_hours) || 2.0;
      const isMain = item.is_main_objective ? 1 : 0;
      const status = ['not_started', 'in_progress', 'completed'].includes(item.status)
        ? item.status
        : 'not_started';

      await db.prepare(`
        INSERT INTO curriculum_units (
          id, exam_name, unit_number, topic_title, difficulty_level,
          estimated_hours, is_main_objective, status, target_completion_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        String(item.exam_name).trim(),
        unitNum,
        String(item.topic_title).trim(),
        diff,
        estHours,
        isMain,
        status,
        item.target_completion_date || null
      ).run();

      inserted.push({ id, exam_name: item.exam_name, unit_number: unitNum, topic_title: item.topic_title });
    }

    return { status: 201, data: { imported_count: inserted.length, units: inserted } };
  }

  // PATCH /api/curry/:id (Update status & run Succession Trigger if completed)
  if ((method === 'PATCH' || method === 'PUT') && pathParts[2]) {
    const unitId = pathParts[2];
    const body = await request.json();
    const existing = await db.prepare(`SELECT * FROM curriculum_units WHERE id = ?`).bind(unitId).first();
    if (!existing) {
      return { status: 404, data: { error: 'Curriculum unit not found' } };
    }

    const newStatus = body.status || existing.status;
    const isMain = body.is_main_objective !== undefined
      ? (body.is_main_objective ? 1 : 0)
      : existing.is_main_objective;
    const completedAt = newStatus === 'completed' ? new Date().toISOString() : existing.completed_at;

    await db.prepare(`
      UPDATE curriculum_units
      SET status = ?, is_main_objective = ?, completed_at = ?
      WHERE id = ?
    `).bind(newStatus, newStatus === 'completed' ? 0 : isMain, completedAt, unitId).run();

    let succession = null;
    if (newStatus === 'completed' && existing.is_main_objective) {
      succession = await triggerMainObjectiveSuccession(db, existing);
    }

    return {
      status: 200,
      data: {
        id: unitId,
        status: newStatus,
        succession_promoted: succession
      }
    };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
