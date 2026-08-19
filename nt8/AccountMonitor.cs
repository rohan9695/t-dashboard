using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;

namespace NinjaTrader.NinjaScript.AddOns
{
    public class AccountMonitor : AddOnBase
    {
        private static readonly HttpClient httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };

        // ── DO NOT COMMIT A REAL KEY HERE ───────────────────────────────────────
        // This repo copy is the source of truth for everything EXCEPT this line.
        // Before deploying to Documents\NinjaTrader 8\bin\Custom\AddOns\, replace
        // the placeholder below with the real key from Cloudflare Worker vars /
        // `supabase secrets get API_KEY` — see nt8/README.md for the full sync
        // procedure. If you ever rotate the key, update it in Cloudflare Worker
        // vars AND `supabase secrets set API_KEY=...` BEFORE loading a new build
        // — expect 401s until all three agree.
        private const string ApiKey = "REPLACE_WITH_REAL_API_KEY";

        // ── DO NOT COMMIT REAL VALUES HERE EITHER ───────────────────────────────
        // Confirmed 2026-08-14: ntfy.sh rate-limits Cloudflare Workers' shared
        // egress IPs regardless of authentication (a valid Bearer token from that
        // IP still got HTTP 429; the same token direct from a normal network
        // delivered instantly). So the fill-alert push is sent from HERE, the
        // trading machine's own network, instead of relying on
        // /api/trade-event's server-side notify() — that endpoint is still
        // called below for the DB row the dashboard toast needs, but it no
        // longer owns the actual phone push.
        private const string NtfyServer = "https://ntfy.sh";
        private const string NtfyTopic  = "REPLACE_WITH_REAL_NTFY_TOPIC";
        private const string NtfyToken  = "REPLACE_WITH_REAL_NTFY_TOKEN";

        // ── DIAGNOSTIC SWITCH ───────────────────────────────────────────────────
        // Turn OFF once both questions below are answered. Everything it controls
        // is Print-only — it sends nothing, changes no payload, and alters no
        // behaviour, so leaving it on is harmless apart from Output window noise.
        //
        // It answers two things nothing else can see:
        //
        //   1. WHICH ITEMS NT8 ACTUALLY PUSHES. The addon forwards every item it
        //      receives, but the dashboard silently discards any name missing
        //      from ITEM_MAP, so an item can arrive for months and leave no
        //      trace. Every distinct name is printed ONCE, the first time it is
        //      seen. Watch for anything drawdown-shaped.
        //
        //   2. WHETHER REPLIKANTO EXPOSES ITS CONNECTION STATE. If it does, the
        //      dashboard can report it outright instead of inferring a failure
        //      from the symptom (leader in a position, followers flat).
        private const bool DebugDiscovery = true;

        // NT8 pushes UnrealizedProfitLoss ~1/sec continuously even when flat, so the
        // flush interval is the main lever on request volume. Full 3s liveness only
        // during the actual usage window (9am-1pm weekdays); a slow 30s heartbeat
        // the rest of the time keeps data from ever fully freezing if checked
        // outside that window, while cutting request volume when nobody's watching.
        // Times are local (NT8 machine clock).
        private const int ActiveFlushMs = 3000;
        private const int IdleFlushMs   = 30000;

        private static int CurrentFlushMs()
        {
            var now = DateTime.Now;
            bool isWeekday = now.DayOfWeek >= DayOfWeek.Monday && now.DayOfWeek <= DayOfWeek.Friday;
            bool inWindow  = now.Hour >= 9 && now.Hour < 13; // 9:00-12:59
            return (isWeekday && inWindow) ? ActiveFlushMs : IdleFlushMs;
        }

        // Every batch is POSTed to ALL of these in parallel.
        // As long as ONE is up, data still reaches Supabase.
        // Free-tier headroom: Cloudflare 100k req/DAY, Supabase Edge Functions
        // 500k req/MONTH — both comfortably above the ~150k/month this addon
        // generates. Vercel is out of the active list (account disabled,
        // HTTP 402) — re-add "https://t-dashboard-pi.vercel.app/api/batch-update"
        // once its billing is fixed.
        private static readonly string[] ApiUrls =
        {
            "https://t-dashboard.rohan9695.workers.dev/api/batch-update",         // Cloudflare Workers (primary)
            "https://gvbtnsktudmgmpamkhnl.supabase.co/functions/v1/batch-update", // Supabase Edge Function (direct to DB)
        };

        // FAILOVER ONLY: Netlify's free tier (~125k function calls/month) is
        // below the always-on fan-out volume — it hit 50% mid-month in July 2026.
        // It now only receives a batch when BOTH primaries fail, keeping its
        // usage near zero. The Netlify site itself stays live as the backup
        // dashboard UI (viewing traffic is negligible).
        private const string FailoverUrl = "https://t-dashboard-971.netlify.app/api/batch-update";

