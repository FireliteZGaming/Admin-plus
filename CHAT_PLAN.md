# Admin+ — Channels & Warp Access (design, queued)

Two features that share one idea: **a thing can be restricted to a rank, and the
UI only ever shows you what you can actually reach.**

Queued behind Warps and Settings. Written down now so the shape is settled.

---

## 1. Chat channels

### The model

A **channel** is a named room with a permission node. You are always *typing in*
exactly one channel, and you *see* one or more.

| Concept | What it means |
|---|---|
| **Active channel** | Where your messages go. One at a time. `/chat` switches it. |
| **Visible channels** | What you receive. Normally just your active one. |
| **View All Chats** | A rank toggle (`chat.viewall`). Holders receive every channel they have access to, regardless of which one they are typing in. Operators always have it. |

Members hold only General, so for them the whole system collapses to "chat
works normally" — they never see a channel they cannot use.

### What a line looks like

```
General   |   [Member] Nova: hi
Staff     |   [Admin] Vchris: Look at this member
Staff     |   [Manager] Firelite: Ik right?
General   |   [Member] Nova: is anyone chatting? so lonely here
```

That is the **View All** rendering. Someone sitting in General with the toggle
off sees only the General lines — and since every line they can see is General,
the label is uniform rather than informative:

```
General   |   [Member] Nova: hi
General   |   [Member] Nova: is anyone chatting? so lonely here
```

Format string, editable in `< Code >`:

```
format.chatChannel = {CHANNEL} §8|§r {TAG} {NAME}: §r{MSG}
```

Tokens: `{CHANNEL} {TAG} {RANK} {NAME} {MSG}`. The existing `format.chat` stays
as the single-channel fallback for anyone with exactly one visible channel.

### `/chat`

Opens a picker of the channels you have access to, current one marked. Selecting
one makes it active and confirms in chat. `/chat <name>` skips the UI for people
who know what they want, matching the pack's usual "command first, UI when
useful" shape.

### Shipped channels

| Channel | Node | Who |
|---|---|---|
| **General** | `chat.general` | everyone, default active |
| **Staff** | `chat.staff` | any rank with the node |

Channels are data, not code — created in the panel (Settings ▸ Chat), each with
a display name, colour, and the permission node that gates it. So a realm can
add Builders, Events, Applications without a script change.

### Rules that need stating

- **Access is not membership.** Having `chat.staff` means you *can* switch to
  Staff and, with View All, receive it. It does not force you into it.
- **Switching away from General means you stop receiving General** unless you
  hold View All. That is the point of the feature — the "focus" is real.
- **Muted applies everywhere.** A muted player cannot post to any channel.
- **Nothing leaks.** A player without `chat.staff` never receives a Staff line,
  View All or not — View All widens to channels you already have, never past
  them.
- **Console/log** gets every channel with its label, so the audit trail is whole.

---

## 2. Per-warp access

Each warp carries an optional access rule, edited from the warp's own screen:

```
/admin/warps/<warp>/
├── move-here        # re-anchor to where you stand
├── rename
├── access           # Everyone · Staff only · Specific rank or higher
└── delete
```

- **Everyone** — the default.
- **Staff only** — any rank flagged `staff`.
- **Rank or higher** — pick a ladder row; anyone at or above it qualifies.

`/warps` and the warp list only show warps you can actually use, so a member
never sees a staff warp exists. Attempting a restricted warp by name says the
warp does not exist, rather than "you lack permission" — no map of the staff
network handed out by error message.

Operators and config owners bypass warp access, consistent with the rest of the
pack.

---

## 3. Open questions

1. **Channel label when you only see one** — keep the `General |` prefix (as
   drawn above), or drop the prefix entirely so single-channel chat looks
   completely vanilla? *Recommendation: drop it — the label earns its space only
   when more than one channel is on screen.*
2. **Should staff default to View All on?** *Recommendation: yes for Admin and
   above, off for Mod, so a promotion visibly widens what you see.*
3. **Cross-channel replies** — worth a `/r`-style "reply into the channel that
   last mentioned me", or is switching enough? *Recommendation: skip for now.*
