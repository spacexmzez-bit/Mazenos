// ============================================================================
// MazenOS Phase 4: Zero-Cost Bank SMS Regex Parser & Budget Ledger
// File: budget.js
// ============================================================================

/**
 * Pure-Regex Zero-Token Bank SMS Parser (Organ 10):
 * Parses Saudi POS / Mada / ApplePay / Al Rajhi / SNB / STC Pay / urpay SMS strings
 * in both English and Arabic formats with zero LLM token consumption.
 */
export function parseBankSmsRegex(rawSms) {
  const text = String(rawSms || '').trim();
  if (!text) {
    throw new Error('Empty SMS payload');
  }

  // 1. Extract Amount in SAR (e.g., "Amount: SAR 42.50", "42.50 SAR", "مبلغ: 42.50 ريال")
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

  // 2. Extract Remaining Balance in SAR (e.g., "Balance: 88.33 SAR", "الرصيد: 88.33 ر.س")
  const balanceRegexes = [
    /(?:balance|avail\.?\s*bal|bal|الرصيد|رصيد)[:\s]*(?:sar|sr|ريال|ر\.س)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i
  ];
  let balanceAfterSar = null;
  for (const rx of balanceRegexes) {
    const m = text.match(rx);
    if (m && m[1]) {
      balanceAfterSar = parseFloat(m[1].replace(/,/g, ''));
      break;
    }
  }

  // 3. Extract Card / Wallet Identifier (e.g., "Card: *4821", "mada *9910", "بطاقة: 4821")
  const cardMatch = text.match(/(?:card|mada|visa|apple\s*pay|بطاقة|مدى)[:\s*#xX-]*([0-9]{4})/i)
    || text.match(/\*([0-9]{4})\b/);
  const walletSource = cardMatch ? `Card *${cardMatch[1]}` : 'Mada / POS';

  // 4. Extract Merchant Name (e.g., "At: Jarir Bookstore", "لدى: قهوة خطوة جمل")
  const merchantMatch = text.match(/(?:at|merchant|from|لدى|من)[:\s]+([^\n\r;]+?)(?=\s*(?:;|\bon\b|\bdate\b|\bbal\b|\bbalance\b|في|بتاريخ|الرصيد)|$)/i);
  const merchant = merchantMatch ? merchantMatch[1].trim() : 'POS Merchant';

  // 5. Extract Timestamp or fallback to current ISO time
  const dateMatch = text.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}[\sT][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)|([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}\s+[0-9]{2}:[0-9]{2})/);
  const transactionTimestamp = dateMatch ? dateMatch[0].trim() : new Date().toISOString();

  return {
    wallet_source: walletSource,
    merchant,
    amount_sar: Number(amountSar.toFixed(2)),
    balance_after_sar: balanceAfterSar !== null && !Number.isNaN(balanceAfterSar)
      ? Number(balanceAfterSar.toFixed(2))
      : null,
    transaction_timestamp: transactionTimestamp
  };
}

/**
 * Handles /api/budget and /api/budget/sms
 */
export async function handleBudgetRequest(request, url, db) {
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean);

  // GET /api/budget
  if (method === 'GET') {
    const [entriesRes, balanceSetting] = await Promise.all([
      db.prepare(`
        SELECT * FROM budget_entries
        ORDER BY transaction_timestamp DESC, created_at DESC
        LIMIT 50
      `).all(),
      db.prepare(`
        SELECT value FROM system_settings WHERE key = 'budget_balance_sar'
      `).first()
    ]);

    const entries = entriesRes?.results || [];
    const currentBalance = entries.length && entries[0].balance_after_sar != null
      ? Number(entries[0].balance_after_sar)
      : Number(balanceSetting?.value || 88.33);

    const totalSpent = entries.reduce((acc, e) => acc + (Number(e.amount_sar) > 0 ? Number(e.amount_sar) : 0), 0);

    return {
      status: 200,
      data: {
        current_balance_sar: Number(currentBalance.toFixed(2)),
        total_logged_spend_sar: Number(totalSpent.toFixed(2)),
        entries
      }
    };
  }

  // POST /api/budget/sms (MacroDroid Zero-Cost Bank SMS Webhook)
  if (method === 'POST' && pathParts[2] === 'sms') {
    const body = await request.json();
    const rawSms = body.sms || body.text || body.raw_sms || '';

    try {
      const parsed = parseBankSmsRegex(rawSms);

      // If SMS didn't explicitly include balance_after_sar, deduct from current stored balance
      if (parsed.balance_after_sar === null) {
        const balRow = await db.prepare(`
          SELECT value FROM system_settings WHERE key = 'budget_balance_sar'
        `).first();
        const prevBalance = Number(balRow?.value || 88.33);
        parsed.balance_after_sar = Number(Math.max(0, prevBalance - parsed.amount_sar).toFixed(2));
      }

      const id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.prepare(`
        INSERT INTO budget_entries (
          id, wallet_source, merchant, amount_sar, balance_after_sar, transaction_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        parsed.wallet_source,
        parsed.merchant,
        parsed.amount_sar,
        parsed.balance_after_sar,
        parsed.transaction_timestamp
      ).run();

      await db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('budget_balance_sar', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(String(parsed.balance_after_sar)).run();

      return {
        status: 201,
        data: {
          id,
          parsed_via: 'zero_token_regex',
          ...parsed
        }
      };
    } catch (err) {
      return {
        status: 422,
        data: { error: 'SMS_PARSE_FAILED', message: err.message }
      };
    }
  }

  // POST /api/budget (Manual transaction or balance adjustment)
  if (method === 'POST') {
    const body = await request.json();
    const amountSar = Number(body.amount_sar);
    if (Number.isNaN(amountSar)) {
      return { status: 400, data: { error: 'amount_sar is required' } };
    }

    const balRow = await db.prepare(`
      SELECT value FROM system_settings WHERE key = 'budget_balance_sar'
    `).first();
    const prevBalance = Number(balRow?.value || 88.33);
    const balanceAfter = body.balance_after_sar != null
      ? Number(body.balance_after_sar)
      : Number((prevBalance - amountSar).toFixed(2));

    const id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const walletSource = String(body.wallet_source || 'Manual Wallet').trim();
    const merchant = String(body.merchant || 'Direct Entry').trim();
    const ts = body.transaction_timestamp || new Date().toISOString();

    await db.prepare(`
      INSERT INTO budget_entries (
        id, wallet_source, merchant, amount_sar, balance_after_sar, transaction_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, walletSource, merchant, amountSar, balanceAfter, ts).run();

    await db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('budget_balance_sar', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(String(balanceAfter)).run();

    return {
      status: 201,
      data: {
        id,
        wallet_source: walletSource,
        merchant,
        amount_sar: amountSar,
        balance_after_sar: balanceAfter,
        transaction_timestamp: ts
      }
    };
  }

  return { status: 405, data: { error: 'Method not allowed' } };
}
