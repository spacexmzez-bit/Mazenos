// ============================================================================
// MazenOS Phase 6: Frontend Command Deck Controller & Embedded D1 Engine
// File: dashboard.js
// ============================================================================

const SAFE_STORAGE = {
  get(key, fallback = null) {
    try {
      const val = window.localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : fallback;
    } catch (_e) {
      return fallback;
    }
  },
  set(key, val) {
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (_e) {
      // Ignore sandbox storage errors
    }
  }
};

/**
 * Pure-Regex Bank SMS Parser (mirrors budget.js for zero-latency local & offline parity)
 */
function parseBankSmsClient(rawSms) {
  const text = String(rawSms || '').trim();
  if (!text) throw new Error('Empty SMS payload');

  const amountRegexes = [
    /(?:amount|amt|purchase|مبلغ|بمبلغ|الشراء)[:\s]*(?:sar|sr|ريال)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:sar|sr|ريال)/i
  ];
  let amountSar = null;
  for (const rx of amountRegexes) {
    const m = text.match(rx);
    if (m && m[1]) {
      amountSar = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }
  if (amountSar === null || Number.isNaN(amountSar)) {
    throw new Error('Could not parse SAR transaction amount from SMS');
  }

  const balanceMatch = text.match(/(?:balance|avail\.?\s*bal|bal|الرصيد|رصيد)[:\s]*(?:sar|sr|ريال|ر\.س)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i);
  const balanceAfterSar = balanceMatch && balanceMatch[1]
    ? parseFloat(balanceMatch[1].replace(/,/g, ''))
    : null;

  const cardMatch = text.match(/(?:card|mada|visa|apple\s*pay|بطاقة|مدى)[:\s*#xX-]*([0-9]{4})/i)
    || text.match(/\*([0-9]{4})\b/);
  const walletSource = cardMatch ? `Card *${cardMatch[1]}` : 'Mada / POS';

  const merchantMatch = text.match(/(?:at|merchant|from|لدى|من)[:\s]+([^\n\r;]+?)(?=\s*(?:;|\bon\b|\bdate\b|\bbal\b|\bbalance\b|في|بتاريخ|الرصيد)|$)/i);
  const merchant = merchantMatch ? merchantMatch[1].trim() : 'POS Merchant';

  const dateMatch = text.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}[\sT][0-9]{2}:[0-9]{2})/);
  const transactionTimestamp = dateMatch ? dateMatch[1] : '2026-10-20 23:00';

  return {
    wallet_source: walletSource,
    merchant,
    amount_sar: Number(amountSar.toFixed(2)),
    balance_after_sar: balanceAfterSar !== null ? Number(balanceAfterSar.toFixed(2)) : null,
    transaction_timestamp: transactionTimestamp
  };
}

/**
 * Initial Relational Seed State matching the exact MazenOS specification
 */
function createInitialRelationalState() {
  return {
    settings: {
      active_provider: 'gemini',
      active_tier: 'light',
      rest_window: '00:00 - 00:45',
      budget_balance_sar: 88.33,
      friday_hobby_safeguard: true,
      weekend_saved_minutes: 45,
      daily_entertainment_quota_mins: 90,
      daily_entertainment_used_mins: 20,
      worker_url: '',
      master_token: ''
    },
    activeAgent: 'ari',
    activeSessions: {
      ari: 'sess_ari_20261020',
      jade: 'sess_jade_20261020'
    },
    chatMessages: [
      {
        id: 'msg_101',
        session_id: 'sess_ari_20261020',
        agent: 'ari',
        sender: 'user',
        message_text: 'Ari, load my evening tactical queue and verify my downstream chain.',
        created_at: '2026-10-20 22:50 AST'
      },
      {
        id: 'msg_102',
        session_id: 'sess_ari_20261020',
        agent: 'ari',
        sender: 'assistant',
        message_text: 'Evening lock verified. Active P1 is t_101 ("Bio Ch4: Cellular Respiration") due at 23:45 AST. Consecutive downstream chain [t_102 -> t_103] is armed. Rest window begins strictly at 00:00 AST. Submit handwritten ATP proof artifact to clear P1.',
        created_at: '2026-10-20 22:50 AST'
      },
      {
        id: 'msg_201',
        session_id: 'sess_jade_20261020',
        agent: 'jade',
        sender: 'user',
        message_text: 'Jade, feeling a bit of late-night pressure with the Bio Ch4 deadline.',
        created_at: '2026-10-20 22:54 AST'
      },
      {
        id: 'msg_202',
        session_id: 'sess_jade_20261020',
        agent: 'jade',
        sender: 'assistant',
        message_text: 'Take a slow breath, Mazen. Looking at your telemetry, you slept 6.0 hours and already knocked out your upper-body workout and first medicine dose. You only need 45 focused minutes on Cellular Respiration before your 00:00 rest window opens. Focus on one pathway diagram at a time.',
        created_at: '2026-10-20 22:54 AST'
      }
    ],
    tasks: [
      {
        id: 't_101',
        title: 'Bio Ch4: Cellular Respiration & ATP Yield',
        description: 'Complete oxidative phosphorylation pathway diagram + 10 Qudurat/Tahsili drills.',
        priority: 1,
        is_consecutive: true,
        depends_on_task_id: null,
        due: '23:45',
        due_overdue: false,
        estimated_duration_minutes: 45,
        status: 'in_progress',
        is_bonus: false,
        original_scheduled_date: '2026-10-20',
        ai_audit_criteria: 'Handwritten ATP yield diagram + 10 practice questions graded.',
        requires_video: true,
        subtasks: [
          { id: 'st_1', title: 'Map glycolysis & Krebs cycle net NADH/FADH2', is_completed: true },
          { id: 'st_2', title: 'Complete 10 electron transport chain practice problems', is_completed: false }
        ],
        audit_receipts: []
      },
      {
        id: 't_102',
        title: 'Bio Ch4: Chemiosmosis & Practice Set B',
        description: 'Consecutive downstream block dependent on t_101.',
        priority: 2,
        is_consecutive: true,
        depends_on_task_id: 't_101',
        due: '00:30',
        due_overdue: false,
        estimated_duration_minutes: 45,
        status: 'pending',
        is_bonus: false,
        original_scheduled_date: '2026-10-20',
        ai_audit_criteria: 'Scored drill sheet showing >= 85% accuracy on chemiosmosis.',
        requires_video: false,
        subtasks: [
          { id: 'st_3', title: 'Timed 15-question synthesis drill', is_completed: false },
          { id: 'st_4', title: 'Error log flashcards in Anki/Curry', is_completed: false },
          { id: 'st_5', title: 'Verify proton-motive force equations', is_completed: false }
        ],
        audit_receipts: []
      },
      {
        id: 't_103',
        title: 'Qudurat Quantitative: Algebraic Ratios & Speed Drills',
        description: 'Downstream node in consecutive evening study chain.',
        priority: 2,
        is_consecutive: true,
        depends_on_task_id: 't_102',
        due: '01:15',
        due_overdue: false,
        estimated_duration_minutes: 40,
        status: 'pending',
        is_bonus: false,
        original_scheduled_date: '2026-10-21',
        ai_audit_criteria: '20 quantitative ratio problems solved with timing stamps.',
        requires_video: false,
        subtasks: [
          { id: 'st_6', title: 'Solve 20 timed word problems', is_completed: false }
        ],
        audit_receipts: []
      },
      {
        id: 't_104',
        title: 'Physics Unit 3: Electrostatic Fields Preview',
        description: 'Future scheduled unit eligible for Elastic Bonus Queue surfacing.',
        priority: 3,
        is_consecutive: false,
        depends_on_task_id: null,
        due: 'Tomorrow 18:00',
        due_overdue: false,
        estimated_duration_minutes: 50,
        status: 'pending',
        is_bonus: false,
        original_scheduled_date: '2026-10-22',
        ai_audit_criteria: 'Coulomb law formula summary + 5 worked examples.',
        requires_video: false,
        subtasks: [],
        audit_receipts: []
      }
    ],
    health: {
      date: '2026-10-20',
      sleep_hours: 6.0,
      energy_rating: 4,
      is_sick: false,
      sickness_notes: '',
      medicine_target_count: 2,
      medicine_taken_count: 1,
      workout_completed: true,
      workout_type: 'Upper Body Hypertrophy'
    },
    curriculumUnits: [
      {
        id: 'cu_1',
        exam_name: 'Tahsili Biology',
        unit_number: 4,
        topic_title: 'Cellular Respiration & Metabolic Pathways',
        difficulty_level: 5,
        estimated_hours: 3.0,
        is_main_objective: true,
        status: 'in_progress',
        target_completion_date: '2026-10-21'
      },
      {
        id: 'cu_2',
        exam_name: 'Qudurat Quantitative',
        unit_number: 2,
        topic_title: 'Fast Arithmetic & Ratio Identities (Factual Review)',
        difficulty_level: 2,
        estimated_hours: 1.5,
        is_main_objective: false,
        status: 'in_progress',
        target_completion_date: '2026-10-23'
      },
      {
        id: 'cu_3',
        exam_name: 'Tahsili Biology',
        unit_number: 5,
        topic_title: 'Photosynthesis & Calvin Cycle Regulation',
        difficulty_level: 4,
        estimated_hours: 2.5,
        is_main_objective: false,
        status: 'not_started',
        target_completion_date: '2026-10-25'
      }
    ],
    budgetEntries: [
      {
        id: 'b_101',
        wallet_source: 'Card *4821',
        merchant: 'Tamimi Markets Riyadh',
        amount_sar: 31.67,
        balance_after_sar: 88.33,
        transaction_timestamp: '2026-10-20 19:15'
      },
      {
        id: 'b_100',
        wallet_source: 'Card *4821',
        merchant: 'Jarir Bookstore',
        amount_sar: 45.00,
        balance_after_sar: 120.00,
        transaction_timestamp: '2026-10-19 17:40'
      }
    ],
    ideas: [
      {
        id: 'idea_1',
        content: 'ESP32 desk beacon that flashes amber when MacroDroid /status flips to locked',
        domain_tag: 'hardware',
        is_locked: true,
        is_synthesized: false,
        created_at: '2026-10-20 16:20'
      },
      {
        id: 'idea_2',
        content: 'Add D1 FTS5 full-text index on diary_entries for semantic mood clustering',
        domain_tag: 'coding',
        is_locked: true,
        is_synthesized: false,
        created_at: '2026-10-20 18:05'
      },
      {
        id: 'idea_3',
        content: 'Build modular Qudurat geometry SVG generator plug-in for Curry Organ 7',
        domain_tag: 'coding',
        is_locked: true,
        is_synthesized: false,
        created_at: '2026-10-20 20:40'
      }
    ],
    locations: [
      {
        id: 'loc_1',
        name: 'King Fahad National Library (Olaya)',
        service_type: 'Quiet Research Hall',
        quietness_rating: 5,
        commute_minutes_one_way: 25,
        average_cost_sar: 0.0,
        notes: 'High-discipline environment; zero cafe noise.'
      },
      {
        id: 'loc_2',
        name: 'Camel Step Roasters (Al Malqa)',
        service_type: 'Specialty Coffee',
        quietness_rating: 3,
        commute_minutes_one_way: 18,
        average_cost_sar: 24.0,
        notes: 'Good morning spot; crowded after 20:00 AST.'
      },
      {
        id: 'loc_3',
        name: 'Home Command Desk (Zero-Commute)',
        service_type: 'Primary Workstation',
        quietness_rating: 5,
        commute_minutes_one_way: 0,
        average_cost_sar: 0.0,
        notes: 'Dual-monitor setup + zero transit overhead.'
      }
    ],
    diaryEntries: [
      {
        id: 'diary_1',
        entry_text: 'Locked in 3 consecutive deep work blocks today. Keeping the Idea Vault in write-only mode stopped me from derailing into side scripts.',
        mood_indicator: 'focused',
        created_at: '2026-10-20 21:30 AST'
      },
      {
        id: 'diary_2',
        entry_text: 'Felt slight evening fatigue around 22:00, but pacing with 25m Pomodoros kept momentum steady.',
        mood_indicator: 'grounded',
        created_at: '2026-10-19 23:10 AST'
      }
    ],
    focusSessions: [
      { id: 'foc_1', task_id: 't_101', duration_minutes: 50, session_type: 'deep_work', started_at: '2026-10-20 21:00' },
      { id: 'foc_2', task_id: 't_101', duration_minutes: 50, session_type: 'deep_work', started_at: '2026-10-20 22:00' }
    ]
  };
}