        // Same endpoints for the account-sync route — derived so they can never
        // drift from the batch-update list. Sync is change-triggered and rare,
        // so it goes to ALL hosts including Netlify (volume is near zero).
        // One call per FILL ROUND. The addon is the only place that sees the whole
        // round, so aggregating here is what keeps a five-account fill to a single
        // phone alert instead of five. Same hosts, derived so they cannot drift.
        private static readonly string[] TradeEventUrls = Array.ConvertAll(
            new[] { ApiUrls[0], ApiUrls[1] },
            u => u.Replace("batch-update", "trade-event"));

        // How long to wait for the rest of a round after the first fill lands.
        // Replikanto copies to followers with some latency, so this has to
        // outlast that or the alert fires before the followers are counted and
        // reports a false partial. Too long and the alert stops being timely.
        private const int RoundWindowMs = 4000;

        private static readonly string[] SyncUrls = Array.ConvertAll(
            new[] { ApiUrls[0], ApiUrls[1], FailoverUrl },
            u => u.Replace("batch-update", "sync-accounts"));

        // Latest value per account per NT8 item — updated on every event
        private readonly Dictionary<string, Dictionary<string, double>> pending =
            new Dictionary<string, Dictionary<string, double>>();
        private readonly object   pendingLock = new object();
        private          DateTime lastFlush   = DateTime.MinValue;

        // Every distinct NT8 item name seen this session, so each is printed once
        // instead of once per second. Guarded by pendingLock.
        private readonly HashSet<string> seenItems = new HashSet<string>(StringComparer.Ordinal);

        // Fills seen in the current round, keyed by "SYMBOL|direction". Each entry
        // holds the accounts that filled, so one round is one notification.
        private readonly Dictionary<string, FillRound> rounds =
            new Dictionary<string, FillRound>(StringComparer.Ordinal);
        private readonly object roundLock = new object();

        private class FillRound
        {
            public string Symbol;
            public string Direction;
            public string EventType;
            public int Quantity;
            public readonly HashSet<string> Accounts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public System.Threading.Timer Timer;
        }

        private readonly HashSet<string> subscribed = new HashSet<string>();
        // Last account list POSTed to /api/sync-accounts — used to detect
        // adds/removals so we only hit the network when something changed.
        private readonly HashSet<string> lastSyncedAccounts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private DispatcherTimer subscribeTimer; // re-checks for newly connected accounts
        // ConnectionStatusUpdate and the timer can fire on different threads,
        // and both call SubscribeAll — serialize access to subscribed/lastSyncedAccounts.
        private readonly object subscribeLock = new object();

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                SubscribeAll();

                // Say up front whether a fill can actually reach the phone.
                // Finding out at fill time is finding out too late, and this
                // file ships with placeholders on purpose (the topic name IS
                // the password), so a fresh copy onto the trading machine lands
                // in exactly the broken state by default. Same reasoning as the
                // dashboard's "not ready" banner: warn before money is at risk,
                // not after.
                WarnIfNtfyUnconfigured();

                if (DebugDiscovery)
                    ProbeReplikanto();

                // At NT8 startup this addon loads BEFORE the broker connection is
                // up, so the SubscribeAll() above finds zero connected accounts.
                // This event fires on every connection status change, so accounts
                // get subscribed the moment the connection actually comes up —
                // without it, nothing subscribes until a manual F5 reload.
                Connection.ConnectionStatusUpdate += OnConnectionStatusUpdate;

