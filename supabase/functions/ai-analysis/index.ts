// supabase/functions/ai-analysis/index.ts
// Weekly Anthropic API analysis of last 30 days of trade events.
// Stores insights in Supabase ai_insights table.
//
// Deploy: supabase functions deploy ai-analysis
// Cron:   0 0 * * 0   (Sunday midnight UTC)
//
// Secrets:
//   ANTHROPIC_API_KEY - Anthropic API key
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - auto-provided

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_API_KEY         = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

Deno.serve(async () => {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if trade_journal is enabled
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: pref } = await supabase
    .from('user_preferences')
    .select('value')
    .eq('preference_key', 'trade_journal')
    .single()

  if ((pref?.value as { v?: boolean } | null)?.v !== true) {
    return new Response(JSON.stringify({ skipped: true, reason: 'trade_journal is OFF' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch last 30 days of closed trades
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
  const { data: trades } = await supabase
    .from('trade_events')
    .select('symbol, direction, pnl, occurred_at, account_id')
    .eq('event_type', 'close')
    .gte('occurred_at', since)
    .order('occurred_at')

  if (!trades || trades.length === 0) {
    return new Response(JSON.stringify({ skipped: true, reason: 'no trades in last 30 days' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Format trade data for the prompt
  const tradeSummary = trades.slice(-50).map((t) =>
    `${t.occurred_at}: ${t.symbol} ${t.direction} P&L=$${t.pnl ?? 0} (${t.account_id})`
  ).join('\n')

  const totalTrades = trades.length
  const wins        = trades.filter((t) => Number(t.pnl ?? 0) > 0).length
  const totalPnl    = trades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)

  const prompt = `You are analyzing trading performance data for a prop trader using NinjaTrader on Apex-funded accounts.

Summary: ${totalTrades} closed trades in 30 days, ${wins} wins (${Math.round(wins/totalTrades*100)}% win rate), total P&L: $${Math.round(totalPnl)}

Last 50 trades:
${tradeSummary}

Provide a concise analysis with:
1. A 2-3 sentence summary of trading performance and patterns
2. 3-5 specific actionable bullet points about patterns, timing, or risk management

Format as JSON:
{
  "summary": "...",
  "patterns": ["...", "...", "..."]
}`

  // Call Anthropic API
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text()
    return new Response(JSON.stringify({ error: `Anthropic API error: ${errText}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const anthropicData = await anthropicRes.json() as {
    content: Array<{ type: string; text: string }>
  }

  const responseText = anthropicData.content[0]?.text ?? ''

  let parsed: { summary: string; patterns: string[] }
  try {
    // Extract JSON from response (Claude might wrap it in markdown)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? responseText)
  } catch {
    parsed = { summary: responseText, patterns: [] }
  }

  // Store insight
  const { error } = await supabase.from('ai_insights').insert({
    summary:      parsed.summary,
    patterns:     parsed.patterns,
    trade_count:  totalTrades,
    generated_at: new Date().toISOString(),
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({ ok: true, summary: parsed.summary, patterns: parsed.patterns.length }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