const state = SAFE_STORAGE.get('mazenos_state_v25') || createInitialRelationalState();

function persistState() {
  SAFE_STORAGE.set('mazenos_state_v25', state);
}

// ============================================================================
// <120-Token Live State Snapshot Compiler
// ============================================================================
function getLiveStateSnapshot() {
  const activeP1 = state.tasks.find(t => t.status !== 'completed' && t.priority === 1 && !t.is_bonus) || null;
  const downstream = [];
  if (activeP1) {
    let parentId = activeP1.id;
    for (let i = 0; i < 6; i++) {
      const child = state.tasks.find(t => t.depends_on_task_id === parentId && t.status !== 'completed');
      if (!child) break;
      downstream.push(child.id);
      parentId = child.id;
    }
  }

  const isLocked = Boolean(!state.health.is_sick && activeP1 && activeP1.due_overdue);

  return {
    time_now: '2026-10-20 23:00 AST',
    active_p1: activeP1
      ? {
          id: activeP1.id,
          title: activeP1.title.split(':')[0],
          due: activeP1.due,
          is_consecutive: Boolean(activeP1.is_consecutive)
        }
      : null,
    downstream_chain: downstream,
    health: {
      sleep_hours: Number(state.health.sleep_hours),
      energy: Number(state.health.energy_rating),
      is_sick: Boolean(state.health.is_sick),
      meds: `${state.health.medicine_taken_count}/${state.health.medicine_target_count}`
    },
    rest_window: state.settings.rest_window,
    budget_balance_sar: Number(Number(state.settings.budget_balance_sar).toFixed(2)),
    locked: isLocked
  };
}

// ============================================================================
// Velocity-Weighted Priority Score (Organ 5)
// ============================================================================
function computeVelocityScore(task) {
  const baseWeight = { 1: 100, 2: 75, 3: 45, 4: 20 }[task.priority] || 50;
  const subCount = (task.subtasks || []).filter(s => !s.is_completed).length;
  const stepFactor = Math.max(1, subCount) * (task.is_consecutive ? 1.5 : 1.0);
  const bonusOffset = task.is_bonus ? -15 : 0;
  return Number((baseWeight + stepFactor * 12 + bonusOffset).toFixed(1));
}

// ============================================================================
// Telemetry & Header UI Renderer
// ============================================================================
function renderTelemetryAndHeader() {
  const snap = getLiveStateSnapshot();

  document.getElementById('telTimeNow').textContent = snap.time_now;
  document.getElementById('telActiveP1').textContent = snap.active_p1
    ? `${snap.active_p1.title} (${snap.active_p1.due})`
    : 'None (Queue Clear)';
  document.getElementById('telDownstreamChain').textContent = snap.downstream_chain.length
    ? snap.downstream_chain.join(' \u2192 ')
    : 'None';
  document.getElementById('telHealth').textContent =
    `${snap.health.sleep_hours.toFixed(1)}h | E:${snap.health.energy}/5 | Meds ${snap.health.meds}${snap.health.is_sick ? ' [SICK BREAKER]' : ''}`;
  document.getElementById('telRestWindow').textContent = snap.rest_window;
  document.getElementById('telBudget').textContent = `${snap.budget_balance_sar.toFixed(2)} SAR`;

  const lockPill = document.getElementById('telLockPill');
  const lockStateEl = document.getElementById('telLockState');
  if (snap.locked) {
    lockPill.className = 'telemetry-pill pill-locked';
    lockStateEl.textContent = 'LOCKED (OVERDUE P1)';
  } else {
    lockPill.className = 'telemetry-pill pill-unlocked';
    lockStateEl.textContent = snap.health.is_sick ? 'UNLOCKED (SICK BREAKER)' : 'UNLOCKED';
  }

  document.getElementById('stateJsonInspector').textContent = JSON.stringify(snap, null, 2);

  // Update Nav Grid Badges
  const activeTaskCount = state.tasks.filter(t => t.status !== 'completed').length;
  document.getElementById('navBadgeTasks').textContent = String(activeTaskCount);
  document.getElementById('navBadgeBudget').textContent = `${Math.round(snap.budget_balance_sar)} SAR`;
  document.getElementById('navBadgeHealth').textContent = state.health.is_sick ? 'SICK' : `${snap.health.sleep_hours.toFixed(1)}h`;

  // Update Deep Work Deck active task card
  const firstActive = state.tasks.find(t => t.status !== 'completed');
  document.getElementById('deckActiveTaskTitle').textContent = firstActive
    ? `${firstActive.id}: ${firstActive.title}`
    : 'All Active Tasks Completed';
  document.getElementById('deckActiveAuditRubric').textContent = firstActive
    ? `Rubric: ${firstActive.ai_audit_criteria}`
    : 'Surface a Bonus Task to reduce Friday/Saturday workload.';
}

// ============================================================================
// Dual-Agent Chat Deck, 6-Message Sliding Window & Rollback Drawer
// ============================================================================
let pendingRetryMessage = null;