                // Fallback only — DispatcherTimer.Tick is not reliable in the
                // NT8 AddOn context, so it must never be the sole trigger.
                subscribeTimer = new DispatcherTimer
                {
                    Interval = TimeSpan.FromSeconds(30)
                };
                subscribeTimer.Tick += (s, e) => SubscribeAll();
                subscribeTimer.Start();
            }
            else if (State == State.Terminated)
            {
                Connection.ConnectionStatusUpdate -= OnConnectionStatusUpdate;

                if (subscribeTimer != null) { subscribeTimer.Stop(); subscribeTimer = null; }

                foreach (Account acct in Account.All)
                {
                    acct.AccountItemUpdate -= OnAccountItemUpdate;
                    acct.ExecutionUpdate   -= OnExecutionUpdate;
                }

                lock (roundLock)
                {
                    foreach (var r in rounds.Values)
                        if (r.Timer != null) r.Timer.Dispose();
                    rounds.Clear();
                }

                subscribed.Clear();
            }
        }

        // ── DIAGNOSTIC: does Replikanto expose its own state? ───────────────────
        // Replikanto runs inside this same NinjaTrader process, so if it exposes
        // anything publicly, reflection will find it. Scans EVERY loaded assembly
        // rather than looking for one named "Replikanto", because NinjaScript
        // distributed as source compiles into NinjaTrader.Custom.dll and would not
        // carry its own assembly name.
        //
        // Output is deliberately narrow: only members whose name looks like state
        // (connect/status/state/online/enable/link/session/login/licen). Dumping
        // every member of every type would bury the answer.
        //
        // Reads only. Invokes nothing, changes nothing.
        private void ProbeReplikanto()
        {
            try
            {
                Print("AccountMonitor probe: scanning loaded assemblies for Replikanto...");
                int hits = 0;

                foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    Type[] types;
                    try
                    {
                        types = asm.GetTypes();
                    }
                    catch (ReflectionTypeLoadException ex)
                    {
                        // A partially-loadable assembly still yields the types that
                        // did load; the nulls are the ones that did not.
                        types = ex.Types ?? new Type[0];
                    }
                    catch
                    {
                        continue; // dynamic or otherwise unreadable — skip
                    }

                    foreach (Type t in types)
                    {
                        if (t == null) continue;
                        string full = t.FullName ?? string.Empty;
                        if (full.IndexOf("Replikanto", StringComparison.OrdinalIgnoreCase) < 0) continue;

                        hits++;
                        Print("  TYPE " + full + "   [" + asm.GetName().Name + "]");

                        const BindingFlags flags = BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance;

                        foreach (PropertyInfo p in t.GetProperties(flags))
                            if (LooksLikeState(p.Name))
                                Print("    prop  " + p.PropertyType.Name + " " + p.Name);

                        foreach (FieldInfo f in t.GetFields(flags))
                            if (LooksLikeState(f.Name))
                                Print("    field " + f.FieldType.Name + " " + f.Name);

                        foreach (EventInfo ev in t.GetEvents(flags))
                            Print("    event " + ev.Name);
                    }
                }

                if (hits == 0)
                    Print("AccountMonitor probe: no Replikanto types found. Either it is not "
                        + "loaded, or it exposes nothing public — connection status cannot be read.");
                else
                    Print("AccountMonitor probe: " + hits + " Replikanto type(s) found. Send this output back.");
            }
            catch (Exception ex)
            {
                // A diagnostic must never take the addon down with it.
                Print("AccountMonitor probe failed: " + ex.Message);
            }
        }

        private static bool LooksLikeState(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            string n = name.ToLowerInvariant();
            return n.Contains("connect") || n.Contains("status") || n.Contains("state")
                || n.Contains("online")  || n.Contains("enable") || n.Contains("link")
                || n.Contains("session") || n.Contains("login")  || n.Contains("licen");
        }

        // "Live" = actually connected right now (the green dot in NT8's Accounts
        // panel), not just a saved/historical/demo/backtest account definition.
        // Printed once at load so the Output window answers "will I get an alert
        // if I trade right now?" without having to trade to find out.
        private void WarnIfNtfyUnconfigured()
        {
            if (NtfyTopic == "REPLACE_WITH_REAL_NTFY_TOPIC" || string.IsNullOrEmpty(NtfyTopic))
                Print("AccountMonitor: NO PHONE ALERTS - NtfyTopic is still the placeholder in this copy of "
                    + "AccountMonitor.cs. Fills will still reach the dashboard, but nothing will reach your "
                    + "phone. Set NtfyTopic (and NtfyToken) at the top of this file, then recompile.");
            else
                Print("AccountMonitor: phone alerts armed (ntfy topic configured).");
        }

        // Account.All includes every account NT8 has ever known about, connected
        // or not — filtering on connection status (not name) is what keeps
        // old demo/backtest accounts from ever reaching the dashboard again.
        private static bool IsLiveAccount(Account acct)
        {
            if (acct == null) return false;
            if (acct.Name.StartsWith("Sim", StringComparison.OrdinalIgnoreCase)) return false;
            return acct.Connection != null && acct.Connection.Status == ConnectionStatus.Connected;
        }

        private void OnConnectionStatusUpdate(object sender, ConnectionStatusEventArgs e)
        {
            // Any transition matters: Connected picks up newly live accounts,
            // Disconnected drops them from the live set so /api/sync-accounts
            // hides them on the dashboard. SubscribeAll is cheap and only hits
            // the network when the live set actually changed.
            SubscribeAll();
        }

        private void SubscribeAll()
        {
            lock (subscribeLock)
            {
                var currentLive = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (Account acct in Account.All)
                {
                    if (!IsLiveAccount(acct)) continue;
                    currentLive.Add(acct.Name);

                    if (subscribed.Contains(acct.Name)) continue;

                    acct.AccountItemUpdate += OnAccountItemUpdate;
                    acct.ExecutionUpdate    += OnExecutionUpdate;
                    subscribed.Add(acct.Name);
                    Print("AccountMonitor: subscribed " + acct.Name);
                }

                // Only hit the network when NT8's live account set actually changed —
                // adds/removals are rare, so this is near-zero-cost in steady state.
                // Accounts that disconnect drop out of currentLive here too, which
                // triggers /api/sync-accounts to hide them on the dashboard.
                if (!currentLive.SetEquals(lastSyncedAccounts))
                {
                    lastSyncedAccounts.Clear();
                    foreach (var name in currentLive) lastSyncedAccounts.Add(name);

                    Print("AccountMonitor: account list changed, syncing " + currentLive.Count + " accounts");
                    _ = SendAccountSyncAsync(new List<string>(currentLive));
                }
            }
        }

        private void OnAccountItemUpdate(object sender, AccountItemEventArgs e)
        {
            var acct = sender as Account;
            // Safety net: ignore events from an account that has since disconnected,
            // even though we stay subscribed to it (subscribed is cumulative so we
            // don't miss a reconnect — see SubscribeAll).
            if (!IsLiveAccount(acct))
                return;

            Dictionary<string, Dictionary<string, double>> toFlush = null;
            string newItem = null;

            lock (pendingLock)
            {
                // Accumulate the latest value for this account+item
                if (!pending.ContainsKey(acct.Name))
                    pending[acct.Name] = new Dictionary<string, double>();

                string itemName = e.AccountItem.ToString();
                pending[acct.Name][itemName] = e.Value;

                // First sighting of this item name this session. Printed outside
                // the lock so a slow Output window cannot stall ingestion.
                if (DebugDiscovery && seenItems.Add(itemName))
                    newItem = itemName + " = " + e.Value.ToString(CultureInfo.InvariantCulture)
                            + "   (" + acct.Name + ")";

                // Only flush once every CurrentFlushMs() milliseconds — fast during
                // the usage window, slow otherwise
                var now = DateTime.UtcNow;
                if ((now - lastFlush).TotalMilliseconds >= CurrentFlushMs() && pending.Count > 0)
                {
                    lastFlush = now;

                    // Snapshot and clear under the lock
                    toFlush = new Dictionary<string, Dictionary<string, double>>();
                    foreach (var kvp in pending)
                        toFlush[kvp.Key] = new Dictionary<string, double>(kvp.Value);
                    pending.Clear();
                }
            }

            if (newItem != null)
                Print("AccountMonitor ITEM: " + newItem);

            // Fire HTTP off the lock — fire-and-forget
            if (toFlush != null)
                _ = SendBatchAsync(toFlush, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }


        // ── FILL ROUNDS → one phone alert ───────────────────────────────────────
        // NT8 raises ExecutionUpdate once per account per fill. Sending each one
        // straight to /api/trade-event would give five notifications for a
        // five-account entry, which is exactly what the endpoint was built to
        // avoid. So collect fills into a round and POST once when it settles.
        //
        // Everything here is wrapped: a notification is a convenience, and it must
        // never be able to throw into NT8's event thread and disturb ingestion.
        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            try
            {
                if (e == null || e.Execution == null) return;

                Account acct = e.Execution.Account;
                if (!IsLiveAccount(acct)) return;

                Instrument instr = e.Execution.Instrument;
                string symbol = (instr != null && instr.MasterInstrument != null)
                    ? instr.MasterInstrument.Name : "?";

                string direction = e.Execution.MarketPosition == MarketPosition.Short ? "short" : "long";

                // Whether this fill opened or closed is read from the resulting
                // position. Positions are not always updated by the time this
                // fires, so treat the label as best-effort — the value of the
                // alert is "N of M accounts filled", not the open/close wording.
                string eventType = IsFlatOn(acct, instr) ? "close" : "open";

                string key = symbol + "|" + direction;

                lock (roundLock)
                {
                    FillRound round;
                    if (!rounds.TryGetValue(key, out round))
                    {
                        round = new FillRound
                        {
                            Symbol = symbol, Direction = direction,
                            EventType = eventType, Quantity = e.Execution.Quantity,
                        };
                        rounds[key] = round;
                        // One-shot: fires once, RoundWindowMs after the FIRST fill of
                        // the round. Later fills join the same round rather than
                        // extending it, so a slow trickle of copies cannot postpone
                        // the alert indefinitely.
                        round.Timer = new System.Threading.Timer(
                            _ => FlushRound(key), null, RoundWindowMs, System.Threading.Timeout.Infinite);
                    }
                    round.Accounts.Add(acct.Name);
                }
            }
            catch (Exception ex)
            {
                Print("AccountMonitor execution handler error: " + ex.Message);
            }
        }

        private static bool IsFlatOn(Account acct, Instrument instr)
        {
            try
            {
                foreach (Position p in acct.Positions)
                    if (p.Instrument == instr && p.MarketPosition != MarketPosition.Flat)
                        return false;
                return true;
            }
            catch { return false; }
        }

        private void FlushRound(string key)
        {
            FillRound round = null;
            int expected;

            lock (roundLock)
            {
                if (!rounds.TryGetValue(key, out round)) return;
                rounds.Remove(key);
                if (round.Timer != null) round.Timer.Dispose();
            }

            // How many accounts SHOULD have filled — the live set. This is what
            // turns "3 accounts filled" into "3 of 5", which is the whole point:
            // the endpoint escalates to urgent priority when they disagree.
            lock (subscribeLock) { expected = lastSyncedAccounts.Count; }
            if (expected < round.Accounts.Count) expected = round.Accounts.Count;

            var sb = new StringBuilder("{");
            sb.Append("\"symbol\":\"").Append(Escape(round.Symbol)).Append("\",");
            sb.Append("\"direction\":\"").Append(round.Direction).Append("\",");
            sb.Append("\"event_type\":\"").Append(round.EventType).Append("\",");
            sb.Append("\"quantity\":").Append(round.Quantity).Append(',');
            sb.Append("\"total_accounts\":").Append(expected).Append(',');
            sb.Append("\"accounts\":[");
            bool first = true;
            foreach (string name in round.Accounts)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append('"').Append(Escape(name)).Append('"');
            }
            sb.Append("]}");

            string json = sb.ToString();
            Print("AccountMonitor FILL: " + round.Accounts.Count + " of " + expected + " - " + json);

            // One host is enough: a second delivery would mean a second phone
            // alert, so these are tried in ORDER and stop at the first success —
            // the opposite of the batch fan-out, deliberately.
            _ = SendTradeEventAsync(json);

            // The actual phone push, sent from here rather than left to
            // /api/trade-event's server-side notify() — see the NtfyTopic
            // comment above for why. SendTradeEventAsync above still owns the
            // trade_events DB row the dashboard toast needs; this is the only
            // thing that reaches the phone.
            bool partial = round.Accounts.Count < expected;
            string title = partial ? round.Symbol + " " + round.Direction + " - PARTIAL"
                                    : round.Symbol + " " + round.Direction;
            string body  = partial
                ? "Filled on " + round.Accounts.Count + " of " + expected + " accounts only"
                : "Filled on " + round.Accounts.Count + " account" + (round.Accounts.Count == 1 ? "" : "s");
            _ = SendNtfyAsync(title, body, partial ? "rotating_light" : "white_check_mark", partial);
        }

        private static async Task SendNtfyAsync(string title, string body, string tags, bool urgent)
        {
            // NOT a silent return, which is what this was. FlushRound prints
            // "AccountMonitor FILL: ..." one line earlier, so the Output window
            // showed the round detected and handed off while nothing whatsoever
            // reached the phone — a discarded alert that looked exactly like a
            // delivered one. See CLAUDE.md rule 11; this file's whole reason to
            // exist is the push, so it is the last place that may drop quietly.
            if (NtfyTopic == "REPLACE_WITH_REAL_NTFY_TOPIC" || string.IsNullOrEmpty(NtfyTopic))
            {
                NinjaTrader.Code.Output.Process(
                    "AccountMonitor: FILL NOT PUSHED - NtfyTopic is still the placeholder in this copy of "
                  + "AccountMonitor.cs. Set NtfyTopic (and NtfyToken) at the top of the file, then recompile.",
                    NinjaTrader.NinjaScript.PrintTo.OutputTab1);
                return;
            }
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Post, NtfyServer.TrimEnd('/') + "/" + NtfyTopic))
                {
                    req.Content = new StringContent(body, Encoding.UTF8);
                    req.Headers.Add("Title", title);
                    req.Headers.Add("Tags", tags);
                    req.Headers.Add("Priority", urgent ? "urgent" : "default");
                    if (!string.IsNullOrEmpty(NtfyToken) && NtfyToken != "REPLACE_WITH_REAL_NTFY_TOKEN")
                        req.Headers.Add("Authorization", "Bearer " + NtfyToken);

                    var resp = await httpClient.SendAsync(req).ConfigureAwait(false);
                    // Output.Process, not Print: this is a static method (Print is
                    // an instance member, CS0120), and not Debug.WriteLine either —
                    // this alert already went missing once from a failure nobody
                    // could see (Debug.WriteLine never reaches the Output window —
                    // see nt8/README.md). Not worth repeating that mistake on the
                    // one thing this file exists to deliver.
                    if (!resp.IsSuccessStatusCode)
                        NinjaTrader.Code.Output.Process("AccountMonitor: ntfy push failed, HTTP " + (int)resp.StatusCode,
                            NinjaTrader.NinjaScript.PrintTo.OutputTab1);
                }
            }
            catch (Exception ex)
            {
                NinjaTrader.Code.Output.Process("AccountMonitor: ntfy push error - " + ex.Message,
                    NinjaTrader.NinjaScript.PrintTo.OutputTab1);
            }
        }

        private static async Task SendTradeEventAsync(string json)
        {
            foreach (string url in TradeEventUrls)
            {
                bool ok = await SendOneAsync(url, json).ConfigureAwait(false);
                if (ok) return;
            }
        }

        // ── REPLIKANTO STATUS ───────────────────────────────────────────────────
        // Replikanto keeps no public static handle on its state.
        //
        // Confirmed 2026-08-14: ReplikantoFramework (the original, single guess
        // at "the" singleton) IS reachable via a static field on itself, but its
        // own instance fields are just NTMenuItems, a version stamp, and a timer
        // — a NinjaTrader menu-integration wrapper, not the state holder. Rather
        // than hardcode a second guess at which of Replikanto's ~190 loaded
        // types holds the real singleton, every type in the Replikanto/FlowBots
        // namespaces gets a turn: any static field anywhere in those namespaces
        // whose value is itself Replikanto/FlowBots-owned becomes a root
        // candidate, and each candidate is searched for Node/InternetNode.
        //
        // Matched by TYPE NAME, never by field name — Replikanto obfuscates
        // member names (unprintable combining characters, will change on every
        // release), but the public type names (Node, InternetNode, SlaveAccount)
        // and their public properties are stable.
        //
        // Reports "unknown" whenever anything is missing. A copier status that
        // silently reads "connected" because reflection quietly failed would be
        // worse than no status at all, so every failure path lands on unknown.
        private static List<object> replikantoRoots;
        private static bool         rootsLookedUp;

        private static bool IsReplikantoNamespace(string ns) =>
            ns != null && (
                ns.StartsWith("Replikanto", StringComparison.OrdinalIgnoreCase) ||
                ns.StartsWith("FlowBots", StringComparison.OrdinalIgnoreCase));

        private static List<object> GetReplikantoRoots()
        {
            if (rootsLookedUp) return replikantoRoots;
            rootsLookedUp = true;
            var roots = new List<object>();
            try
            {
                const BindingFlags STATIC_ALL =
                    BindingFlags.NonPublic | BindingFlags.Public |
                    BindingFlags.Static | BindingFlags.FlattenHierarchy;

                foreach (Assembly a in AppDomain.CurrentDomain.GetAssemblies())
                {
                    Type[] ts;
                    try { ts = a.GetTypes(); }
                    catch (ReflectionTypeLoadException ex) { ts = ex.Types ?? new Type[0]; }
                    catch { continue; }

                    foreach (Type t in ts)
                    {
                        // Enums are the noise that swamped the first version of
                        // this scan (confirmed 2026-08-14: 28 "roots" found, the
                        // first 8 shown were all Replikanto.EnumMethod /
                        // FollowerAccountStatus values) — every named enum
                        // member is technically a static field whose value's
                        // type trivially matches the namespace filter, and an
                        // enum value can never hold a Node/InternetNode.
                        if (t == null || t.IsEnum || !IsReplikantoNamespace(t.Namespace)) continue;

                        FieldInfo[] fields;
                        try { fields = t.GetFields(STATIC_ALL); } catch { continue; }

                        foreach (FieldInfo f in fields)
                        {
                            object v;
                            try { v = f.GetValue(null); } catch { continue; }
                            if (v == null) continue;
                            Type vt = v.GetType();
                            if (vt.IsEnum || vt.IsPrimitive || vt == typeof(string)) continue;
                            if (!IsReplikantoNamespace(vt.Namespace)) continue;
                            if (!roots.Contains(v)) roots.Add(v);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // Behavior is unchanged either way (empty roots -> unknown) — this
                // only adds visibility, replacing a bare catch{} that swallowed
                // the exact exception that made the ReplikantoFramework-only
                // version of this search fail silently for two rounds straight.
                NinjaTrader.Code.Output.Process(
                    "AccountMonitor: Replikanto root scan threw: " + ex.GetType().FullName + ": " + ex.Message,
                    NinjaTrader.NinjaScript.PrintTo.OutputTab1);
            }
            replikantoRoots = roots;
            return roots;
        }

        /// <summary>
        /// "online" | "off" | "away" | "unknown". Derived from the Replikanto
        /// node objects: online if ANY node reports Online, because one live node
        /// is what copying actually needs.
        /// </summary>
        private static string lastReportedStatus;

        private static string ReadReplikantoStatus()
        {
            string result = ReadReplikantoStatusCore();
            if (result != lastReportedStatus)
            {
                lastReportedStatus = result;
                // Printed on CHANGE only — this runs every batch, and a line per
                // batch would bury everything else in the Output window. Static
                // context (called from SendBatchAsync), so this uses the
                // Output.Process utility rather than the instance Print() method
                // used elsewhere in this file.
                NinjaTrader.Code.Output.Process("AccountMonitor: Replikanto status -> " + result,
                    NinjaTrader.NinjaScript.PrintTo.OutputTab1);
            }
            return result;
        }

        private static string ReadReplikantoStatusCore()
        {
            try
            {
                List<object> roots = GetReplikantoRoots();
                if (roots.Count == 0) return "unknown";

                bool sawNode = false;
                string best = null;

                foreach (object root in roots)
                {
                    foreach (object node in FindByTypeName(root, new[] { "Node", "InternetNode" }, 0))
                    {
                        sawNode = true;
                        string st = PropString(node, "Status");          // NodeStatus: Off/Online/Away
                        if (st == null) continue;
                        st = st.ToLowerInvariant();
                        if (st == "online") return "online";             // one live node is enough
                        if (best == null || st == "away") best = st;
                    }
                }
                if (!sawNode)
                {
                    // One-time diagnostic: roots were found (this path only runs
                    // past the empty-roots check above), but nothing within
                    // FindByTypeName's depth limit, from ANY of them, type-matches
                    // Node/InternetNode. Dump each root's own direct field VALUE
                    // types so the next attempt knows what's actually reachable,
                    // instead of another guess.
                    DumpRootsOnce(roots);
                    return "unknown";
                }
                return best ?? "unknown";
            }
            catch { return "unknown"; }
        }

        private static bool rootsDumpDone;

        /// <summary>One-time diagnostic: for each candidate root (capped, in case
        /// the scan turned up many), print its type name and mirror
        /// FindByTypeName's own traversal (same depth, same descend rule) printing
        /// every field's value type instead of filtering — so a failed search is
        /// diagnosable from the SAME shape of walk that failed, not a guess.</summary>
        private static void DumpRootsOnce(List<object> roots)
        {
            if (rootsDumpDone) return;
            rootsDumpDone = true;
            var sb = new StringBuilder("AccountMonitor: ").Append(roots.Count)
                .Append(" Replikanto root(s) found, none reach Node/InternetNode:");
            int shown = 0;
            foreach (object root in roots)
            {
                sb.Append("\n[root] ").Append(root.GetType().FullName);
                DumpFields(root, 0, sb);
                if (++shown >= 15) { sb.Append("\n...(remaining roots omitted)"); break; }
            }
            NinjaTrader.Code.Output.Process(sb.ToString(), NinjaTrader.NinjaScript.PrintTo.OutputTab1);
        }

        private static void DumpFields(object root, int depth, StringBuilder sb)
        {
            if (root == null || depth > 2) return;
            const BindingFlags F = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            FieldInfo[] fields;
            try { fields = root.GetType().GetFields(F); } catch (Exception ex) { sb.Append("\n  (GetFields threw at depth ").Append(depth).Append(": ").Append(ex.Message).Append(')'); return; }

            foreach (FieldInfo f in fields)
            {
                object v;
                try { v = f.GetValue(root); } catch (Exception ex) { sb.Append('\n').Append(new string(' ', depth * 2 + 2)).Append("(threw: ").Append(ex.Message).Append(')'); continue; }
                string indent = new string(' ', depth * 2 + 2);
                if (v == null) { sb.Append('\n').Append(indent).Append(f.FieldType.FullName).Append(" = null"); continue; }

                bool isCollection = !(v is string) && v is IEnumerable;
                sb.Append('\n').Append(indent).Append(v.GetType().FullName).Append(isCollection ? " [collection]" : "");

                string full = v.GetType().FullName ?? "";
                bool descend = full.IndexOf("Replikanto", StringComparison.OrdinalIgnoreCase) >= 0;

                if (isCollection)
                {
                    int i = 0;
                    try
                    {
                        foreach (object item in (IEnumerable)v)
                        {
                            if (item == null) continue;
                            string itemFull = item.GetType().FullName ?? "";
                            sb.Append('\n').Append(indent).Append("  [item] ").Append(itemFull);
                            if (itemFull.IndexOf("Replikanto", StringComparison.OrdinalIgnoreCase) >= 0)
                                DumpFields(item, depth + 1, sb);
                            if (++i > 10) { sb.Append('\n').Append(indent).Append("  ...(truncated)"); break; }
                        }
                    }
                    catch (Exception ex) { sb.Append('\n').Append(indent).Append("  (enum threw: ").Append(ex.Message).Append(')'); }
                }
                else if (descend)
                {
                    DumpFields(v, depth + 1, sb);
                }
            }
        }

        /// <summary>Walks an object's fields for instances whose TYPE name matches,
        /// one level into collections. Depth-limited: the object graph has cycles
        /// and this runs on the ingestion path.</summary>
        private static List<object> FindByTypeName(object root, string[] wantedTypeNames, int depth)
        {
            var found = new List<object>();
            if (root == null || depth > 2) return found;

            // The root itself can already BE a match — confirmed 2026-08-14: the
            // root scan found a live Replikanto.InternetNode instance directly,
            // but this function only ever checked root's FIELDS for a match, never
            // root itself, so it walked straight past the node into its own
            // sub-fields (string lists, bool arrays) and found nothing.
            foreach (string w in wantedTypeNames)
            {
                if (root.GetType().Name == w) { found.Add(root); return found; }
            }

            const BindingFlags F = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            FieldInfo[] fields;
            try { fields = root.GetType().GetFields(F); } catch { return found; }

            foreach (FieldInfo f in fields)
            {
                object v;
                try { v = f.GetValue(root); } catch { continue; }
                if (v == null) continue;

                var items = new List<object>();
                if (!(v is string) && v is IEnumerable)
                {
                    try
                    {
                        int i = 0;
                        foreach (object item in (IEnumerable)v)
                        {
                            if (item != null) items.Add(item);
                            if (++i > 50) break;
                        }
                    }
                    catch { continue; }
                }
                else items.Add(v);

                foreach (object item in items)
                {
                    string tn = item.GetType().Name;
                    bool match = false;
                    foreach (string w in wantedTypeNames) if (tn == w) { match = true; break; }
                    if (match) { found.Add(item); continue; }

                    // Only descend through Replikanto's own objects; the graph
                    // reaches all of WPF otherwise.
                    string full = item.GetType().FullName ?? "";
                    if (full.IndexOf("Replikanto", StringComparison.OrdinalIgnoreCase) >= 0)
                        found.AddRange(FindByTypeName(item, wantedTypeNames, depth + 1));
                }
            }
            return found;
        }

        private static object PropValue(object o, string name)
        {
            try
            {
                PropertyInfo p = o.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                if (p == null || p.GetIndexParameters().Length > 0) return null;
                return p.GetValue(o, null);
            }
            catch { return null; }
        }

        private static string PropString(object o, string name)
        {
            object v = PropValue(o, name);
            return v == null ? null : v.ToString();
        }

        private static async Task SendBatchAsync(Dictionary<string, Dictionary<string, double>> batch, long batchTs)
        {
            // _ts lets every host apply the same ordering guard: an older batch can
            // never overwrite a newer one, no matter which host's write lands last.
            // Replikanto's own link state, read from its live objects. Sent with
            // every batch as _replikanto so the dashboard can say it outright
            // instead of inferring a failure from leader-in-position-followers-flat.
            // Overall link only — per-follower status was considered and dropped.
            var sb = new StringBuilder("{\"_ts\":").Append(batchTs).Append(',');
            sb.Append("\"_replikanto\":\"").Append(ReadReplikantoStatus()).Append("\",");
            bool firstAcct = true;
            foreach (var acct in batch)
            {
                if (!firstAcct) sb.Append(',');
                firstAcct = false;
                sb.Append('"').Append(Escape(acct.Key)).Append("\":{");
                bool firstItem = true;
                foreach (var item in acct.Value)
                {
                    if (!firstItem) sb.Append(',');
                    firstItem = false;
                    sb.Append('"').Append(Escape(item.Key)).Append("\":");
                    sb.Append(item.Value.ToString(CultureInfo.InvariantCulture));
                }
                sb.Append('}');
            }
            sb.Append('}');

            string json = sb.ToString();

            // Fan out to both primaries in parallel — each is independent, one
            // failing/timing out must never stop the other from delivering.
            var sends = new Task<bool>[ApiUrls.Length];
            for (int i = 0; i < ApiUrls.Length; i++)
                sends[i] = SendOneAsync(ApiUrls[i], json);

            bool[] results = await Task.WhenAll(sends).ConfigureAwait(false);

            // Netlify failover: only if NO primary delivered (rare — a
            // dual-primary outage), so its small free tier is never burned
            // during normal operation.
            bool anyDelivered = false;
            foreach (bool ok in results)
                if (ok) anyDelivered = true;

            if (!anyDelivered)
                await SendOneAsync(FailoverUrl, json).ConfigureAwait(false);
        }

        private static async Task<bool> SendOneAsync(string url, string json)
        {
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    req.Content = new StringContent(json, Encoding.UTF8, "application/json");
                    req.Headers.Add("X-Api-Key", ApiKey);
                    var resp = await httpClient.SendAsync(req).ConfigureAwait(false);
                    // Log non-success so it's visible in NT8 output
                    if (!resp.IsSuccessStatusCode)
                        System.Diagnostics.Debug.WriteLine(
                            "AccountMonitor: HTTP " + (int)resp.StatusCode + " from " + url);
                    return resp.IsSuccessStatusCode;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("AccountMonitor error (" + url + "): " + ex.Message);
                return false;
            }
        }

        private static async Task SendAccountSyncAsync(List<string> liveAccounts)
        {
            var sb = new StringBuilder("{\"live_accounts\":[");
            for (int i = 0; i < liveAccounts.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(Escape(liveAccounts[i])).Append('"');
            }
            sb.Append("]}");
            string json = sb.ToString();

            var sends = new Task[SyncUrls.Length];
            for (int i = 0; i < SyncUrls.Length; i++)
                sends[i] = SendOneAsync(SyncUrls[i], json);

            await Task.WhenAll(sends).ConfigureAwait(false);
        }

        private static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
