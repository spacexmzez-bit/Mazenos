// ============================================================================
// MazenOS Phase 3: Multimodal Computer Vision Audit & NewPipe Media Gatekeeper
// File: taskitator-audit.js
// ============================================================================

import { executeModelCascade } from './worker-ai.js';
import { markTaskCompleted } from './taskitator.js';

/**
 * Extracts a strict JSON object from raw model output.
 */
function parseStrictAuditJson(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Model output did not contain a valid JSON object');
  }
  const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  const verdict = parsed.verdict === 'passed' ? 'passed' : 'failed';
  const score = Math.min(10, Math.max(1, Number(parsed.score) || (verdict === 'passed' ? 8 : 3)));
  const critique = String(parsed.critique || '').trim();
  if (!critique) {
    throw new Error('Audit JSON missing required critique field');
  }
  return { verdict, score, critique };
}

/**
 * POST /api/audit
 * Multimodal Proof Auditing (Organ 3):
 * Evaluates Base64 images (handwritten notes, terminal screenshots, gym summaries)
 * or PDF buffers against the task's explicit ai_audit_criteria.
 * Enforces Zero-Simulation Policy: fails closed (HTTP 502) if the vision API is unreachable
 * or returns malformed output. Never auto-passes without real evaluation.
 */
export async function handleProofAuditRequest(request, db, env) {
  const body = await request.json();
  const taskId = body.task_id;
  const base64Data = String(body.base64_data || '').replace(/^data:[^;]+;base64,/, '');
  const mimeType = body.mime_type || 'image/png';
  const operatorNotes = String(body.notes || '').trim();

  if (!taskId || !base64Data) {
    return {
      status: 400,
      data: { error: 'task_id and base64_data are strictly required for multimodal proof auditing' }
    };
  }

  const task = await db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
  if (!task) {
    return { status: 404, data: { error: 'Task not found for audit' } };
  }

  const rubric = task.ai_audit_criteria || 'Clear, verifiable proof that the task objective was completed thoroughly.';
  const auditSystemPrompt = [
    `You are Ari, the uncompromising Multimodal Proof Auditor of MazenOS.`,
    `Evaluate the attached artifact against the task title and rubric.`,
    `Respond ONLY with valid JSON matching: {"verdict":"passed"|"failed","score":1..10,"critique":"concise 1-2 sentence assessment"}.`,
    `Score >= 7 is required for "passed". Reject blurry, unrelated, or incomplete submissions.`
  ].join(' ');

  const userPrompt = `TASK: "${task.title}"\nDESCRIPTION: "${task.description || 'N/A'}"\nAUDIT_RUBRIC: "${rubric}"\nOPERATOR_NOTES: "${operatorNotes}"`;

  try {
    const llmRes = await executeModelCascade({
      db,
      env,
      tier: 'light',
      systemInstruction: auditSystemPrompt,
      messages: [{ sender: 'user', message_text: userPrompt }],
      maxTokens: 150,
      jsonMode: true,
      attachment: {
        mimeType,
        base64Data
      }
    });

    const evaluation = parseStrictAuditJson(llmRes.text);
    const receiptId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const evaluatedAt = new Date().toISOString();

    await db.prepare(`
      INSERT INTO audit_receipts (id, task_id, verdict, score, critique, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(receiptId, taskId, evaluation.verdict, evaluation.score, evaluation.critique, evaluatedAt).run();

    let completionOutcome = null;
    if (evaluation.verdict === 'passed') {
      completionOutcome = await markTaskCompleted(db, taskId);
    }

    return {
      status: 200,
      data: {
        receipt: {
          id: receiptId,
          task_id: taskId,
          verdict: evaluation.verdict,
          score: evaluation.score,
          critique: evaluation.critique,
          evaluated_at: evaluatedAt,
          provider: llmRes.provider,
          model: llmRes.model
        },
        task_completion: completionOutcome
      }
    };
  } catch (err) {
    if (err.status === 429 && err.payload) {
      return { status: 429, data: err.payload };
    }
    // Zero-Simulation Policy: Fail closed with HTTP 502 on any vision pipeline failure
    return {
      status: 502,
      data: {
        error: 'ZERO_SIMULATION_FAIL_CLOSED',
        message: `Multimodal proof audit failed closed: ${err.message}. Task remains locked/incomplete.`
      }
    };
  }
}

/**
 * POST /api/audit/media
 * NewPipe Task-Aware Video Audit (Organ 10):
 * MacroDroid scrapes the active NewPipe video title and posts to /api/audit/media.
 * Verifies relevance against the active study task and curriculum unit.
 * Unrelated entertainment videos during active work windows return {"allowed": false, "lock_device": true}.
 */
export async function handleMediaAuditRequest(request, db, env) {
  const body = await request.json();
  const videoTitle = String(body.video_title || '').trim();
  const channelName = String(body.channel || '').trim();

  if (!videoTitle) {
    return { status: 400, data: { error: 'video_title is required' } };
  }

  // Fetch active P1/P2 task and active curriculum unit
  const [activeTask, activeUnit] = await Promise.all([
    db.prepare(`
      SELECT id, title, description, requires_video
      FROM tasks
      WHERE status IN ('pending', 'in_progress')
      ORDER BY priority ASC, due_timestamp ASC
      LIMIT 1
    `).first(),
    db.prepare(`
      SELECT exam_name, topic_title
      FROM curriculum_units
      WHERE status = 'in_progress' OR is_main_objective = 1
      ORDER BY is_main_objective DESC
      LIMIT 1
    `).first()
  ]);

  if (!activeTask && !activeUnit) {
    return {
      status: 200,
      data: {
        allowed: true,
        lock_device: false,
        reason: 'No active study task or curriculum unit locked in queue.'
      }
    };
  }

  // Fast deterministic keyword check before spending tokens
  const contextString = `${activeTask?.title || ''} ${activeTask?.description || ''} ${activeUnit?.exam_name || ''} ${activeUnit?.topic_title || ''}`.toLowerCase();
  const normalizedVideo = `${videoTitle} ${channelName}`.toLowerCase();

  const contextTokens = contextString
    .split(/[^a-z0-9\u0600-\u06FF]+/i)
    .filter(w => w.length >= 4);

  const directKeywordMatch = contextTokens.some(tok => normalizedVideo.includes(tok));
  if (directKeywordMatch) {
    return {
      status: 200,
      data: {
        allowed: true,
        lock_device: false,
        matched_context: activeTask?.title || activeUnit?.topic_title,
        reason: `Verified topical match with active study unit (${activeTask?.title || activeUnit?.topic_title}).`
      }
    };
  }

  // Fallback to 150-token capped LLM classification if no direct lexical overlap
  try {
    const systemInstruction = `You are Ari's NewPipe Media Gatekeeper. Respond ONLY with valid JSON: {"allowed":boolean,"reason":"1 short sentence"}. Allow ONLY if the video directly teaches or supports the active study topic.`;
    const prompt = `VIDEO_TITLE: "${videoTitle}" (Channel: "${channelName}")\nACTIVE_TASK: "${activeTask?.title || 'None'}"\nCURRICULUM_TOPIC: "${activeUnit?.exam_name || ''}: ${activeUnit?.topic_title || 'None'}"`;

    const llmRes = await executeModelCascade({
      db,
      env,
      tier: 'light',
      systemInstruction,
      messages: [{ sender: 'user', message_text: prompt }],
      maxTokens: 150,
      jsonMode: true
    });

    const cleaned = llmRes.text.slice(llmRes.text.indexOf('{'), llmRes.text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(cleaned);
    const allowed = Boolean(parsed.allowed);

    return {
      status: 200,
      data: {
        allowed,
        lock_device: !allowed,
        video_title: videoTitle,
        active_task: activeTask?.title || null,
        reason: String(parsed.reason || (allowed ? 'Approved for study.' : 'Unrelated to active study unit.'))
      }
    };
  } catch (_err) {
    // Zero-Simulation Policy: if unverified and LLM unavailable, block distraction during P1 task
    return {
      status: 200,
      data: {
        allowed: false,
        lock_device: true,
        video_title: videoTitle,
        active_task: activeTask?.title || null,
        reason: 'Video title did not match active curriculum keywords and strict zero-simulation audit failed closed.'
      }
    };
  }
}