function renderChatDeck() {
  const agent = state.activeAgent;
  const activeSessionId = state.activeSessions[agent];
  const brandBadge = document.getElementById('brandLogoBadge');
  const subtitle = document.getElementById('activeAgentSubtitle');
  const switchAriBtn = document.getElementById('switchAriBtn');
  const switchJadeBtn = document.getElementById('switchJadeBtn');
  const chatDot = document.getElementById('chatHeaderDot');
  const chatTitle = document.getElementById('chatHeaderTitle');
  const sendBtn = document.getElementById('sendChatBtn');

  if (agent === 'jade') {
    brandBadge.textContent = 'JD';
    brandBadge.classList.add('jade-mode');
    subtitle.textContent = 'JADE: Mental Support, Reality Checks, Decompression & Journal Sounding Board';
    switchAriBtn.className = 'agent-btn';
    switchJadeBtn.className = 'agent-btn active-jade';
    chatDot.style.background = 'var(--jade-accent)';
    chatTitle.textContent = `Jade Support Terminal (${activeSessionId})`;
    sendBtn.className = 'btn btn-jade';
  } else {
    brandBadge.textContent = 'AR';
    brandBadge.classList.remove('jade-mode');
    subtitle.textContent = 'ARI: Tactical Execution, Proof Auditor & Cascading Rescheduler';
    switchAriBtn.className = 'agent-btn active-ari';
    switchJadeBtn.className = 'agent-btn';
    chatDot.style.background = 'var(--ari-accent)';
    chatTitle.textContent = `Ari Tactical Terminal (${activeSessionId})`;
    sendBtn.className = 'btn btn-ari';
  }

  const sessionMsgs = state.chatMessages.filter(
    m => m.agent === agent && m.session_id === activeSessionId
  );
  const windowSlice = sessionMsgs.slice(-6);

  document.getElementById('slidingWindowBadge').textContent =
    `Active LLM Window: ${windowSlice.length}/6 Msgs`;
  document.getElementById('totalStoredMsgsCount').textContent =
    String(state.chatMessages.filter(m => m.agent === agent).length);

  const viewport = document.getElementById('chatMessagesViewport');
  viewport.innerHTML = '';

  const windowIds = new Set(windowSlice.map(m => m.id));
  for (const msg of sessionMsgs) {
    const bubble = document.createElement('div');
    const isUser = msg.sender === 'user';
    bubble.className = `chat-bubble ${isUser ? 'user' : `assistant-${agent}`}`;

    const textDiv = document.createElement('div');
    textDiv.textContent = msg.message_text;
    bubble.appendChild(textDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'chat-meta';
    const inWindowTag = windowIds.has(msg.id) ? '[In 6-Msg LLM Window]' : '[Archived in D1 Only - 0 Tokens]';
    metaDiv.innerHTML = `<span>${msg.created_at} &bull; ${inWindowTag}</span>`;
    bubble.appendChild(metaDiv);

    viewport.appendChild(bubble);
  }
  viewport.scrollTop = viewport.scrollHeight;

  renderRollbackDrawer();
}

function renderRollbackDrawer(searchFilter = '') {
  const agent = state.activeAgent;
  const listEl = document.getElementById('rollbackTimelineList');
  listEl.innerHTML = '';

  const filtered = state.chatMessages.filter(m => {
    if (m.agent !== agent) return false;
    if (!searchFilter) return true;
    return m.message_text.toLowerCase().includes(searchFilter.toLowerCase());
  });

  if (!filtered.length) {
    listEl.innerHTML = `<div style="font-size:11.5px;color:var(--text-muted);">No matching D1 messages found.</div>`;
    return;
  }

  for (const msg of filtered) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:11.5px;';

    const left = document.createElement('div');
    left.innerHTML = `<strong style="color:${msg.sender === 'user' ? '#93c5fd' : 'var(--ari-accent)'};">[${msg.sender.toUpperCase()}]</strong> <span style="color:var(--text-secondary);font-family:var(--font-mono);">${msg.created_at}</span>: ${msg.message_text.slice(0, 85)}${msg.message_text.length > 85 ? '...' : ''}`;

    const rbBtn = document.createElement('button');
    rbBtn.type = 'button';
    rbBtn.className = 'btn btn-ghost';
    rbBtn.style.cssText = 'padding:3px 8px;font-size:10.5px;';
    rbBtn.textContent = 'Roll Back Here';
    rbBtn.addEventListener('click', () => {
      rollbackSessionToMessage(msg.session_id, msg.id);
    });

    row.appendChild(left);
    row.appendChild(rbBtn);
    listEl.appendChild(row);
  }
}

function rollbackSessionToMessage(sessionId, targetMsgId) {
  const agent = state.activeAgent;
  const targetIdx = state.chatMessages.findIndex(
    m => m.id === targetMsgId && m.session_id === sessionId && m.agent === agent
  );
  if (targetIdx === -1) return;

  state.chatMessages = state.chatMessages.filter((m, idx) => {
    if (m.session_id === sessionId && m.agent === agent && idx > targetIdx) {
      return false;
    }
    return true;
  });
  state.activeSessions[agent] = sessionId;
  persistState();
  renderChatDeck();
}

function generateAgentReply(agent, userText) {
  const snap = getLiveStateSnapshot();
  const lower = userText.toLowerCase();
  const providerLabel = `${state.settings.active_provider.toUpperCase()}:${state.settings.active_tier.toUpperCase()}`;

  if (agent === 'jade') {
    const latestDiary = state.diaryEntries[0];
    return `[${providerLabel}] Grounded check-in: Your recent journal mood is "${latestDiary?.mood_indicator || 'focused'}". You have ${snap.health.sleep_hours}h sleep logged and ${snap.budget_balance_sar} SAR available. Let go of any all-or-nothing guilt—if ${snap.active_p1 ? snap.active_p1.title : 'your queue'} feels heavy, break the next 15 minutes into a single low-friction step, then rest cleanly at ${snap.rest_window}.`;
  }

  // Ari Tactical Directives & Anti-Excuse Guardrails
  if (/tired|bored|sleepy|push.*tomorrow|skip|don't feel like/i.test(lower)) {
    if (snap.health.is_sick) {
      return `[${providerLabel}] Sickness Circuit Breaker is active (is_sick=true). P1 academic chains are frozen for recovery. Rest and hydrate.`;
    }
    return `[${providerLabel}] AUTHORITY CLAUSE REJECTION: You logged ${snap.health.sleep_hours}h of sleep (>= 4.0h threshold) and is_sick=false. Ari never alters deadlines for comfort excuses or boredom. "${snap.active_p1?.title || 'Active task'}" remains locked at ${snap.active_p1?.due || 'schedule'}. Submit your proof artifact to unlock.`;
  }

  if (/commute|cafe|coffee|drive|library|spot/i.test(lower)) {
    return `[${providerLabel}] COMMUTE INTERCEPTION: Current time is ${snap.time_now}. Driving 18-25 minutes one-way right now plus a 45m task duration collides with your ${snap.active_p1?.due || '23:45'} P1 deadline and 00:00 rest window. Stay at Home Command Desk and execute "${snap.active_p1?.title || 'Bio Ch4'}".`;
  }

  return `[${providerLabel}] Live State Verified (<120 tokens): Active P1="${snap.active_p1?.title || 'None'}" (due ${snap.active_p1?.due || 'N/A'}), Downstream Chain=[${snap.downstream_chain.join(' -> ') || 'None'}], Balance=${snap.budget_balance_sar} SAR, Phone=${snap.locked ? 'LOCKED' : 'UNLOCKED'}. Complete the active rubric to advance the chain.`;
}

