# Safety Rules for AI Tools Working on This Project

## Golden Rules — Never Break These

1. **NEVER delete any file** without explicitly asking the user first and getting a "yes"
2. **NEVER run `git reset --hard`** — this destroys uncommitted work
3. **NEVER run `git push --force` on `main`** — only force push to the vercel branch
4. **NEVER commit or expose secrets** — `SUPABASE_SERVICE_ROLE_KEY`, `API_KEY`, anon keys must stay in Vercel env vars
5. **NEVER use `rm -rf`, `del`, `rmdir /s`, or any destructive shell command** without asking first
6. **NEVER modify `package-lock.json` manually** — only via `npm install`
7. **NEVER skip `npm run build`** before pushing — always verify the build passes locally first

---

## Safe Workflow for Every Change

```
1. Read the file before editing it
2. Make the smallest possible change
3. Run: npm run build
4. If build passes: git add <specific files> (never git add -A blindly)
5. git commit -m "descriptive message"
6. git push origin main
7. git push origin main:vercel/react-server-components-cve-vu-7f5ap6 --force
8. Wait for Vercel to deploy, verify it works
```

---

## Git Safety Rules

| Command | Safe? | Notes |
|---|---|---|
| `git status` | ✅ Always safe | Read-only |
| `git log` | ✅ Always safe | Read-only |
| `git diff` | ✅ Always safe | Read-only |
| `git add <file>` | ✅ Safe | Add specific files only |
| `git commit` | ✅ Safe | Always with a clear message |
| `git push origin main` | ✅ Safe | Normal push |
| `git push --force origin vercel/*` | ⚠️ OK | Only for the vercel branch |
| `git push --force origin main` | ❌ NEVER | Destroys history |
| `git reset --hard` | ❌ NEVER | Destroys local changes |
| `git clean -f` | ❌ NEVER | Deletes untracked files |
| `git checkout -- .` | ❌ NEVER | Destroys local changes |

---

## File Editing Rules

- Always **read a file before editing** it
- Use **targeted edits** (Edit tool) not full rewrites (Write tool) unless necessary
- If you must rewrite a file, **show the diff** to the user first
- Never delete a component and replace it — **modify in place**
- Keep **backward compatibility** — don't rename exports other files depend on

---

## Vercel & Supabase Rules

- **Vercel env vars**: Never log or print full values of secret env vars
- **Supabase**: Never drop tables or run destructive SQL without asking
- **Two-branch rule**: Every push to `main` must also go to `vercel/react-server-components-cve-vu-7f5ap6`
- **Production domain**: `t-dashboard-pi.vercel.app` — verify changes here after deploy

---

## Before Starting Any Session

Read these files in order:
1. `CLAUDE.md` — full project context, architecture, rules
2. `SAFETY.md` — this file
3. The specific file you're about to edit

---

## If Something Goes Wrong

1. **Don't panic and don't run more commands**
2. Run `git status` and `git log --oneline -10` to see current state
3. Report to the user exactly what happened
4. Wait for instructions before doing anything else

---

## Planned Features (ask user before starting)

- [ ] Push notifications to iPhone when trade is open on only one account
- [ ] Alert when drawdown buffer drops below threshold
- [ ] Fix production domain `t-dashboard-pi.vercel.app` (currently shows "No Deployment")
