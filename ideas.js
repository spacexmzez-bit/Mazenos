// ============================================================================
// MazenOS Phase 5 (Organ 6): Distraction Confinement & 3-Minute Idea Vault
// File: ideas.js
// ============================================================================

const QUICK_CAPTURE_WINDOW_MS = 3 * 60 * 1000; // Strict 3-minute countdown

/**
 * Synthesizes captured idea fragments into a structured Friday Builder Markdown (.md)
 * implementation specification grouped by domain_tag.
 */
export function buildFridaySynthesisMarkdown(ideas, dateStr) {
  const groups = { coding: [], hardware: [], personal: [], general: [] };
  for (const item of ideas) {
    const tag = groups[item.domain_tag] ? item.domain_tag : 'general';
    groups[tag].push(item);
  }

  const lines = [
    `# MazenOS Friday Builder Synthesis Blueprint (${dateStr})`,
    ``,
    `Total Captured Fragments Synthesized: **${ideas.length}**`,
    ``
  ];

  const sectionLabels = {
    coding: 'Software & Architecture (Vibe Coding / Full-Stack)',
    hardware: 'Hardware, Arduino & Embedded Systems',
    personal: 'Personal Systems & Workflow Optimization',
    general: 'General Explorations & Backlog Concepts'
  };

  for (const [tag, list] of Object.entries(groups)) {
    if (!list.length) continue;
    lines.push(`## ${sectionLabels[tag]}`);
    for (const idea of list) {
      const ts = (idea.created_at || '').slice(0, 16).replace('T', ' ');
      lines.push(`- **[${idea.id}]** (${ts}): ${idea.content}`);
    }
    lines.push(``);
  }

  lines.push(`## Next Recommended Friday Build Action`);
  const topCandidate = groups.hardware[0] || groups.coding[0] || ideas[0];
  if (topCandidate) {
    lines.push(`- Scope a 90-minute prototype block for: **"${topCandidate.content}"** (Domain: \`${topCandidate.domain_tag}\`).`);
  } else {
    lines.push(`- No unsynthesized fragments pending.`);
  }

  return lines.join('\n');
}

/**
 * Handles /api/ideas, /api/ideas/unlock, and /api/ideas/synthesize
 */
export async function handleIdeasRequest(request, url, db, kv) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'ideas', ...]

  // Check active 3-minute quick capture window in KV or system_settings
  let unlockExpiresAt = 0;
  if (kv) {
    const kvVal = await kv.get('idea_vault_unlock_expires');
    if (kvVal) unlockExpiresAt = Number(kvVal);
  }
  const settingRow = await db.prepare(`
    SELECT value FROM system_settings WHERE key = 'idea_vault_unlock_expires'
  `).first();
  if (settingRow?.value) {
    unlockExpiresAt = Math.max(unlockExpiresAt, Number(settingRow.value));
  }

  const isRiyadhFriday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short'
  }).format(new Date()) === 'Fri';

  const forceReadable = url.searchParams.get('friday_mode') === 'true' || isRiyadhFriday;
  const windowRemainingSeconds = Math.max(0, Math.floor((unlockExpiresAt - Date.now()) / 1000));

  // GET /api/ideas
  if (method === 'GET') {
    const countRow = await db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN is_synthesized = 0 THEN 1 ELSE 0 END) AS unsynthesized_count
      FROM idea_vault
    `).first();

    // Write-Only Vault Mode during Deep Work: browsing past ideas is locked unless on Friday synthesis mode
    if (!forceReadable) {
      return {
        status: 200,
        data: {
          write_only_locked: true,
          quick_capture_remaining_seconds: windowRemainingSeconds,
          total_stored_ideas: Number(countRow?.total_count || 0),
          unsynthesized_count: Number(countRow?.unsynthesized_count || 0),
          message: 'Vault is in Write-Only Confinement Mode during active work. Use 3-Minute Quick Capture to dump thoughts without browsing past ideas.',
          ideas: []
        }
      };
    }

    const rows = await db.prepare(`
      SELECT * FROM idea_vault ORDER BY created_at DESC
    `).all();

    return {
      status: 200,
      data: {
        write_only_locked: false,
        quick_capture_remaining_seconds: windowRemainingSeconds,
        total_stored_ideas: Number(countRow?.total_count || 0),
        unsynthesized_count: Number(countRow?.unsynthesized_count || 0),
        ideas: rows?.results || []
      }
    };
  }

  // POST /api/ideas/unlock (Starts the strict 3-minute Quick Capture countdown)
  if (method === 'POST' && pathParts[2] === 'unlock') {
    const expiresAt = Date.now() + QUICK_CAPTURE_WINDOW_MS;
    if (kv) {
      await kv.put('idea_vault_unlock_expires', String(expiresAt), { expirationTtl: 180 });
    }
    await db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('idea_vault_unlock_expires', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(String(expiresAt)).run();

    return {
      status: 200,
      data: {
        capture_gate_open: true,
        countdown_seconds: 180,
        expires_at: new Date(expiresAt).toISOString()
      }
    };
  }

  // POST /api/ideas/synthesize (Friday Markdown Synthesis)
  if (method === 'POST' && pathParts[2] === 'synthesize') {
    const rows = await db.prepare(`
      SELECT * FROM idea_vault WHERE is_synthesized = 0 ORDER BY created_at ASC
    `).all();
    const unsynthesized = rows?.results || [];
    const dateStr = new Date().toISOString().slice(0, 10);
    const markdown = buildFridaySynthesisMarkdown(unsynthesized, dateStr);

    if (unsynthesized.length > 0) {
      await db.prepare(`
        UPDATE idea_vault SET is_synthesized = 1, is_locked = 0 WHERE is_synthesized = 0
      `).run();
    }

    return {
      status: 200,
      data: {
        synthesized_count: unsynthesized.length,
        markdown_document: markdown
      }
    };
  }

  // POST /api/ideas (Save quick-captured idea and immediately re-lock vault)
  if (method === 'POST') {
    const body = await request.json();
    const content = String(body.content || '').trim();
    if (!content) {
      return { status: 400, data: { error: 'Idea content is required' } };
    }

    const domainTag = ['coding', 'personal', 'hardware', 'general'].includes(body.domain_tag)
      ? body.domain_tag
      : 'general';
    const id = `idea_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await db.prepare(`
      INSERT INTO idea_vault (id, content, domain_tag, is_locked, is_synthesized)
      VALUES (?, ?, ?, 1, 0)
    `).bind(id, content, domainTag).run();

    // Immediately expire the 3-minute capture gate once idea is committed
    if (kv) {
      await kv.delete('idea_vault_unlock_expires');
    }
    await db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('idea_vault_unlock_expires', '0', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = CURRENT_TIMESTAMP
    `).run();

    return {
      status: 201,
      data: {
        id,
        domain_tag: domainTag,
        vault_relocked: true,
        message: 'Idea captured and locked in vault. Return to active task immediately.'
      }
    };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