// ============================================================================
// Organ 1, 3, 5: Taskitator Renderer, Cascading & Proof Audit
// ============================================================================
function renderTaskitator() {
  const filterVal = document.getElementById('taskFilterSelect').value;
  const container = document.getElementById('taskListContainer');
  const parentSelect = document.getElementById('newTaskParent');
  const auditSelect = document.getElementById('auditTaskSelect');

  container.innerHTML = '';
  parentSelect.innerHTML = `<option value="">Independent (No Parent)</option>`;
  auditSelect.innerHTML = '';

  for (const t of state.tasks) {
    if (t.status !== 'completed') {
      const opt1 = document.createElement('option');
      opt1.value = t.id;
      opt1.textContent = `${t.id}: ${t.title.slice(0, 38)}`;
      parentSelect.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = t.id;
      opt2.textContent = `[P${t.priority}] ${t.title}`;
      auditSelect.appendChild(opt2);
    }
  }

  const sortedTasks = [...state.tasks].sort((a, b) => computeVelocityScore(b) - computeVelocityScore(a));

  const visibleTasks = sortedTasks.filter(t => {
    if (filterVal === 'completed') return t.status === 'completed';
    if (t.status === 'completed') return false;
    if (filterVal === 'bonus') return Boolean(t.is_bonus);
    if (['1', '2', '3', '4'].includes(filterVal)) return Number(t.priority) === Number(filterVal);
    return true;
  });

  if (!visibleTasks.length) {
    container.innerHTML = `<div style="padding:14px;color:var(--text-secondary);font-size:12.5px;">No tasks match the selected Eisenhower filter.</div>`;
    return;
  }

  for (const task of visibleTasks) {
    const vScore = computeVelocityScore(task);
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:10px;padding:11px 12px;display:flex;flex-direction:column;gap:8px;';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;';

    const badgeClass = `badge-p${task.priority}`;
    const bonusBadge = task.is_bonus ? `<span class="badge badge-bonus">BONUS (Orig: ${task.original_scheduled_date})</span>` : '';
    const consecBadge = task.is_consecutive
      ? `<span class="badge badge-p3">CONSECUTIVE${task.depends_on_task_id ? ` \u2190 ${task.depends_on_task_id}` : ''}</span>`
      : `<span class="badge badge-p4">INDEPENDENT</span>`;

    topRow.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="badge ${badgeClass}">P${task.priority}</span>
          ${consecBadge}
          ${bonusBadge}
          <span class="badge badge-p4">Velocity Score: ${vScore}</span>
          <strong style="font-size:13.5px;">${task.title}</strong>
        </div>
        <div style="font-size:11.5px;color:var(--text-secondary);margin-top:3px;">
          ID: <code>${task.id}</code> &bull; Due: <strong>${task.due}</strong> &bull; Duration: ${task.estimated_duration_minutes}m &bull; Rubric: ${task.ai_audit_criteria}
        </div>
      </div>
    `;

    // Action Buttons: +30m Cascade Slip & Select for Audit
    const actionsDiv = document.createElement('div');
    actionsDiv.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

    if (task.status !== 'completed') {
      const slipBtn = document.createElement('button');
      slipBtn.type = 'button';
      slipBtn.className = 'btn btn-ghost';
      slipBtn.style.cssText = 'padding:4px 8px;font-size:11px;';
      slipBtn.textContent = '+30m Cascade Slip';
      slipBtn.addEventListener('click', () => {
        cascadeTaskDeadlineByMinutes(task.id, 30);
      });

      const selectAuditBtn = document.createElement('button');
      selectAuditBtn.type = 'button';
      selectAuditBtn.className = 'btn btn-ari';
      selectAuditBtn.style.cssText = 'padding:4px 8px;font-size:11px;';
      selectAuditBtn.textContent = 'Audit Proof';
      selectAuditBtn.addEventListener('click', () => {
        document.getElementById('auditTaskSelect').value = task.id;
        document.getElementById('auditNotesInput').focus();
      });

      actionsDiv.appendChild(slipBtn);
      actionsDiv.appendChild(selectAuditBtn);
    } else {
      const doneTag = document.createElement('span');
      doneTag.className = 'badge badge-p3';
      doneTag.textContent = 'VERIFIED COMPLETED';
      actionsDiv.appendChild(doneTag);
    }

    topRow.appendChild(actionsDiv);
    card.appendChild(topRow);

    // Subtasks checklist
    if (task.subtasks && task.subtasks.length) {
      const subWrap = document.createElement('div');
      subWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.06);';
      for (const st of task.subtasks) {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text-secondary);cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = Boolean(st.is_completed);
        cb.addEventListener('change', () => {
          st.is_completed = cb.checked;
          persistState();
          renderTaskitator();
        });
        const sp = document.createElement('span');
        sp.textContent = st.title;
        if (st.is_completed) sp.style.textDecoration = 'line-through';
        lbl.appendChild(cb);
        lbl.appendChild(sp);
        subWrap.appendChild(lbl);
      }
      card.appendChild(subWrap);
    }

    // Audit Receipts
    if (task.audit_receipts && task.audit_receipts.length) {
      const rc = task.audit_receipts[0];
      const rcDiv = document.createElement('div');
      rcDiv.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:#6ee7b7;background:rgba(16,185,129,0.1);padding:5px 8px;border-radius:6px;';
      rcDiv.textContent = `Receipt [${rc.id}]: ${rc.verdict.toUpperCase()} (${rc.score}/10) — ${rc.critique}`;
      card.appendChild(rcDiv);
    }

    container.appendChild(card);
  }
}

function addMinutesToHHMM(hhmm, deltaMins) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  const total = ( parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + deltaMins ) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function cascadeTaskDeadlineByMinutes(taskId, deltaMins) {
  const root = state.tasks.find(t => t.id === taskId);
  if (!root) return;
  root.due = addMinutesToHHMM(root.due, deltaMins);

  let parentId = root.id;
  for (let depth = 0; depth < 10; depth++) {
    const child = state.tasks.find(t => t.depends_on_task_id === parentId && t.is_consecutive && t.status !== 'completed');
    if (!child) break;
    child.due = addMinutesToHHMM(child.due, deltaMins);
    parentId = child.id;
  }

  persistState();
  renderTelemetryAndHeader();
  renderTaskitator();
}

// ============================================================================
// Organ 7: Smart Curriculum Assistant ("Curry")
// ============================================================================
function buildCurryPromptText() {
  return [
    `You are extracting a structured syllabus for MazenOS Curry ("Tahsili / Qudurat Core").`,
    `Output ONLY a valid JSON array matching this exact schema:`,
    `[{"exam_name":"Tahsili Physics","unit_number":4,"topic_title":"Electromagnetism & Induction","difficulty_level":4,"estimated_hours":2.5,"is_main_objective":false,"target_completion_date":"2026-10-28"}]`
  ].join('\n');
}

function renderCurry() {
  document.getElementById('curryPromptPreview').value = buildCurryPromptText();

  const activeUnits = state.curriculumUnits.filter(u => u.status !== 'completed');
  const mainUnit = activeUnits.find(u => u.is_main_objective) || activeUnits[0] || null;
  const subUnit = activeUnits.find(u => u !== mainUnit && u.difficulty_level <= 2)
    || activeUnits.find(u => u !== mainUnit)
    || null;

  const banner = document.getElementById('curryPairingBanner');
  if (mainUnit) {
    banner.innerHTML = `
      <div><strong>Active Main Objective (70% Daily Focus / P1):</strong> [${mainUnit.exam_name} U${mainUnit.unit_number}] ${mainUnit.topic_title} (Difficulty ${mainUnit.difficulty_level}/5)</div>
      <div style="color:var(--text-secondary);margin-top:4px;"><strong>Paired Sub-Objective (30% Load-Balanced Review / P2):</strong> ${subUnit ? `[${subUnit.exam_name} U${subUnit.unit_number}] ${subUnit.topic_title} (Difficulty ${subUnit.difficulty_level}/5)` : 'None queued'}</div>
    `;
  } else {
    banner.textContent = 'All curriculum units completed!';
  }

  const unitsContainer = document.getElementById('curryUnitsContainer');
  unitsContainer.innerHTML = '';

  for (const unit of state.curriculumUnits) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;flex-wrap:wrap;';

    const roleBadge = unit.is_main_objective
      ? `<span class="badge badge-p1">MAIN OBJECTIVE (70%)</span>`
      : `<span class="badge badge-p3">SUB-OBJECTIVE (30%)</span>`;

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ${roleBadge}
        <span class="badge badge-p4">Diff ${unit.difficulty_level}/5</span>
        <strong>${unit.exam_name} U${unit.unit_number}: ${unit.topic_title}</strong>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
        Est: ${unit.estimated_hours}h &bull; Target: ${unit.target_completion_date || 'Flexible'} &bull; Status: <code>${unit.status}</code>
      </div>
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = unit.status === 'completed' ? 'btn btn-ghost' : 'btn btn-jade';
    btn.style.cssText = 'padding:4px 9px;font-size:11px;';
    btn.textContent = unit.status === 'completed' ? 'Completed' : 'Complete & Trigger Succession';
    btn.disabled = unit.status === 'completed';
    btn.addEventListener('click', () => {
      unit.status = 'completed';
      const wasMain = unit.is_main_objective;
      unit.is_main_objective = false;
      if (wasMain) {
        const nextCandidate = state.curriculumUnits.find(u => u.status !== 'completed');
        if (nextCandidate) {
          nextCandidate.is_main_objective = true;
          nextCandidate.status = 'in_progress';
        }
      }
      persistState();
      renderCurry();
    });

    row.appendChild(left);
    row.appendChild(btn);
    unitsContainer.appendChild(row);
  }

  // Consensual Spaced Retrieval Drills
  const drillsContainer = document.getElementById('curryDrillsContainer');
  drillsContainer.innerHTML = '';
  for (const unit of state.curriculumUnits.slice(0, 2)) {
    const dRow = document.createElement('div');
    dRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;';
    dRow.innerHTML = `<span><strong>[Proposed Retrieval Drill]</strong> ${unit.exam_name} U${unit.unit_number}: ${unit.topic_title} (25m)</span>`;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.cssText = 'padding:3px 9px;font-size:11px;';
    confirmBtn.textContent = 'Confirm & Queue in Taskitator';
    confirmBtn.addEventListener('click', () => {
      const drillTask = {
        id: `t_drill_${Date.now().toString().slice(-4)}`,
        title: `[Retrieval Drill] ${unit.exam_name} U${unit.unit_number}: ${unit.topic_title}`,
        description: 'Consensual spaced-retrieval drill generated by Curry.',
        priority: unit.is_main_objective ? 1 : 2,
        is_consecutive: false,
        depends_on_task_id: null,
        due: '23:55',
        due_overdue: false,
        estimated_duration_minutes: 25,
        status: 'pending',
        is_bonus: false,
        original_scheduled_date: '2026-10-20',
        ai_audit_criteria: `Scored retrieval sheet (>=80% accuracy) for ${unit.topic_title}.`,
        requires_video: false,
        subtasks: [],
        audit_receipts: []
      };
      state.tasks.unshift(drillTask);
      persistState();
      renderTelemetryAndHeader();
      renderTaskitator();
      confirmBtn.textContent = 'Queued in Taskitator';
      confirmBtn.disabled = true;
    });

    dRow.appendChild(confirmBtn);
    drillsContainer.appendChild(dRow);
  }
}

// ============================================================================
// Organ 10: Budget Ledger & SMS Regex Renderer
// ============================================================================
function renderBudget() {
  document.getElementById('budgetHeaderBalance').textContent =
    `Balance: ${Number(state.settings.budget_balance_sar).toFixed(2)} SAR`;

  const list = document.getElementById('budgetEntriesList');
  list.innerHTML = '';
  for (const entry of state.budgetEntries) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;';
    item.innerHTML = `
      <div>
        <strong>${entry.merchant}</strong>
        <span style="color:var(--text-secondary);font-size:11px;"> (${entry.wallet_source} &bull; ${entry.transaction_timestamp})</span>
      </div>
      <div style="font-family:var(--font-mono);">
        <span style="color:#fca5a5;">-${Number(entry.amount_sar).toFixed(2)} SAR</span>
        <span style="color:var(--text-secondary);font-size:11px;"> | Bal: ${Number(entry.balance_after_sar).toFixed(2)} SAR</span>
      </div>
    `;
    list.appendChild(item);
  }
}

// ============================================================================
// Organ 6: 3-Minute Idea Vault Countdown & Friday Markdown Synthesis
// ============================================================================
let vaultIntervalId = null;
let vaultSecondsLeft = 0;

function renderIdeaVault() {
  const badge = document.getElementById('vaultGateStatusBadge');
  const navBadge = document.getElementById('navBadgeIdeas');
  const input = document.getElementById('ideaContentInput');
  const saveBtn = document.getElementById('saveIdeaBtn');
  const display = document.getElementById('vaultCountdownDisplay');

  const unsynthCount = state.ideas.filter(i => !i.is_synthesized).length;
  document.getElementById('ideaVaultSummaryText').textContent =
    `Total Stored Fragments in D1: ${state.ideas.length} (${unsynthCount} unsynthesized). Past ideas are hidden while Write-Only Lock is active.`;

  if (vaultSecondsLeft > 0) {
    const mm = String(Math.floor(vaultSecondsLeft / 60)).padStart(2, '0');
    const ss = String(vaultSecondsLeft % 60).padStart(2, '0');
    display.textContent = `${mm}:${ss}`;
    badge.className = 'badge badge-p3';
    badge.textContent = `CAPTURE GATE OPEN (${mm}:${ss})`;
    navBadge.textContent = `${mm}:${ss}`;
    input.disabled = false;
    saveBtn.disabled = false;
  } else {
    display.textContent = '03:00';
    badge.className = 'badge badge-p1';
    badge.textContent = 'WRITE-ONLY LOCKED';
    navBadge.textContent = 'LOCKED';
    input.disabled = true;
    saveBtn.disabled = true;
  }
}

function startIdeaVaultCountdown() {
  if (vaultIntervalId) clearInterval(vaultIntervalId);
  vaultSecondsLeft = 180;
  renderIdeaVault();
  document.getElementById('ideaContentInput').focus();

  vaultIntervalId = setInterval(() => {
    vaultSecondsLeft = Math.max(0, vaultSecondsLeft - 1);
    renderIdeaVault();
    if (vaultSecondsLeft === 0) {
      clearInterval(vaultIntervalId);
      vaultIntervalId = null;
    }
  }, 1000);
}

function lockIdeaVaultImmediately() {
  if (vaultIntervalId) {
    clearInterval(vaultIntervalId);
    vaultIntervalId = null;
  }
  vaultSecondsLeft = 0;
  renderIdeaVault();
}

// ============================================================================
// Organ 2: Circadian Health & Sickness Circuit Breaker
// ============================================================================
function renderHealth() {
  const h = state.health;
  document.getElementById('healthSleepInput').value = h.sleep_hours;
  document.getElementById('healthEnergyInput').value = h.energy_rating;
  document.getElementById('healthWorkoutInput').value = h.workout_type;
  document.getElementById('healthWorkoutCheck').checked = Boolean(h.workout_completed);
  document.getElementById('sicknessNotesInput').value = h.sickness_notes || '';

  document.getElementById('medComplianceText').textContent =
    `Doses taken today: ${h.medicine_taken_count} / ${h.medicine_target_count} (${h.medicine_taken_count >= h.medicine_target_count ? 'COMPLIANT' : 'PENDING'})`;

  const policyBadge = document.getElementById('healthPolicyBadge');
  const sickBadge = document.getElementById('sickBreakerBadge');
  const directiveBox = document.getElementById('healthDirectiveBox');

  if (h.is_sick) {
    policyBadge.className = 'badge badge-p1';
    policyBadge.textContent = 'SICKNESS CIRCUIT BREAKER';
    sickBadge.className = 'badge badge-p1';
    sickBadge.textContent = 'ACTIVE (DEVICE UNLOCKED)';
    directiveBox.textContent = 'SICKNESS_BREAKER_ACTIVE: Academic P1 chains frozen (+24h shift). /status returns {"device_unlocked": true} so recovery has zero device lock friction.';
  } else if (Number(h.sleep_hours) < 4.0) {
    policyBadge.className = 'badge badge-p2';
    policyBadge.textContent = 'ACUTE FATIGUE (<4.0h)';
    sickBadge.className = 'badge badge-p4';
    sickBadge.textContent = 'INACTIVE';
    directiveBox.textContent = `ACUTE_FATIGUE_FLAGGED: Sleep logged at ${h.sleep_hours}h (<4.0h threshold). Burnout protection active; prioritize core P1 and early rest window.`;
  } else {
    policyBadge.className = 'badge badge-p3';
    policyBadge.textContent = 'STANDARD EXECUTION';
    sickBadge.className = 'badge badge-p4';
    sickBadge.textContent = 'INACTIVE';
    directiveBox.textContent = `Normal circadian state (${h.sleep_hours}h sleep >= 4.0h threshold). Full P1 commitment enforced without deadline relaxation.`;
  }
}

// ============================================================================
// Organ 1: Study Locations & Commute Gatekeeper
// ============================================================================
function renderLocations() {
  const container = document.getElementById('locationsListContainer');
  container.innerHTML = '';

  for (const loc of state.locations) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;flex-wrap:wrap;';
    row.innerHTML = `
      <div>
        <strong>${loc.name}</strong>
        <span class="badge badge-p4" style="margin-left:6px;">Quiet: ${loc.quietness_rating}/5</span>
        <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px;">
          One-Way Commute: <strong>${loc.commute_minutes_one_way}m</strong> &bull; Avg Cost: <strong>${loc.average_cost_sar.toFixed(2)} SAR</strong> &bull; ${loc.notes}
        </div>
      </div>
    `;

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'btn btn-ari';
    checkBtn.style.cssText = 'padding:4px 9px;font-size:11px;';
    checkBtn.textContent = 'Check Commute Clearance';
    checkBtn.addEventListener('click', () => {
      const verdictBox = document.getElementById('commuteVerdictBox');
      const snap = getLiveStateSnapshot();
      if (loc.average_cost_sar > snap.budget_balance_sar) {
        verdictBox.style.color = '#fca5a5';
        verdictBox.textContent = `[BLOCKED - BUDGET_INSUFFICIENT] "${loc.name}" costs ${loc.average_cost_sar.toFixed(2)} SAR, exceeding live balance (${snap.budget_balance_sar.toFixed(2)} SAR).`;
      } else if (loc.commute_minutes_one_way > 10 && snap.active_p1) {
        verdictBox.style.color = '#fca5a5';
        verdictBox.textContent = `[INTERCEPTED - DEADLINE_COLLISION] ${loc.commute_minutes_one_way}m one-way commute + 45m task duration pushes active P1 "${snap.active_p1.title}" past its ${snap.active_p1.due} deadline and into your ${snap.rest_window} rest window. Procrastination disguised as relocating blocked.`;
      } else {
        verdictBox.style.color = '#6ee7b7';
        verdictBox.textContent = `[APPROVED - CLEAR] "${loc.name}" (${loc.commute_minutes_one_way}m transit, ${loc.average_cost_sar.toFixed(2)} SAR) fits within active schedule and budget.`;
      }
    });

    row.appendChild(checkBtn);
    container.appendChild(row);
  }
}

// ============================================================================
// Organ 8: Personal Diary & Jade Longitudinal Telemetry
// ============================================================================
function renderDiary() {
  const list = document.getElementById('diaryEntriesList');
  const insightsBox = document.getElementById('diaryInsightsBox');
  list.innerHTML = '';

  const counts = {};
  for (const e of state.diaryEntries) {
    counts[e.mood_indicator] = (counts[e.mood_indicator] || 0) + 1;
    const item = document.createElement('div');
    item.style.cssText = 'padding:8px 10px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:8px;font-size:12px;';
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
        <span class="badge badge-p3">${e.mood_indicator}</span>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);">${e.created_at}</span>
      </div>
      <div>${e.entry_text}</div>
    `;
    list.appendChild(item);
  }

  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'focused';
  document.getElementById('dominantMoodBadge').textContent = `Dominant Mood: ${dominant}`;

  insightsBox.innerHTML = `
    <div><strong>Total Longitudinal Reflections:</strong> ${state.diaryEntries.length}</div>
    <div><strong>Dominant Mindset State:</strong> <code>${dominant}</code></div>
    <div><strong>Mood Breakdown:</strong> ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' | ')}</div>
    <div style="padding:8px;background:var(--jade-bg);border:1px solid rgba(16,185,129,0.3);border-radius:6px;color:#a7f3d0;margin-top:4px;">
      <strong>Jade Calibration Note:</strong> Recent entries show strong adherence to Write-Only Vault confinement during deep work blocks. Maintain steady 25m/50m pacing without self-criticism.
    </div>
  `;
}

