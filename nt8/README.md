# NinjaTrader 8 addon — `nt8/`

This directory is the **source of truth** for `AccountMonitor.cs`, the NT8
C# addon that feeds the whole dashboard (account batches, fill-round ntfy
alerts, live-account sync). It cannot live inside NT8's own folder structure
and still be part of this repo, so NT8 gets a **copy**, not a symlink.

## Deploy target

```
Documents\NinjaTrader 8\bin\Custom\AddOns\AccountMonitor.cs
```

That folder is NOT version controlled. Before this file existed here, it was
a single uncontrolled copy on the trading machine with no history and no
diff — it was overwritten by a throwaway diagnostic probe mid-session and had
to be restored from a manual backup. Treat any edit made directly in the
AddOns folder as **unsaved work** until it's copied back here and committed.

## Syncing

**Repo → NT8 (deploying a change):**
1. Copy `nt8/AccountMonitor.cs` over the AddOns folder copy.
2. Replace three placeholders with real values — **never commit any of
   them**, see below:
   - `ApiKey` (`REPLACE_WITH_REAL_API_KEY`) — from Cloudflare Worker vars or
     `supabase secrets get API_KEY`.
   - `NtfyTopic` (`REPLACE_WITH_REAL_NTFY_TOPIC`) — the ntfy.sh topic phone
     alerts are sent to.
   - `NtfyToken` (`REPLACE_WITH_REAL_NTFY_TOKEN`) — an ntfy.sh access token
     (`Account → Access Tokens`). Optional in the sense that `SendNtfyAsync`
     skips auth if left blank/placeholder, but anonymous publishing from this
     machine's network may not have the same throttling problem Cloudflare
     hit — token still recommended.
3. Recompile in the NinjaScript Editor (F5) and confirm no other `.cs` file
   in the AddOns folder declares a class also named `AccountMonitor` or
   `ReplikantoProbe` — NT8 compiles every file in that folder into one
   assembly, so a duplicate class name anywhere in the folder breaks the
   build for everything in it, not just the file you touched.
4. Verify ingestion resumed: check the dashboard for `last_update` advancing,
   not just the NT8 Output window — HTTP failures in this addon are logged
   via `Debug.WriteLine`, which never reaches the Output window, so a 401 or
   timeout is otherwise silent.

**NT8 → Repo (capturing a change made live):**
1. Copy the AddOns folder's `AccountMonitor.cs` back over `nt8/AccountMonitor.cs`.
2. Replace all three real values — `ApiKey`, `NtfyTopic`, `NtfyToken` — with
   their `REPLACE_WITH_REAL_*` placeholders before committing.
3. Commit.

## Never commit the real API key (or the ntfy topic/token)

`ApiKey`, `NtfyTopic`, and `NtfyToken` in the repo copy must always read their
`REPLACE_WITH_REAL_*` placeholder. The live `ApiKey` must match what's set in
Cloudflare Worker vars and
`supabase secrets` (`API_KEY`) or every batch 401s — silently, per the note
above. If a real key ever lands in a commit, treat it as compromised and
rotate it in Cloudflare + Supabase + this file together, same as any other
key rotation.

## Diagnostic probes

Throwaway reflection probes used to investigate Replikanto's connection
state (e.g. `ReplikantoProbe.cs`) live only in the AddOns folder, never here
— they're read-only, single-use, and meant to be deleted once answered. The
findings they produced are recorded in the root `CLAUDE.md` under
"Replikanto: readable, but only through a private singleton" so nobody has
to re-run them.
