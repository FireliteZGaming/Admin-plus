# Changelog

Every version of Admin+, newest first. One section per version, written when the
version is cut rather than reconstructed afterwards.

Versions between 1.4.0 and 1.15.0 were built and played but never published one
at a time — that is why the releases page jumps. From 1.15.0 on, every version
here gets its own tag, its own release and its own build, and nothing ships
without going through `python tools/release.py`.

Releases carry a channel, and it describes how sure we are rather than how big
the change was:

| | |
|---|---|
| **alpha** | the tests pass; the engine has never seen it. GitHub pre-release. |
| **beta** | it ran in a world and did what it should. |
| **release** | it has been played by somebody who did not write it. |

Nothing is renumbered on the way up. An alpha that survives is *promoted* — same
tag, same file, only the claim about it changes.

---

## 1.16.0 — 2026-09-04

**Banning is one screen, and the length is a slider.** It used to be two: a menu
of six preset lengths, then a box for the reason. Now it asks the three
questions together — a dropdown of reasons, a box for what actually happened,
and a single slider for how long.

The slider runs 1 to 7 days, and the 8th notch is **permanent** — the longest
length rather than a separate switch, so you cannot set "3 days" and "forever"
at the same time and leave the code to pick a winner. Bedrock draws a slider as
a bare number with no way to label a notch, so the field label names the last
one.

**Added**

- **`/ban <player>`** — opens the same screen, and tab-completes the name, which
  the panel's player list cannot. It deliberately takes no length argument:
  "/ban Steve 30" is thirty of something.
- **Permanent bans toggle** (`ban.allowPermanent`, in Code ▸ Bans). Switched off,
  the slider stops at 7 days and no value sent to it can produce a permanent ban
  — not the 8th notch, not a number past it.

## 1.15.0 — 2026-09-03

**Vanilla commands are a whitelist now.** `commands.allowed` is the single list;
anything not on it does not run through `/exec`, so `/op` cannot be reached even
by an owner. An empty list means nothing runs. `execute` and `function` are
deliberately off it — only the first word of a line is checked, so either one
would smuggle anything through behind it.

**Added**

- `/guestlist` — off means anyone may join; on means only listed names may. The
  removal is `Player.kick()`, never the `/kick` command.
- `/maintenance` — closes the world with a reason, staff excepted, so the people
  fixing it stay inside.
- One door: both checks run through a single `doorCheck()` so they can never
  disagree about who gets in.

## 1.14.0 — 2026-09-03

- Vanilla commands moved from a blocklist to an allowlist. A blocklist is a
  promise you have thought of every dangerous command; an allowlist is not.

## 1.13.1 — 2026-09-03

- **Nothing runs the `/kick` command any more.** On a local world `/kick` does
  not merely disconnect somebody — it locks them out until the *host* restarts
  the world. Moderation uses `Player.kick()` with no fallback, and `kick` is off
  the `/exec` whitelist. A kick that quietly fails is the smaller problem.

## 1.13.0 — 2026-09-03

- `/exec` — run whitelisted vanilla commands at operator level without holding
  operator. `dimension.runCommand()` is operator-level regardless of who asked,
  which is the whole mechanism.
- Staff read every room. Any staff rank sees General and Staff at once;
  switching changes where you *type*, not what you read.

## 1.12.0 — 2026-09-03

- **Idle worlds do nothing.** Hologram sync was scanning entities across every
  dimension every two seconds even with zero holograms placed; vanish ran a
  per-tick loop with nobody vanished; nametags were rewritten unconditionally.
  All of it is now conditional. No behaviour changed.

## 1.11.2 — 2026-09-03

- Leaderboards showed `commands.scoreboard.players.offlinePlayerName` instead of
  a name. A scoreboard participant's `displayName` is only a name while they are
  online, so names are cached while players are present.

## 1.11.1 — 2026-09-03

