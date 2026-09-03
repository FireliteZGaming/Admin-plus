# Admin+ — Reports (design, queued)

`/report <player> <reason>` — a member flags someone, and staff find out
immediately rather than the next time they think to check a list.

---

## 1. The flow

1. **`/report <player> <reason>`** — PlayerSelector, then free text. Works on
   offline players too (stored by id + name).
2. **Every online staff member is told in chat right away**, in the Staff channel
   if one exists, otherwise direct:
   `§c[REPORT] §fNova reported Griefer §8· breaking spawn`
3. **A Reports entry appears at the top of `/admin`**, above everything else and
   separated from the normal hubs, carrying the pending count:
   ```
   §c§lReports §8(3)
   ─────────────────
   Actions
   Ranks
   Warps
   Settings
   ```
4. **Open a report** → who reported whom, when, the reason, and the reported
   player's current status. From there:
   - **Take action** → jumps straight to that player's Actions screen (the same
     one, not a copy), so kick/ban/mute/freeze is one tap away.
   - **Dismiss** → closes it as nothing-to-do.
5. **It disappears once handled** and the count drops.

## 2. Read vs handled — the one thing to get right

"Goes away once you've read it" is ambiguous the moment two admins are online,
and getting it wrong means either duplicated work or a report quietly vanishing
unhandled. So there are two states, not one:

| State | Set by | Effect |
|---|---|---|
| **Read** | you opening it | it stops bolding *for you*; the count still shows it |
| **Handled** | Take action, or Dismiss | it leaves the list *for everyone*, with who handled it |

So opening a report never hides it from the rest of the staff — only resolving it
does. A report that everyone has read but nobody has handled still sits there,
which is exactly the behaviour you want at 3am.

If another admin resolves a report while you have it open, the screen says so
rather than letting you act on a closed one.

## 3. Panel placement

Bedrock action forms have no separator element, so the divider is a **label-only
button** (`§8────────────`) that simply re-renders the panel when pressed. Reports
sits above it, in red, only when the count is non-zero — an empty Reports button
would be noise on a quiet server. Gated on `admin.reports`.

## 4. Abuse control

Reports are player-submitted, so they need limits that a member cannot argue
with:

- **Cooldown** per reporter (default 60s), a `meta` value so a rank can lower it.
- **Cap of 3 pending reports per reporter** — file a fourth and it asks them to
  wait for staff, rather than letting one person flood the queue.
- **No self-reporting**, and reporting the same player twice while a report is
  still pending updates the existing one instead of stacking.
- Reports are **not** deleted on resolve; they move into the log
  (`report.filed`, `report.handled`) so a pattern of false reports is visible.

## 5. Open questions

1. **Should the reporter be told what happened?** *Recommendation: tell them it
   was handled, never what the punishment was — that is between staff and the
   reported player.*
2. **Retention** — keep resolved reports for how long? *Recommendation: fold into
   the log's ring buffer rather than a second store.*
3. **Report categories** (cheating / griefing / chat) as a dropdown before the
   free text, for filtering later? *Recommendation: yes, three buttons is faster
   to file than typing, and it makes the queue sortable.*
