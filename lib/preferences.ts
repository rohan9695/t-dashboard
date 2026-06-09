// lib/preferences.ts
// User preference keys and their defaults.
// Stored in Supabase user_preferences table (jsonb value).
// Feature code paths are skipped entirely when the flag is OFF.

export type PreferenceKey =
  // Default ON
  | 'toast_notifications'
  | 'haptic_alerts'
  | 'heartbeat_monitor'
  | 'balance_hidden_default'
  // Risk Controls (default OFF)
  | 'auto_risk_lockout'
  | 'account_quarantine'
  | 'session_auto_lockout'
  // Display (default OFF)
  | 'grey_disconnected'
  | 'health_score_column'
  | 'skull_indicator'
  // Analytics (default OFF)
  | 'trade_journal'
  | 'daily_pnl_snapshot'
  | 'equity_curve'
  | 'profit_factor'
  | 'win_rate_heatmap'
  | 'pnl_calendar'
  | 'ai_pattern_detection'

export const PREFERENCE_DEFAULTS: Record<PreferenceKey, boolean> = {
  toast_notifications:    true,
  haptic_alerts:          true,
  heartbeat_monitor:      true,
  balance_hidden_default: true,
  auto_risk_lockout:      false,
  account_quarantine:     false,
  session_auto_lockout:   false,
  grey_disconnected:      false,
  health_score_column:    false,
  skull_indicator:        false,
  trade_journal:          false,
  daily_pnl_snapshot:     false,
  equity_curve:           false,
  profit_factor:          false,
  win_rate_heatmap:       false,
  pnl_calendar:           false,
  ai_pattern_detection:   false,
}

export const PREFERENCE_LABELS: Record<PreferenceKey, { label: string; description: string }> = {
  toast_notifications:    { label: 'Toast notifications',    description: 'Trade fill alerts at bottom of screen' },
  haptic_alerts:          { label: 'Haptic alerts',          description: 'Vibrate on trade fill (50ms)' },
  heartbeat_monitor:      { label: 'Heartbeat monitor',      description: 'Alert when NT8 goes silent for 60s' },
  balance_hidden_default: { label: 'Hide balances on open',  description: 'Totals start hidden, tap eye to reveal' },
  auto_risk_lockout:      { label: 'Auto risk lockout',      description: 'Stop updates after 3 bad readings' },
  account_quarantine:     { label: 'Account quarantine',     description: 'Flag accounts that miss trade copies' },
  session_auto_lockout:   { label: 'Session lockout at 4pm', description: 'Lock all accounts at 4pm ET daily' },
  grey_disconnected:      { label: 'Grey disconnected',      description: 'Fade accounts with no recent activity' },
  health_score_column:    { label: 'Health score (0–100)',   description: 'Composite score column per account' },
  skull_indicator:        { label: 'Skull indicator',        description: 'Mark account closest to drawdown breach' },
  trade_journal:          { label: 'Trade journal',          description: 'Auto-log every fill for analytics' },
  daily_pnl_snapshot:     { label: 'Daily P&L snapshot',     description: 'Save totals at NY close each day' },
  equity_curve:           { label: 'Equity curve',           description: 'Running P&L line chart per session' },
  profit_factor:          { label: 'Profit factor',          description: 'Wins ÷ losses, red if below 1.0' },
  win_rate_heatmap:       { label: 'Win rate heatmap',       description: 'Hour × day grid of win rates' },
  pnl_calendar:           { label: 'P&L calendar',           description: '12-month GitHub-style heatmap' },
  ai_pattern_detection:   { label: 'AI pattern detection',   description: 'Weekly Anthropic analysis of last 30 days' },
}