- Confirmed the storage cause in the content log: `world.getDynamicProperty`
  cannot be used during early execution, which is exactly when tables are
  constructed. Every table's first read had always failed.

## 1.11.0 — 2026-09-03

- **Never write defaults over storage that could not be read.** A read that
  *threw* is not an empty world. Treating it as one had been flushing default
  tables over real ones — warps, ranks, bans and settings reset on rejoin, for
  six versions, silently. Reads now report `{ok, value}`, and a seed is only
  committed once a read has actually succeeded.

## 1.10.3 — 2026-09-03

- The startup line reports the whole storage layer, not just ranks, so "did the
  world remember" is answerable without guessing.

## 1.10.2 — 2026-09-03

- A table that started from its seed re-reads on the first tick and adopts
  whatever storage really holds. This closed the common case of the reset bug;
  the remaining one — a second read that also failed — was closed in 1.11.0.

## 1.10.1 — 2026-09-03

- Switching server preset no longer erases ranks the new ladder does not define.
  Ids the incoming preset lacks are kept dormant and come back when you switch
  back.

## 1.10.0 — 2026-09-03

- Operator-only blocks, without operator. Nothing can exempt anyone from a
  vanilla Deny block — `beforeEvents` can only add restrictions, never remove
  them — so this is script-side protection instead.

## 1.9.0 — 2026-09-03

- Mod-tier ranks can set game modes.

## 1.8.1 — 2026-09-03

- Staff ranks always take the nametag; cosmetic ranks sit after them.
- Two fixes to the chat line added in 1.8.0.

## 1.8.0 — 2026-09-03

- `/praccept` and `/prdeny` for private chat invitations.
- A private chat's header says who it is between.

## 1.7.4 — 2026-09-03

- **Holograms and leaderboards were never renderable.** The resource pack had no
  client entity, so Bedrock drew nothing at all — no model, no nametag — while
  every script call reported success. They had been invisible since the day they
  were written.

## 1.7.3 — 2026-09-03

- Plainer error messages throughout. "You can't warn yourself" instead of
  something written to be charming.

## 1.7.2 — 2026-09-03

- Verification pass: private chat was imported but never installed, so `/prchat`
  did not exist. A permission node nobody could hold was removed. `verify.py`
  now fails on both shapes of that mistake.

## 1.7.1 — 2026-09-03

- Two TPA requests arriving at once no longer make it impossible to accept one
  and deny the other — you are asked which.

## 1.7.0 — 2026-09-03

- `/pm` and `/r` for private messages, `/socialspy` for staff, and `/prchat`
  two-person private sessions with `/prexit`.

## 1.6.0 — 2026-09-03

- `/mutechat` per channel or across all of them, announced by name.
- `/emote` — vanilla owns `/me`, so the name had to differ.

## 1.5.0 — 2026-09-03

- `/warn` with add and remove.
- `/report` rebuilt form-first: pick a player, pick a reason, say what happened.
- `/nick` for admins.

## 1.4.0 — 2026-09-03

- A Creator badge for the pack's author, shown until a real rank replaces it —
  so you can tell at a glance whether the person who wrote this just joined your
  world.
- Preset ladder ordering: development tiers sit above management.

## 1.3.0 — 2026-09-03

- Preset ladders gained an extra development tier.

## 1.2.0 — 2026-09-03

- Audit covers every operator-style act, not only the panel button for it. Using
  a command instead of the panel is no longer a way to act unlogged.

## 1.1.2 — 2026-09-02

- Staff action lines read as sentences — "Set Steve's game mode to creative" —
  instead of one template applied to everything.

## 1.1.1 — 2026-09-02

- The in-game credits no longer claim nothing was included.

## 1.1.0 — 2026-09-02

First public release. Ranks and permissions, the `/admin` panel, chat channels,
warps, moderation with a ban hammer, vanish, freeze, `/invsee`, `/sudo`, TPA,
holograms and leaderboards, automod alerts, and an audit log.
