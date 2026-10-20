// ============================================================================
// MazenOS Phase 2: Dual-AI Engine, Token Optimization & Chat Persistence
// File: worker-ai.js
// ============================================================================

export const MODEL_WATERFALL = {
  gemini: {
    light: ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'],
    smart: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
  },
  claude: {
    light: ['claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022'],
    smart: ['claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022']
  }
};

/**
 * Formats a Date object into "YYYY-MM-DD HH:mm AST" in Asia/Riyadh (+03:00).
 */
export function formatRiyadhTimestamp(dateObj = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(dateObj).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} AST`;
}

/**
 * Returns YYYY-MM-DD string in Asia/Riyadh timezone.
 */
export function getRiyadhDateString(dateObj = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dateObj);
}

/**
 * Compiles the < 120-token live operational state snapshot from D1.
 * Zero server-side cache fees; injected fresh on every turn.
 */
export async function compileStateSnapshot(db) {
  const nowStr = formatRiyadhTimestamp(new Date());
  const todayDate = getRiyadhDateString(new Date());

  const [
    activeP1Row,
    healthRow,
    settingsRows,
    latestBudgetRow
  ] = await Promise.all([
    db.prepare(`
      SELECT id, title, due_timestamp, is_consecutive
      FROM tasks
      WHERE status IN ('pending', 'in_progress') AND priority = 1 AND is_bonus = 0
      ORDER BY CASE WHEN due_timestamp IS NULL THEN 1 ELSE 0 END, due_timestamp ASC
      LIMIT 1
    `).first(),
    db.prepare(`
      SELECT sleep_hours, energy_rating, is_sick, medicine_taken_count, medicine_target_count
      FROM daily_health_logs
      WHERE date = ?
    `).bind(todayDate).first(),
    db.prepare(`
      SELECT key, value FROM system_settings
      WHERE key IN ('rest_window', 'budget_balance_sar', 'idea_vault_locked')
    `).all(),
    db.prepare(`
      SELECT balance_after_sar FROM budget_entries
      ORDER BY transaction_timestamp DESC, created_at DESC LIMIT 1
    `).first()
  ]);

  const settings = {};
  for (const r of (settingsRows?.results || [])) {
    settings[r.key] = r.value;
  }

  // Trace downstream consecutive chain for active P1 task
  const downstreamChain = [];
  if (activeP1Row?.id) {
    let parentId = activeP1Row.id;
    for (let depth = 0; depth < 6; depth++) {
      const child = await db.prepare(`
        SELECT id FROM tasks
        WHERE depends_on_task_id = ? AND status != 'completed'
        LIMIT 1
      `).bind(parentId).first();
      if (!child) break;
      downstreamChain.push(child.id);
      parentId = child.id;
    }
  }

  const dueShort = activeP1Row?.due_timestamp
    ? activeP1Row.due_timestamp.slice(11, 16) || activeP1Row.due_timestamp
    : null;

  const isSick = Boolean(healthRow?.is_sick);
  const nowHHMM = nowStr.slice(11, 16);
  const restWindow = settings.rest_window || '00:00 - 00:45';
  const [restStart, restEnd] = restWindow.split('-').map(s => s.trim());
  const inRestWindow = nowHHMM >= restStart && nowHHMM <= restEnd;

  let isOverdueP1 = false;
  if (activeP1Row?.due_timestamp) {
    const dueMs = Date.parse(activeP1Row.due_timestamp);
    if (!Number.isNaN(dueMs) && Date.now() > dueMs) {
      isOverdueP1 = true;
    }
  }

  const deviceLocked = Boolean(!isSick && !inRestWindow && isOverdueP1);
  const balanceSar = latestBudgetRow?.balance_after_sar != null
    ? Number(latestBudgetRow.balance_after_sar)
    : Number(settings.budget_balance_sar || 88.33);

  return {
    time_now: nowStr,
    active_p1: activeP1Row
      ? {
          id: activeP1Row.id,
          title: activeP1Row.title,
          due: dueShort,
          is_consecutive: Boolean(activeP1Row.is_consecutive)
        }
      : null,
    downstream_chain: downstreamChain,
    health: {
      sleep_hours: healthRow?.sleep_hours != null ? Number(healthRow.sleep_hours) : 7.0,
      energy: healthRow?.energy_rating != null ? Number(healthRow.energy_rating) : 4,
      is_sick: isSick,
      meds: `${healthRow?.medicine_taken_count ?? 0}/${healthRow?.medicine_target_count ?? 2}`
    },
    rest_window: restWindow,
    budget_balance_sar: Number(balanceSar.toFixed(2)),
    locked: deviceLocked
  };
}

/**
 * Builds the system instruction string for Ari or Jade with the injected <120 token state JSON.
 */
export function buildAgentSystemPrompt(agent, stateSnapshot, extraContext = '') {
  const compactState = JSON.stringify(stateSnapshot);
  if (agent === 'jade') {
    return [
      `You are Jade, the Mental Support, Grounded Reality-Check, and Decompression Agent of MazenOS.`,
      `LIVE_STATE:${compactState}`,
      `DIRECTIVES: Provide warm, objective, grounded psychological perspective and emotional regulation without drill-sergeant antagonism. Help Mazen decompress, process journal reflections, distinguish true exhaustion from avoidance, and reset calmly.`,
      extraContext ? `CONTEXT:${extraContext}` : ''
    ].filter(Boolean).join('\n');
  }

  return [
    `You are Ari, the Tactical Execution, Task Auditor, Smart Rescheduler, and Anti-Excuse Guardrail Engine of MazenOS.`,
    `LIVE_STATE:${compactState}`,
    `DIRECTIVES: Zero comfort excuses. Never alter deadlines due to boredom or normal tiredness (>=4h sleep). If health.is_sick is true, enforce Sickness Circuit Breaker (freeze P1 academic chains, prioritize recovery). Intercept procrastination disguised as commuting when travel jeopardizes due_timestamp or rest_window. Keep responses concise, tactical, and direct.`,
    extraContext ? `CONTEXT:${extraContext}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * Reads active provider and API keys from D1 system_settings and Worker env bindings.
 */