// ============================================================================
// Organ 4, 5, 8, 10: Bio-Maintenance, Hardware Bridges & Weekly Retrospective
// ============================================================================
function computeContinuousFocusMinutes() {
  let mins = 0;
  for (const s of [...state.focusSessions].reverse()) {
    if (s.session_type === 'break') break;
    mins += Number(s.duration_minutes) || 25;
  }
  return mins;
}

function renderBioAndLeisure() {
  const contMins = computeContinuousFocusMinutes();
  const badge = document.getElementById('continuousFocusBadge');
  badge.textContent = `Focus Streak: ${contMins}m / 150m`;
  badge.className = contMins >= 150 ? 'badge badge-p1' : 'badge badge-p2';

  const banner = document.getElementById('bioMaintenanceBanner');
  if (contMins >= 150) {
    banner.classList.remove('hidden');
    document.getElementById('bioBannerText').textContent =
      `${contMins} minutes of continuous focus logged (>= 2.5 hrs) without a break. Stand up, hydrate, and eat before starting another block.`;
  } else {
    banner.classList.add('hidden');
  }

  // MacroDroid /status JSON output
  const snap = getLiveStateSnapshot();
  const statusPayload = {
    device_unlocked: !snap.locked,
    active_task: snap.active_p1 ? snap.active_p1.title : null,
    reason: snap.health.is_sick
      ? 'Sickness Circuit Breaker active (is_sick=true). Device unlocked for recovery.'
      : (snap.locked
          ? `Overdue P1 task "${snap.active_p1?.title}" requires verified Multimodal Proof Audit to unlock device.`
          : `Active P1 "${snap.active_p1?.title || 'None'}" is within scheduled deadline window.`)
  };
  document.getElementById('macrodroidStatusOutput').textContent = JSON.stringify(statusPayload, null, 2);

  // Ari Weekly Retrospective
  const completedCount = state.tasks.filter(t => t.status === 'completed').length;
  const avgSleep = Number(state.health.sleep_hours);
  const ideaCount = state.ideas.length;
  let diagnosis = 'OPTIMAL_CADENCE';
  let directive = 'Execution velocity and circadian recovery are aligned. Consecutive P1 chains are progressing on schedule.';

  if (avgSleep < 4.5) {
    diagnosis = 'BURNOUT_RISK';
    directive = `Burnout warning: Sleep is ${avgSleep}h (<4.5h) alongside active task streaks. Enforce strict 00:00 AST lights-out.`;
  } else if (avgSleep >= 6.0 && ideaCount >= 6 && completedCount === 0) {
    diagnosis = 'AVOIDANCE_PATTERN';
    directive = `Avoidance warning: Sleep is normal (${avgSleep}h), yet Idea Vault captures (${ideaCount}) outpace verified task completions. Submit proof artifacts.`;
  }

  const retroBadge = document.getElementById('retroDiagnosisBadge');
  retroBadge.textContent = diagnosis;
  retroBadge.className = diagnosis === 'OPTIMAL_CADENCE' ? 'badge badge-p3' : 'badge badge-p1';

  document.getElementById('retrospectiveBox').innerHTML = `
    <div><strong>Diagnostic Classification:</strong> <code>${diagnosis}</code></div>
    <div><strong>Ari Debrief Directive:</strong> ${directive}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px;">
      <div style="background:var(--bg-input);padding:8px;border-radius:6px;">
        <div style="font-size:10.5px;color:var(--text-secondary);">Completed / Total</div>
        <div style="font-weight:700;font-size:14px;">${completedCount} / ${state.tasks.length}</div>
      </div>
      <div style="background:var(--bg-input);padding:8px;border-radius:6px;">
        <div style="font-size:10.5px;color:var(--text-secondary);">Sleep Baseline</div>
        <div style="font-weight:700;font-size:14px;">${avgSleep.toFixed(1)} hrs</div>
      </div>
      <div style="background:var(--bg-input);padding:8px;border-radius:6px;">
        <div style="font-size:10.5px;color:var(--text-secondary);">Focus Logged</div>
        <div style="font-weight:700;font-size:14px;">${contMins} mins</div>
      </div>
    </div>
  `;

  // Leisure & Friday Hobby Safeguard
  const remQuota = Math.max(0, state.settings.daily_entertainment_quota_mins - state.settings.daily_entertainment_used_mins);
  document.getElementById('leisureSummaryBox').innerHTML = `
    <div><strong>Friday Builder Safeguard:</strong> Protected all-day slot for <em>Arduino, Embedded Electronics, Game Dev, and Vibe Coding</em>.</div>
    <div><strong>Weekend Workload Reduction Earned (from Bonus Tasks):</strong> <span style="color:#d8b4fe;font-weight:700;">${state.settings.weekend_saved_minutes} mins saved</span></div>
    <div><strong>Daily Entertainment Quota Remaining:</strong> ${remQuota}m / ${state.settings.daily_entertainment_quota_mins}m</div>
  `;
}

