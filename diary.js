// ============================================================================
// MazenOS Phase 5 (Organ 8): Personal Journal & Longitudinal Mindset Engine
// File: diary.js
// ============================================================================

/**
 * Computes longitudinal mindset & mood distribution across diary_entries for Jade.
 */
export function buildLongitudinalMoodInsights(entries) {
  const moodCounts = {};
  for (const e of entries) {
    const mood = (e.mood_indicator || 'neutral').toLowerCase();
    moodCounts[mood] = (moodCounts[mood] || 0) + 1;
  }

  const dominantMood = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'balanced';

  return {
    total_entries: entries.length,
    dominant_mood: dominantMood,
    mood_distribution: moodCounts,
    latest_reflection: entries[0] || null
  };
}

/**
 * Handles /api/diary and /api/diary/insights
 */
export async function handleDiaryRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'diary', ...]

  if (method === 'GET' && pathParts[2] === 'insights') {
    const rows = await db.prepare(`
      SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT 30
    `).all();
    return {
      status: 200,
      data: buildLongitudinalMoodInsights(rows?.results || [])
    };
  }

  if (method === 'GET') {
    const rows = await db.prepare(`
      SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT 50
    `).all();
    const list = rows?.results || [];
    return {
      status: 200,
      data: {
        entries: list,
        insights: buildLongitudinalMoodInsights(list)
      }
    };
  }

  if (method === 'POST') {
    const body = await request.json();
    const entryText = String(body.entry_text || '').trim();
    if (!entryText) {
      return { status: 400, data: { error: 'entry_text is required' } };
    }

    const mood = String(body.mood_indicator || 'grounded').trim();
    const id = `diary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    await db.prepare(`
      INSERT INTO diary_entries (id, entry_text, mood_indicator, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(id, entryText, mood, nowIso).run();

    return {
      status: 201,
      data: {
        id,
        entry_text: entryText,
        mood_indicator: mood,
        created_at: nowIso
      }
    };
  }

  if (method === 'DELETE' && pathParts[2]) {
    await db.prepare(`DELETE FROM diary_entries WHERE id = ?`).bind(pathParts[2]).run();
    return { status: 200, data: { deleted: pathParts[2] } };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