export async function getProviderConfig(db, env) {
  const rows = await db.prepare(`
    SELECT key, value FROM system_settings
    WHERE key IN ('active_provider', 'active_tier', 'gemini_api_key', 'claude_api_key')
  `).all();
  const map = {};
  for (const r of (rows?.results || [])) {
    map[r.key] = r.value;
  }
  return {
    provider: map.active_provider || 'gemini',
    tier: map.active_tier || 'light',
    geminiKey: env?.GEMINI_API_KEY || map.gemini_api_key || '',
    claudeKey: env?.CLAUDE_API_KEY || map.claude_api_key || ''
  };
}

/**
 * Low-level Gemini REST call (supports text & inline multimodal base64 attachments).
 */
async function callGeminiModel({ model, apiKey, systemInstruction, messages, maxTokens = 600, jsonMode = false, attachment = null }) {
  if (!apiKey) {
    const err = new Error('Missing Gemini API key');
    err.status = 401;
    throw err;
  }

  const contents = messages.map((m, idx) => {
    const parts = [{ text: m.message_text || m.content || '' }];
    if (attachment && idx === messages.length - 1 && m.sender === 'user') {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType || 'image/png',
          data: attachment.base64Data
        }
      });
    }
    return {
      role: m.sender === 'assistant' ? 'model' : 'user',
      parts
    };
  });

  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: jsonMode ? 0.1 : 0.4
  };
  if (jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig
    })
  });

  if (resp.status === 429) {
    const err = new Error(`Gemini 429 on ${model}`);
    err.status = 429;
    throw err;
  }
  if (!resp.ok) {
    const bodyText = await resp.text();
    const err = new Error(`Gemini HTTP ${resp.status}: ${bodyText}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) {
    const err = new Error('Empty response from Gemini model');
    err.status = 502;
    throw err;
  }
  return { text, model, provider: 'gemini' };
}

/**
 * Low-level Anthropic Claude REST call (supports text & multimodal base64 images/PDFs).
 */
async function callClaudeModel({ model, apiKey, systemInstruction, messages, maxTokens = 600, attachment = null }) {
  if (!apiKey) {
    const err = new Error('Missing Claude API key');
    err.status = 401;
    throw err;
  }

  const formattedMessages = messages.map((m, idx) => {
    const isLastUser = attachment && idx === messages.length - 1 && m.sender === 'user';
    if (!isLastUser) {
      return {
        role: m.sender === 'assistant' ? 'assistant' : 'user',
        content: m.message_text || m.content || ''
      };
    }

    const contentBlocks = [];
    if (attachment.mimeType === 'application/pdf') {
      contentBlocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: attachment.base64Data
        }
      });
    } else {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mimeType || 'image/png',
          data: attachment.base64Data
        }
      });
    }
    contentBlocks.push({
      type: 'text',
      text: m.message_text || m.content || 'Audit attached proof artifact.'
    });

    return {
      role: 'user',
      content: contentBlocks
    };
  });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemInstruction,
      messages: formattedMessages
    })
  });

  if (resp.status === 429) {
    const err = new Error(`Claude 429 on ${model}`);
    err.status = 429;
    throw err;
  }
  if (!resp.ok) {
    const bodyText = await resp.text();
    const err = new Error(`Claude HTTP ${resp.status}: ${bodyText}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const text = (data?.content || []).map(c => c.text || '').join('');
  if (!text) {
    const err = new Error('Empty response from Claude model');
    err.status = 502;
    throw err;
  }
  return { text, model, provider: 'claude' };
}

/**
 * Executes intra-provider model cascading on HTTP 429.
 * If the entire provider tier is exhausted, returns a structured 429 switch payload.
 */
export async function executeModelCascade({
  db,
  env,
  tier = 'light',
  systemInstruction,
  messages,
  maxTokens = 600,
  jsonMode = false,
  attachment = null,
  overrideProvider = null
}) {
  const config = await getProviderConfig(db, env);
  const activeProvider = overrideProvider || config.provider || 'gemini';
  const activeTier = MODEL_WATERFALL[activeProvider]?.[tier] ? tier : 'light';
  const candidateModels = [
    ...MODEL_WATERFALL[activeProvider][activeTier],
    ...(activeTier === 'light' ? MODEL_WATERFALL[activeProvider].smart : MODEL_WATERFALL[activeProvider].light)
  ];

  let allRateLimited = true;
  let lastError = null;

  for (const model of candidateModels) {
    try {
      if (activeProvider === 'gemini') {
        return await callGeminiModel({
          model,
          apiKey: config.geminiKey,
          systemInstruction,
          messages,
          maxTokens,
          jsonMode,
          attachment
        });
      } else {
        return await callClaudeModel({
          model,
          apiKey: config.claudeKey,
          systemInstruction,
          messages,
          maxTokens,
          attachment
        });
      }
    } catch (err) {
      lastError = err;
      if (err.status === 429) {
        // Silent intra-provider fallback to next model in cascade
        continue;
      }
      allRateLimited = false;
      throw err;
    }
  }

  if (allRateLimited) {
    const alternateProvider = activeProvider === 'gemini' ? 'claude' : 'gemini';
    const providerLabel = activeProvider === 'gemini' ? 'Gemini' : 'Claude';
    const altLabel = alternateProvider === 'gemini' ? 'Gemini' : 'Claude';
    const exhaustedErr = new Error(`${providerLabel} quota exhausted. Switch active session to ${altLabel}?`);
    exhaustedErr.status = 429;
    exhaustedErr.payload = {
      error: 'PROVIDER_QUOTA_EXHAUSTED',
      exhausted_provider: activeProvider,
      suggested_provider: alternateProvider,
      modal_prompt: `${providerLabel} quota exhausted. Switch active session to ${altLabel}?`
    };
    throw exhaustedErr;
  }

  throw lastError || new Error('Model cascade failed');
}

/**
 * Handles POST /api/chat:
 * 1. Persists incoming user message to D1 chat_messages.
 * 2. Extracts strictly the last 6 messages from active session.
 * 3. Injects <120 token live operational state snapshot.
 * 4. Calls LLM cascade & commits assistant response to D1.
 */
export async function handleChatRequest(request, db, env) {
  const body = await request.json();
  const agent = body.agent === 'jade' ? 'jade' : 'ari';
  const messageText = String(body.message || '').trim();
  const tier = body.tier === 'smart' ? 'smart' : 'light';

  if (!messageText) {
    return { status: 400, data: { error: 'message is required' } };
  }

  // Determine session_id
  let sessionId = body.session_id;
  if (!sessionId) {
    const settingKey = agent === 'jade' ? 'active_session_jade' : 'active_session_ari';
    const row = await db.prepare(`SELECT value FROM system_settings WHERE key = ?`).bind(settingKey).first();
    sessionId = row?.value || `sess_${agent}_default`;
  }

  // 1. Save incoming user prompt immediately to D1
  const userMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  await db.prepare(`
    INSERT INTO chat_messages (id, session_id, agent, sender, message_text, created_at)
    VALUES (?, ?, ?, 'user', ?, ?)
  `).bind(userMsgId, sessionId, agent, messageText, nowIso).run();

  // 2. Fetch strictly the last 6 messages from D1 for the active session
  const recentRows = await db.prepare(`
    SELECT id, session_id, agent, sender, message_text, created_at
    FROM chat_messages
    WHERE session_id = ? AND agent = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 6
  `).bind(sessionId, agent).all();

  const slidingWindowMessages = (recentRows?.results || []).reverse();

  // 3. Compile < 120-token live operational state snapshot
  const stateSnapshot = await compileStateSnapshot(db);

  // If Jade, attach latest diary mood context concisely
  let extraContext = '';
  if (agent === 'jade') {
    const recentDiary = await db.prepare(`
      SELECT mood_indicator, substr(entry_text, 1, 120) AS snippet
      FROM diary_entries ORDER BY created_at DESC LIMIT 2
    `).all();
    if (recentDiary?.results?.length) {
      extraContext = JSON.stringify(recentDiary.results);
    }
  }

  const systemInstruction = buildAgentSystemPrompt(agent, stateSnapshot, extraContext);

  try {
    const llmResult = await executeModelCascade({
      db,
      env,
      tier,
      systemInstruction,
      messages: slidingWindowMessages,
      maxTokens: 600
    });

    const assistantMsgId = `msg_${Date.now() + 1}_${Math.random().toString(36).slice(2, 7)}`;
    const replyIso = new Date().toISOString();

    await db.prepare(`
      INSERT INTO chat_messages (id, session_id, agent, sender, message_text, created_at)
      VALUES (?, ?, ?, 'assistant', ?, ?)
    `).bind(assistantMsgId, sessionId, agent, llmResult.text, replyIso).run();

    return {
      status: 200,
      data: {
        session_id: sessionId,
        agent,
        provider: llmResult.provider,
        model: llmResult.model,
        user_message_id: userMsgId,
        assistant_message: {
          id: assistantMsgId,
          sender: 'assistant',
          message_text: llmResult.text,
          created_at: replyIso
        },
        window_size: slidingWindowMessages.length,
        state_snapshot: stateSnapshot
      }
    };
  } catch (err) {
    if (err.status === 429 && err.payload) {
      return { status: 429, data: err.payload };
    }
    return {
      status: err.status || 502,
      data: {
        error: 'AI_DISPATCH_FAILED',
        message: err.message,
        session_id: sessionId,
        state_snapshot: stateSnapshot
      }
    };
  }
}

/**
 * Handles GET /api/chat/history and POST /api/chat/rollback:
 * - Lists sessions, searches historical messages across D1, and rolls back session state
 *   to any earlier message timestamp/ID without token cost.
 */
export async function handleChatHistory(request, url, db) {
  if (request.method === 'GET') {
    const agent = url.searchParams.get('agent') || 'ari';
    const sessionId = url.searchParams.get('session_id');
    const searchQuery = url.searchParams.get('q');

    if (searchQuery) {
      const matches = await db.prepare(`
        SELECT id, session_id, agent, sender, message_text, created_at
        FROM chat_messages
        WHERE agent = ? AND message_text LIKE ?
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(agent, `%${searchQuery}%`).all();
      return { status: 200, data: { results: matches?.results || [] } };
    }

    if (sessionId) {
      const messages = await db.prepare(`
        SELECT id, session_id, agent, sender, message_text, created_at
        FROM chat_messages
        WHERE session_id = ? AND agent = ?
        ORDER BY created_at ASC, rowid ASC
      `).bind(sessionId, agent).all();
      return {
        status: 200,
        data: {
          session_id: sessionId,
          agent,
          messages: messages?.results || []
        }
      };
    }

    // Otherwise list distinct sessions for the agent with message count and preview
    const sessions = await db.prepare(`
      SELECT
        session_id,
        agent,
        COUNT(*) AS message_count,
        MIN(created_at) AS started_at,
        MAX(created_at) AS last_message_at
      FROM chat_messages
      WHERE agent = ?
      GROUP BY session_id, agent
      ORDER BY last_message_at DESC
    `).bind(agent).all();

    return {
      status: 200,
      data: {
        agent,
        sessions: sessions?.results || []
      }
    };
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const action = body.action || 'rollback';
    const agent = body.agent === 'jade' ? 'jade' : 'ari';
    const sessionId = body.session_id;
    const targetMessageId = body.target_message_id;

    if (action === 'new_session') {
      const newSessionId = `sess_${agent}_${Date.now()}`;
      const settingKey = agent === 'jade' ? 'active_session_jade' : 'active_session_ari';
      await db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(settingKey, newSessionId).run();

      return { status: 200, data: { session_id: newSessionId, agent } };
    }

    if (!sessionId || !targetMessageId) {
      return { status: 400, data: { error: 'session_id and target_message_id are required for rollback' } };
    }

    const targetMsg = await db.prepare(`
      SELECT id, created_at, rowid FROM chat_messages
      WHERE id = ? AND session_id = ?
    `).bind(targetMessageId, sessionId).first();

    if (!targetMsg) {
      return { status: 404, data: { error: 'Target message not found in session' } };
    }

    // Prune messages created after the target checkpoint in this session
    await db.prepare(`
      DELETE FROM chat_messages
      WHERE session_id = ? AND agent = ? AND rowid > ?
    `).bind(sessionId, agent, targetMsg.rowid).run();

    // Set this session as active for the agent
    const settingKey = agent === 'jade' ? 'active_session_jade' : 'active_session_ari';
    await db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(settingKey, sessionId).run();

    const remaining = await db.prepare(`
      SELECT id, session_id, agent, sender, message_text, created_at
      FROM chat_messages
      WHERE session_id = ? AND agent = ?
      ORDER BY created_at ASC, rowid ASC
    `).bind(sessionId, agent).all();

    return {
      status: 200,
      data: {
        rolled_back_to: targetMessageId,
        session_id: sessionId,
        agent,
        messages: remaining?.results || []
      }
    };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}

/**
 * Handles POST /api/settings/provider to swap active LLM provider or store keys.
 */
export async function handleProviderSwitch(request, db) {
  const body = await request.json();
  const updates = [];

  if (body.provider && ['gemini', 'claude'].includes(body.provider)) {
    updates.push(['active_provider', body.provider]);
  }
  if (body.tier && ['light', 'smart'].includes(body.tier)) {
    updates.push(['active_tier', body.tier]);
  }
  if (typeof body.gemini_api_key === 'string') {
    updates.push(['gemini_api_key', body.gemini_api_key.trim()]);
  }
  if (typeof body.claude_api_key === 'string') {
    updates.push(['claude_api_key', body.claude_api_key.trim()]);
  }
  if (typeof body.rest_window === 'string') {
    updates.push(['rest_window', body.rest_window.trim()]);
  }

  for (const [k, v] of updates) {
    await db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(k, v).run();
  }

  const current = await db.prepare(`
    SELECT key, value FROM system_settings
    WHERE key IN ('active_provider', 'active_tier', 'rest_window')
  `).all();

  return {
    status: 200,
    data: {
      updated: updates.map(u => u[0]),
      settings: Object.fromEntries((current?.results || []).map(r => [r.key, r.value]))
    }
  };
}