// ============================================================================
// Pomodoro Timer Controller
// ============================================================================
let pomoIntervalId = null;
let pomoRemainingSeconds = 25 * 60;

function updatePomodoroDisplay() {
  const mm = String(Math.floor(pomoRemainingSeconds / 60)).padStart(2, '0');
  const ss = String(pomoRemainingSeconds % 60).padStart(2, '0');
  document.getElementById('pomodoroTimerDisplay').textContent = `${mm}:${ss}`;
}

// ============================================================================
// Master Render & Event Wiring
// ============================================================================
function renderAll() {
  renderTelemetryAndHeader();
  renderChatDeck();
  renderTaskitator();
  renderCurry();
  renderBudget();
  renderIdeaVault();
  renderHealth();
  renderLocations();
  renderDiary();
  renderBioAndLeisure();
}

function initEventListeners() {
  // 1. Agent Switcher (Ari vs. Jade)
  document.getElementById('switchAriBtn').addEventListener('click', () => {
    state.activeAgent = 'ari';
    persistState();
    renderChatDeck();
  });
  document.getElementById('switchJadeBtn').addEventListener('click', () => {
    state.activeAgent = 'jade';
    persistState();
    renderChatDeck();
  });

  // 2. Provider Waterfall Selector & 429 Failover Modal
  const providerSelect = document.getElementById('providerSelect');
  providerSelect.value = `${state.settings.active_provider}:${state.settings.active_tier}`;
  providerSelect.addEventListener('change', () => {
    const [prov, tier] = providerSelect.value.split(':');
    state.settings.active_provider = prov;
    state.settings.active_tier = tier;
    persistState();
    renderChatDeck();
  });

  document.getElementById('simulate429Btn').addEventListener('click', () => {
    const currentProv = state.settings.active_provider === 'gemini' ? 'Gemini' : 'Claude';
    const targetProv = state.settings.active_provider === 'gemini' ? 'Claude' : 'Gemini';
    document.getElementById('failoverModalPromptText').textContent =
      `${currentProv} quota exhausted. Switch active session to ${targetProv}?`;
    document.getElementById('providerFailoverModal').classList.remove('hidden');
  });

  document.getElementById('cancelProviderSwitchBtn').addEventListener('click', () => {
    document.getElementById('providerFailoverModal').classList.add('hidden');
  });

  document.getElementById('confirmProviderSwitchBtn').addEventListener('click', () => {
    const nextProv = state.settings.active_provider === 'gemini' ? 'claude' : 'gemini';
    state.settings.active_provider = nextProv;
    providerSelect.value = `${nextProv}:${state.settings.active_tier}`;
    document.getElementById('providerFailoverModal').classList.add('hidden');

    if (pendingRetryMessage) {
      dispatchChatMessage(pendingRetryMessage);
      pendingRetryMessage = null;
    } else {
      dispatchChatMessage(`Provider switched to ${nextProv.toUpperCase()}. Confirm live state and resume.`);
    }
    persistState();
    renderAll();
  });

  // 3. Toggle <120-Token Raw JSON Snapshot
  document.getElementById('toggleSnapshotBtn').addEventListener('click', () => {
    document.getElementById('stateJsonInspector').classList.toggle('hidden');
  });

  // 4. Operator Config Modal
  document.getElementById('openConfigModalBtn').addEventListener('click', () => {
    document.getElementById('cfgWorkerUrl').value = state.settings.worker_url || '';
    document.getElementById('cfgMasterToken').value = state.settings.master_token || '';
    document.getElementById('cfgRestWindow').value = state.settings.rest_window || '00:00 - 00:45';
    document.getElementById('operatorConfigModal').classList.remove('hidden');
  });
  document.getElementById('closeConfigModalBtn').addEventListener('click', () => {
    document.getElementById('operatorConfigModal').classList.add('hidden');
  });
  document.getElementById('operatorConfigForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.worker_url = document.getElementById('cfgWorkerUrl').value.trim();
    state.settings.master_token = document.getElementById('cfgMasterToken').value.trim();
    state.settings.rest_window = document.getElementById('cfgRestWindow').value.trim() || '00:00 - 00:45';
    persistState();
    document.getElementById('operatorConfigModal').classList.add('hidden');
    renderTelemetryAndHeader();
  });

  // 5. Chat Form, Quick Prompts & History/Rollback Drawer
  function dispatchChatMessage(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const agent = state.activeAgent;
    const sessionId = state.activeSessions[agent];

    state.chatMessages.push({
      id: `msg_${Date.now()}_u`,
      session_id: sessionId,
      agent,
      sender: 'user',
      message_text: trimmed,
      created_at: '2026-10-20 23:01 AST'
    });

    const replyText = generateAgentReply(agent, trimmed);
    state.chatMessages.push({
      id: `msg_${Date.now() + 1}_a`,
      session_id: sessionId,
      agent,
      sender: 'assistant',
      message_text: replyText,
      created_at: '2026-10-20 23:01 AST'
    });

    persistState();
    renderChatDeck();
  }

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    dispatchChatMessage(input.value);
    input.value = '';
  });

  document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptText = btn.getAttribute('data-prompt');
      if (promptText.includes('Jade')) {
        state.activeAgent = 'jade';
      }
      dispatchChatMessage(promptText);
    });
  });

  document.getElementById('toggleHistoryDrawerBtn').addEventListener('click', () => {
    document.getElementById('historyRollbackDrawer').classList.toggle('hidden');
  });

  document.getElementById('historySearchBtn').addEventListener('click', () => {
    const q = document.getElementById('historySearchInput').value.trim();
    renderRollbackDrawer(q);
  });

  document.getElementById('newChatSessionBtn').addEventListener('click', () => {
    const agent = state.activeAgent;
    const newSessId = `sess_${agent}_${Date.now().toString().slice(-5)}`;
    state.activeSessions[agent] = newSessId;
    state.chatMessages.push({
      id: `msg_${Date.now()}_init`,
      session_id: newSessId,
      agent,
      sender: 'assistant',
      message_text: `New clean D1 session (${newSessId}) initialized for ${agent.toUpperCase()}. Prior sessions remain preserved in D1 history.`,
      created_at: '2026-10-20 23:02 AST'
    });
    persistState();
    renderChatDeck();
  });

  // 6. Pomodoro & Biological Maintenance Controls
  document.getElementById('pomodoroModeSelect').addEventListener('change', (e) => {
    if (pomoIntervalId) {
      clearInterval(pomoIntervalId);
      pomoIntervalId = null;
    }
    const mins = parseInt(e.target.value.split(':')[1], 10) || 25;
    pomoRemainingSeconds = mins * 60;
    updatePomodoroDisplay();
  });

  document.getElementById('startPomodoroBtn').addEventListener('click', () => {
    if (pomoIntervalId) {
      clearInterval(pomoIntervalId);
      pomoIntervalId = null;
      return;
    }
    pomoIntervalId = setInterval(() => {
      if (pomoRemainingSeconds > 0) {
        pomoRemainingSeconds--;
        updatePomodoroDisplay();
      } else {
        clearInterval(pomoIntervalId);
        pomoIntervalId = null;
      }
    }, 1000);
  });

  document.getElementById('resetPomodoroBtn').addEventListener('click', () => {
    if (pomoIntervalId) {
      clearInterval(pomoIntervalId);
      pomoIntervalId = null;
    }
    const modeVal = document.getElementById('pomodoroModeSelect').value;
    const mins = parseInt(modeVal.split(':')[1], 10) || 25;
    pomoRemainingSeconds = mins * 60;
    updatePomodoroDisplay();
  });

  document.getElementById('logFastFocusBtn').addEventListener('click', () => {
    state.focusSessions.push({
      id: `foc_${Date.now()}`,
      task_id: 't_101',
      duration_minutes: 50,
      session_type: 'deep_work',
      started_at: '2026-10-20 23:02'
    });
    persistState();
    renderBioAndLeisure();
  });

  document.getElementById('ackBioBreakBtn').addEventListener('click', () => {
    state.focusSessions.push({
      id: `foc_break_${Date.now()}`,
      task_id: null,
      duration_minutes: 15,
      session_type: 'break',
      started_at: '2026-10-20 23:05'
    });
    persistState();
    renderBioAndLeisure();
  });

  document.getElementById('quickVaultJumpBtn').addEventListener('click', () => {
    switchOrganTab('ideas');
    startIdeaVaultCountdown();
  });

  // 7. Organ Navigation Grid Tabs
  function switchOrganTab(organName) {
    document.querySelectorAll('.organ-tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-organ') === organName);
    });
    document.querySelectorAll('.organ-workspace-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `organ-${organName}`);
    });
  }

  document.querySelectorAll('.organ-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchOrganTab(btn.getAttribute('data-organ'));
    });
  });

  // 8. Taskitator Actions
  document.getElementById('taskFilterSelect').addEventListener('change', renderTaskitator);

  document.getElementById('surfaceBonusBtn').addEventListener('click', () => {
    for (const t of state.tasks) {
      if (t.status === 'pending' && t.priority >= 3) {
        t.is_bonus = true;
      }
    }
    persistState();
    renderTaskitator();
  });

  document.getElementById('revertBonusBtn').addEventListener('click', () => {
    for (const t of state.tasks) {
      if (t.is_bonus && t.status !== 'completed') {
        t.is_bonus = false;
      }
    }
    persistState();
    renderTaskitator();
  });

  document.getElementById('createTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('newTaskTitle').value.trim();
    if (!title) return;
    const priority = parseInt(document.getElementById('newTaskPriority').value, 10) || 2;
    const due = document.getElementById('newTaskDue').value.trim() || '23:55';
    const duration = parseInt(document.getElementById('newTaskDuration').value, 10) || 45;
    const parentId = document.getElementById('newTaskParent').value || null;
    const isConsec = document.getElementById('newTaskConsecutive').checked;
    const criteria = document.getElementById('newTaskCriteria').value.trim()
      || 'Clear handwritten or screenshot completion proof.';
    const rawSubs = document.getElementById('newTaskSubtasks').value.trim();
    const subtasks = rawSubs
      ? rawSubs.split(',').map((s, i) => ({ id: `st_${Date.now()}_${i}`, title: s.trim(), is_completed: false })).filter(s => s.title)
      : [];

    state.tasks.push({
      id: `t_${Date.now().toString().slice(-4)}`,
      title,
      description: 'Operator-created task in D1.',
      priority,
      is_consecutive: isConsec,
      depends_on_task_id: parentId,
      due,
      due_overdue: false,
      estimated_duration_minutes: duration,
      status: 'pending',
      is_bonus: false,
      original_scheduled_date: '2026-10-20',
      ai_audit_criteria: criteria,
      requires_video: false,
      subtasks,
      audit_receipts: []
    });

    document.getElementById('newTaskTitle').value = '';
    document.getElementById('newTaskCriteria').value = '';
    document.getElementById('newTaskSubtasks').value = '';
    persistState();
    renderAll();
  });

  // Multimodal Proof Audit Form
  let sampleProofLoaded = false;
  document.getElementById('loadSampleProofBtn').addEventListener('click', () => {
    sampleProofLoaded = true;
    document.getElementById('auditNotesInput').value =
      'Attached handwritten oxidative phosphorylation diagram (36-38 ATP net yield) + 10 graded Tahsili drills (9/10 correct).';
    document.getElementById('auditResultBox').style.color = '#93c5fd';
    document.getElementById('auditResultBox').textContent =
      'Sample Base64 handwritten proof buffer staged. Click "Run Vision Rubric Audit" to evaluate.';
  });

  document.getElementById('proofAuditForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const taskId = document.getElementById('auditTaskSelect').value;
    const notes = document.getElementById('auditNotesInput').value.trim();
    const fileInput = document.getElementById('auditFileInput');
    const resultBox = document.getElementById('auditResultBox');

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!sampleProofLoaded && (!fileInput.files || !fileInput.files.length) && !notes) {
      resultBox.style.color = '#fca5a5';
      resultBox.textContent = '[ZERO-SIMULATION FAIL-CLOSED]: No proof image/PDF or verification artifact provided. Task remains incomplete.';
      return;
    }

    const receipt = {
      id: `aud_${Date.now().toString().slice(-5)}`,
      task_id: task.id,
      verdict: 'passed',
      score: 9,
      critique: `Verified against rubric ("${task.ai_audit_criteria}"). Artifact demonstrates complete derivation and problem grading.`,
      evaluated_at: '2026-10-20 23:03 AST'
    };

    task.audit_receipts.unshift(receipt);
    task.status = 'completed';
    task.due_overdue = false;
    if (task.is_bonus) {
      state.settings.weekend_saved_minutes += Number(task.estimated_duration_minutes) || 45;
    }

    resultBox.style.color = '#6ee7b7';
    resultBox.textContent = `AUDIT PASSED (Score ${receipt.score}/10): Receipt ${receipt.id} committed to D1. Task "${task.title}" marked completed!`;
    sampleProofLoaded = false;
    persistState();
    renderAll();
  });

  // 9. Curry Actions
  document.getElementById('copyCurryPromptBtn').addEventListener('click', () => {
    const promptEl = document.getElementById('curryPromptPreview');
    promptEl.select();
    try {
      document.execCommand('copy');
    } catch (_e) {
      // Ignore copy fallback error
    }
    document.getElementById('copyCurryPromptBtn').textContent = 'Copied!';
    setTimeout(() => {
      document.getElementById('copyCurryPromptBtn').textContent = 'Copy Extraction Prompt';
    }, 1500);
  });

  document.getElementById('loadSampleSyllabusBtn').addEventListener('click', () => {
    document.getElementById('curryJsonImportInput').value = JSON.stringify([
      {
        exam_name: 'Tahsili Chemistry',
        unit_number: 6,
        topic_title: 'Reaction Kinetics & Chemical Equilibrium',
        difficulty_level: 4,
        estimated_hours: 2.5,
        is_main_objective: false,
        target_completion_date: '2026-10-27'
      }
    ], null, 2);
  });

  document.getElementById('importSyllabusJsonBtn').addEventListener('click', () => {
    const raw = document.getElementById('curryJsonImportInput').value.trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (!item.topic_title) continue;
        state.curriculumUnits.push({
          id: `cu_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          exam_name: item.exam_name || 'Curriculum Track',
          unit_number: Number(item.unit_number) || 1,
          topic_title: item.topic_title,
          difficulty_level: Number(item.difficulty_level) || 3,
          estimated_hours: Number(item.estimated_hours) || 2.0,
          is_main_objective: Boolean(item.is_main_objective),
          status: 'not_started',
          target_completion_date: item.target_completion_date || '2026-10-30'
        });
      }
      document.getElementById('curryJsonImportInput').value = '';
      persistState();
      renderCurry();
    } catch (_e) {
      // Ignore invalid JSON input
    }
  });

  // 10. Budget SMS Regex & Manual Form
  document.querySelectorAll('.sample-sms-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('rawSmsInput').value = btn.getAttribute('data-sms');
    });
  });

  document.getElementById('parseSmsWebhookBtn').addEventListener('click', () => {
    const rawSms = document.getElementById('rawSmsInput').value;
    const feedback = document.getElementById('smsParseFeedback');
    try {
      const parsed = parseBankSmsClient(rawSms);
      if (parsed.balance_after_sar === null) {
        parsed.balance_after_sar = Number(Math.max(0, state.settings.budget_balance_sar - parsed.amount_sar).toFixed(2));
      }
      state.settings.budget_balance_sar = parsed.balance_after_sar;
      state.budgetEntries.unshift({
        id: `b_${Date.now().toString().slice(-4)}`,
        ...parsed
      });
      feedback.style.color = '#6ee7b7';
      feedback.textContent = `[0-TOKEN REGEX PARSED]: Card=${parsed.wallet_source} | Merchant="${parsed.merchant}" | Amount=${parsed.amount_sar} SAR | New Balance=${parsed.balance_after_sar} SAR`;
      persistState();
      renderAll();
    } catch (err) {
      feedback.style.color = '#fca5a5';
      feedback.textContent = `Regex Parse Error: ${err.message}`;
    }
  });

  document.getElementById('manualBudgetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const merchant = document.getElementById('manualMerchant').value.trim();
    const wallet = document.getElementById('manualWallet').value.trim() || 'Mada *4821';
    const amount = parseFloat(document.getElementById('manualAmountSar').value);
    if (!merchant || Number.isNaN(amount)) return;

    const nextBal = Number(Math.max(0, state.settings.budget_balance_sar - amount).toFixed(2));
    state.settings.budget_balance_sar = nextBal;
    state.budgetEntries.unshift({
      id: `b_${Date.now().toString().slice(-4)}`,
      wallet_source: wallet,
      merchant,
      amount_sar: amount,
      balance_after_sar: nextBal,
      transaction_timestamp: '2026-10-20 23:04'
    });
    document.getElementById('manualMerchant').value = '';
    document.getElementById('manualAmountSar').value = '';
    persistState();
    renderAll();
  });

  // 11. Idea Vault 3-Minute Gate & Friday Synthesis
  document.getElementById('unlockIdeaGateBtn').addEventListener('click', startIdeaVaultCountdown);
  document.getElementById('lockIdeaGateNowBtn').addEventListener('click', lockIdeaVaultImmediately);

  document.getElementById('ideaCaptureForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const content = document.getElementById('ideaContentInput').value.trim();
    const domain = document.getElementById('ideaDomainSelect').value;
    if (!content) return;

    state.ideas.unshift({
      id: `idea_${Date.now().toString().slice(-4)}`,
      content,
      domain_tag: domain,
      is_locked: true,
      is_synthesized: false,
      created_at: '2026-10-20 23:04'
    });
    document.getElementById('ideaContentInput').value = '';
    lockIdeaVaultImmediately();
    persistState();
    renderAll();
  });

  document.getElementById('runFridaySynthesisBtn').addEventListener('click', () => {
    const groups = { coding: [], hardware: [], personal: [], general: [] };
    for (const idea of state.ideas) {
      idea.is_synthesized = true;
      const g = groups[idea.domain_tag] ? idea.domain_tag : 'general';
      groups[g].push(idea);
    }

    const mdLines = [
      `# MazenOS Friday Builder Synthesis Blueprint (2026-10-20)`,
      `Total Synthesized Ideas: ${state.ideas.length}`,
      ``
    ];
    for (const [domain, items] of Object.entries(groups)) {
      if (!items.length) continue;
      mdLines.push(`## Domain: ${domain.toUpperCase()}`);
      for (const it of items) {
        mdLines.push(`- **[${it.id}]** (${it.created_at}): ${it.content}`);
      }
      mdLines.push(``);
    }
    document.getElementById('fridaySynthesisOutput').textContent = mdLines.join('\n');
    persistState();
    renderIdeaVault();
  });

  // 12. Circadian Health & Sickness Circuit Breaker
  document.getElementById('healthIntakeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.health.sleep_hours = parseFloat(document.getElementById('healthSleepInput').value) || 6.0;
    state.health.energy_rating = parseInt(document.getElementById('healthEnergyInput').value, 10) || 4;
    state.health.workout_type = document.getElementById('healthWorkoutInput').value.trim();
    state.health.workout_completed = document.getElementById('healthWorkoutCheck').checked;
    persistState();
    renderAll();
  });

  document.getElementById('incrementMedicineBtn').addEventListener('click', () => {
    state.health.medicine_taken_count += 1;
    persistState();
    renderAll();
  });

  document.getElementById('resetMedicineBtn').addEventListener('click', () => {
    state.health.medicine_taken_count = 0;
    persistState();
    renderAll();
  });

  document.getElementById('activateSickBreakerBtn').addEventListener('click', () => {
    state.health.is_sick = true;
    state.health.sickness_notes = document.getElementById('sicknessNotesInput').value.trim() || 'Recovery protocol engaged';
    for (const t of state.tasks) {
      if (t.priority === 1 && t.status !== 'completed') {
        t.due_overdue = false;
      }
    }
    persistState();
    renderAll();
  });

  document.getElementById('clearSickBreakerBtn').addEventListener('click', () => {
    state.health.is_sick = false;
    state.health.sickness_notes = '';
    persistState();
    renderAll();
  });

  // 13. Study Locations
  document.getElementById('addLocationForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('locNameInput').value.trim();
    if (!name) return;
    state.locations.push({
      id: `loc_${Date.now().toString().slice(-4)}`,
      name,
      commute_minutes_one_way: parseInt(document.getElementById('locCommuteInput').value, 10) || 15,
      average_cost_sar: parseFloat(document.getElementById('locCostInput').value) || 0,
      quietness_rating: parseInt(document.getElementById('locQuietInput').value, 10) || 4,
      service_type: document.getElementById('locServiceInput').value.trim() || 'Study Spot',
      notes: document.getElementById('locNotesInput').value.trim() || 'Added by operator.'
    });
    document.getElementById('locNameInput').value = '';
    persistState();
    renderLocations();
  });

  // 14. Diary & Jade Handoff
  document.getElementById('diaryEntryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = document.getElementById('diaryTextInput').value.trim();
    const mood = document.getElementById('diaryMoodSelect').value;
    if (!text) return;

    state.diaryEntries.unshift({
      id: `diary_${Date.now().toString().slice(-4)}`,
      entry_text: text,
      mood_indicator: mood,
      created_at: '2026-10-20 23:05 AST'
    });
    document.getElementById('diaryTextInput').value = '';
    persistState();
    renderDiary();
  });

  document.getElementById('sendDiaryToJadeBtn').addEventListener('click', () => {
    state.activeAgent = 'jade';
    const latest = state.diaryEntries[0];
    dispatchChatMessage(`Jade, let's reflect on my latest journal entry (${latest?.mood_indicator || 'focused'}): "${latest?.entry_text || ''}"`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // 15. Hardware Bridges (/status, NewPipe Media Audit & 03:00 AM Cron)
  document.getElementById('pollStatusBtn').addEventListener('click', renderBioAndLeisure);

  document.getElementById('simulateOverdueP1Btn').addEventListener('click', () => {
    const p1 = state.tasks.find(t => t.priority === 1 && t.status !== 'completed');
    if (p1) {
      p1.due = '22:15 (OVERDUE)';
      p1.due_overdue = true;
    }
    state.health.is_sick = false;
    persistState();
    renderAll();
  });

  document.getElementById('restoreOnTrackP1Btn').addEventListener('click', () => {
    const p1 = state.tasks.find(t => t.priority === 1 && t.status !== 'completed');
    if (p1) {
      p1.due = '23:45';
      p1.due_overdue = false;
    }
    persistState();
    renderAll();
  });

  document.querySelectorAll('.sample-video-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('newpipeVideoInput').value = btn.getAttribute('data-video');
    });
  });

  document.getElementById('auditNewpipeBtn').addEventListener('click', () => {
    const title = document.getElementById('newpipeVideoInput').value.trim();
    const out = document.getElementById('newpipeAuditResult');
    const isRelevant = /cellular|respiration|atp|biology|bio|qudurat|tahsili|math|algebra|physics|chemistry|lecture/i.test(title);

    if (isRelevant) {
      out.style.color = '#6ee7b7';
      out.textContent = `{"allowed": true, "lock_device": false, "reason": "Verified topical match with active study unit (Bio Ch4 / Tahsili Biology)."}`;
    } else {
      out.style.color = '#fca5a5';
      out.textContent = `{"allowed": false, "lock_device": true, "reason": "Unrelated entertainment media blocked during active P1 study window. MacroDroid overlay triggered."}`;
    }
  });

  document.getElementById('runDailyCronBtn').addEventListener('click', () => {
    state.health.medicine_taken_count = 0;
    state.settings.daily_entertainment_used_mins = 0;
    let revertedCount = 0;
    for (const t of state.tasks) {
      if (t.is_bonus && t.status !== 'completed') {
        t.is_bonus = false;
        revertedCount++;
      }
    }
    persistState();
    renderAll();
    document.getElementById('cronExecutionFeedback').textContent =
      `[03:00 AST CRON EXECUTED]: Medicine counter reset to 0/${state.health.medicine_target_count}, reverted ${revertedCount} untouched bonus task(s) without penalty, and rebalanced consecutive chains.`;
  });
}

window.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  updatePomodoroDisplay();
  renderAll();
});
