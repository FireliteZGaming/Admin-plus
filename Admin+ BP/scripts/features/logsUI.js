import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, err, info, formatDate, formatDuration } from "../core/util.js"
import {
    has, canActOn, canSeeActionsOf, setRanks, restoreSnapshot,
    canEditRank, nodesBeyond, gainedBy, canReplaceRankList, heldRankIds, getRank
} from "../core/ranks.js"
import { allChannels, canUse } from "../core/channels.js"
import { unban, unmute, setFrozen, setTpaClosed } from "../core/moderation.js"
import { setNickname } from "../core/identity.js"
import { replaceOverrides } from "../core/settings.js"
import {
    recent, about, by, branch, search, people, getEntry,
    canUndo, markUndone, size, summarise
} from "../core/logs.js"
import {
    recentChat, recentSigns, chatBy, searchChat, chatLogSize, clearChatLog
} from "../core/chatlog.js"
import {
    recentCommands, commandsBy, searchCommands, refusedCommands,
    commandLogSize, clearCommandLog, commandText
} from "../core/cmdlog.js"

// /admin ▸ Logs
//
// **Three logs, three questions.** They are separate tables on purpose — see
// core/cmdlog.js for the reason, which is that chat and commands each outrun
// staff actions by orders of magnitude and would flush the audit trail out of
// a shared ring buffer within minutes.
//
//   Actions   who did what TO somebody      core/logs.js
//   Chat      what people said and wrote    core/chatlog.js
//   Commands  what was typed                core/cmdlog.js
//
// and three ways across them:
//
//   Players   one person, in all three
//   Filter    actions, grouped by kind
//   Search    free text
//
// **Things are filed where somebody would think to look.** A sign is chat, not
// an action — it used to sit under Recent between a ban and a rank grant. A
// command block is a command, not a loose branch of its own. Getting that
// wrong is not cosmetic: a log nobody can find their way around is a log
// nobody reads, and this screen exists for the fifteen minutes after something
// has gone wrong.
//
// Entries that changed something reversible carry the prior state and can be
// undone from here.

// Filter groups, each gathering several action prefixes under one plain name.
//
// **A flat list of nine branches left seven kinds of entry with no route to
// them at all.** `automod`, `hologram`, `troll`, `creator`, `dev`, `chat` and
// most of `admin` were being written and could not be read back — automod
// PUNISHES people, and why it did was unreachable from this screen. A branch
// list that has to be extended by hand every time something starts logging
// will always drift; a group takes whole prefixes, so a new `automod.x` is
// covered the day it exists.
//
// Signs and command blocks are no longer here. A sign is chat and lives in the
// Chat view with the rest of what people said; a command block belongs with
// commands. That was the whole point of the reorganisation — things filed
// where somebody would think to look for them.
const GROUPS = [
    {
        id: "moderation", label: "Moderation",
        hint: "bans, kicks, mutes, warnings, automod",
        prefixes: ["mod", "automod", "troll"]
    },
    {
        id: "chatmod", label: "Chat moderation",
        hint: "messages held, approved or denied, broadcasts",
        prefixes: ["chat"]
    },
    {
        id: "people", label: "Ranks and names",
        hint: "ranks given and taken, display names",
        prefixes: ["rank", "name"]
    },
    {
        id: "stafftools", label: "Staff tools",
        hint: "staff mode, vanish, sudo, holograms, admin items",
        prefixes: ["admin", "player", "hologram"]
    },
    {
        id: "server", label: "Server",
        hint: "< Code > edits, presets, warps, spawn, the creator console",
        prefixes: ["config", "warp", "omni", "creator", "dev"]
    },
    {
        id: "reports", label: "Reports",
        hint: "filed and handled",
        prefixes: ["report"]
    },
    {
        // Added 2.7.4. Land claims started logging in 2.7.0 and nothing on this
        // screen reached them — the exact drift the group scheme was meant to
        // prevent, and it happened anyway because a NEW prefix still needs a
        // group even though a new action under an old prefix does not.
        // `tests/logs.test.js` now fails if any prefix is written with no route.
        id: "land", label: "Land claims",
        hint: "claimed and given up",
        prefixes: ["claim"]
    }
]

/**
 * Every action prefix this screen can actually reach.
 *
 * Not the same thing as the groups. `cmdblock` is deliberately NOT a group — it
 * sits behind its own button on the Commands screen, because "what ran on this
 * server" is one question and a repeating command block is the loudest possible
 * answer to it — and `sign` is reached by the conditional legacy group. Both
 * are real routes, so both belong here.
 *
 * Exported for the test that fails when something starts logging under a prefix
 * nothing on this screen can read back.
 */
export function routedPrefixes() {
    return new Set([
        ...GROUPS.flatMap(group => group.prefixes),
        "sign",
        "cmdblock"
    ])
}

/**
 * Every entry belonging to a group, newest first.
 *
 * `seq` breaks a tie on `at`, and the tie is not hypothetical: `record()` is
 * synchronous, so several entries in one tick share a millisecond exactly.
 * The input here is the prefixes concatenated — every `mod.*`, then every
 * `automod.*` — and a stable sort leaves tied entries in that order, which is
 * prefix order and not time order. Automod muting somebody in the same
 * millisecond a staff member banned them would read in the wrong order, on the
 * one screen whose whole job is saying what happened first.
 *
 * `seq` counts from zero again on a world load, which is fine for a tiebreak:
 * it is only consulted when two entries share a millisecond, and entries from
 * either side of a reload never do.
 */
function groupEntries(group) {
    return group.prefixes.flatMap(prefix => branch(prefix))
        .sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0))
}

/**
 * Groups to show, including one that only exists while it has something in it.
 *
 * **A world upgrading to 2.6.6 still has `sign.*` entries in its action log**,
 * written before signs moved to the chat log. Dropping the branch that reached
 * them would have orphaned real records — which is the exact fault this
 * release exists to fix, committed while fixing it.
 *
 * It disappears by itself: nothing writes `sign.*` any more, so once the ring
 * buffer has turned over the group stops appearing and never comes back.
 */
function groupsFor() {
    const legacySigns = branch("sign")
    if (!legacySigns.length) return GROUPS
    return [...GROUPS, {
        id: "oldsigns", label: "Signs (older entries)",
        hint: "written before signs moved to the chat log",
        prefixes: ["sign"]
    }]
}

export async function logsScreen(player, back) {
    if (!has(player, "admin.logs")) { err(player, "You can't read the logs."); return back() }
    const again = () => logsScreen(player, back)

    return menu(player, {
        title: hubTitle("settings", "Logs"),
        body: subtitle(`${size()} entries kept. Newest first.`),
        buttons: [
            { text: hubButton("settings", "Actions", "What staff and the server did"), run: () => listScreen(player, "Actions", recent(120), again) },
            { text: hubButton("chat", "Chat", `What people said and wrote · ${chatLogSize()} lines`), run: () => chatScreen(player, again) },
            { text: hubButton("settings", "Commands", `What was typed · ${commandLogSize()} lines`), run: () => commandsScreen(player, again) },
            { text: hubButton("settings", "Players", "One player, across all three"), run: () => peopleScreen(player, again) },
            { text: hubButton("settings", "Filter", "Actions, by kind"), run: () => filterScreen(player, again) },
            { text: hubButton("settings", "Search", "By name or wording"), run: () => searchScreen(player, again) }
        ],
        back
    })
}

function line(entry) {
    const when = new Date(entry.at)
    const pad = n => String(n).padStart(2, "0")
    const clock = `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}`
    const undone = entry.undone ? " §8(undone)" : ""
    return `§8[${clock}] §r${summarise(entry)}§r${undone}\n§8${entry.actor?.name ?? "console"} · ${entry.detail || entry.action}`
}
// ---------------------------------------------------------- the reading view
//
// Logs are READ far more often than they are acted on, and they used to be a
// wall of buttons — one per entry, its text in §8 on a button face, which is
// dark grey on grey. The thing you were trying to read was the least legible
// part of the screen.
//
// So the entries live in the form's BODY now, the way the Credits screen puts
// its text: grouped under a day heading, newest first, nothing competing with
// them. Buttons are for moving and for acting, which is what buttons are for.
//
// Tapping an entry still matters — that is how an undo is reached — so it is
// not lost, just moved behind one button rather than being the only way to see
// anything.

/** Entries per page. A form body scrolls, so this is about reading comfort. */
const READ_PAGE = 14

/**
 * "Today", "Yesterday", or a date. Local time on purpose: the person reading is
 * standing in the world, and "yesterday" should mean their yesterday.
 */
export function dayLabel(at) {
    const when = new Date(at)
    const today = new Date()
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    if (sameDay(when, today)) return "Today"
    const yesterday = new Date(today.getTime() - 864e5)
    if (sameDay(when, yesterday)) return "Yesterday"
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${when.getDate()} ${months[when.getMonth()]}`
}

export function clockOf(at) {
    const when = new Date(at)
    const pad = n => String(n).padStart(2, "0")
    return `${pad(when.getHours())}:${pad(when.getMinutes())}`
}

/**
 * One screen of entries, grouped by day and rendered as text.
 *
 * `renderOne` returns the lines for a single entry, already coloured. The
 * grouping and the paging are this function's job so that the action log and the
 * chat log cannot drift into two different-looking screens.
 */
async function readingView(player, spec) {
    const page = spec.page ?? 0
    const pages = Math.max(1, Math.ceil(spec.entries.length / READ_PAGE))
    const slice = spec.entries.slice(page * READ_PAGE, (page + 1) * READ_PAGE)

    const body = []
    let lastDay
    for (const entry of slice) {
        const day = dayLabel(entry.at)
        if (day !== lastDay) {
            if (body.length) body.push("")
            body.push(`§e§l${day}`)
            lastDay = day
        }
        body.push(...spec.renderOne(entry))
    }
    if (pages > 1) {
        body.push("", `§8page ${page + 1} of ${pages} · ${spec.entries.length} total`)
    }

    const buttons = []
    // Newer first, because the list is newest-first and "back up" is the commoner
    // move when you are reading down through an incident.
    if (page > 0) {
        buttons.push({ text: "§f▲ Newer", run: () => readingView(player, { ...spec, page: page - 1 }) })
    }
    if (page < pages - 1) {
        buttons.push({ text: "§f▼ Older", run: () => readingView(player, { ...spec, page: page + 1 }) })
    }
    if (spec.onPick) {
        buttons.push({
            text: "§6Open an entry\n§8To see the detail, or undo it",
            run: () => pagedMenu(player, {
                title: hubTitle(spec.hub, spec.title),
                body: subtitle("Pick the one you want."),
                items: slice,
                render: entry => ({ text: line(entry) }),
                onPick: entry => spec.onPick(entry, () => readingView(player, { ...spec, page })),
                back: () => readingView(player, { ...spec, page })
            })
        })
    }

    return menu(player, {
        title: hubTitle(spec.hub, spec.title),
        body: body.join("\n"),
        buttons,
        back: spec.back
    })
}

/**
 * One entry, as reading text.
 *
 * The old button version put everything in §8 — dark grey, on a grey button
 * face. What you were trying to read was the least legible thing on screen.
 * Here the weight goes where the meaning is: the time is dim because it is a
 * label, the sentence is white because it is the point, and who did it is §7
 * rather than §8 so it is a quiet line and not an invisible one.
 */
export function readLine(entry) {
    const undone = entry.undone ? " §8(undone)" : ""
    const detail = entry.detail ? ` §8· ${entry.detail}` : ""
    return [
        `§8${clockOf(entry.at)} §f${summarise(entry)}§r${undone}`,
        `  §7${entry.actor?.name ?? "console"}${detail}`
    ]
}

/**
 * May this person read this entry back?
 *
 * **The live notice has had a rank rule since 2.1.x; the stored log never got
 * one.** core/audit.js refuses to tell a moderator that an operator opened
 * somebody's ender chest — and then the log remembered it and showed it to them
 * anyway, off a screen asking only for `admin.logs`. The leak was not closed,
 * it was delayed.
 *
 * The principle is the one the chat log uses: **you can read back what you
 * could have been told.** So both ends of the entry are checked, the way the
 * notice checks both ends of an action:
 *
 *   the ACTOR   whose action it was. This is the half the notice was missing
 *               in 2.1.x, and the half the log was missing entirely.
 *   the TARGET  who it happened to. An entry names them, and often names what
 *               was done to them.
 *
 * `canSeeActionsOf` on both — the SEEING rule, equal-or-below — rather than the
 * notice's stricter `canActOn` on the target. A log is a reading surface, and
 * every reading surface in this pack answers the same way: peers yes, above you
 * never.
 *
 * Anything you were part of is always yours to read, whichever end you were on.
 * An entry about you is how an appeal starts.
 */
function canReadEntry(player, entry) {
    if (!entry) return false
    if (entry.actor?.id === player.id || entry.target?.id === player.id) return true
    if (entry.actor?.id && !canSeeActionsOf(player, entry.actor.id)) return false
    if (entry.target?.id && !canSeeActionsOf(player, entry.target.id)) return false
    return true
}

/** The entries this person is allowed to see, in the order they came. */
function readableLog(player, entries) {
    return (entries ?? []).filter(entry => canReadEntry(player, entry))
}

async function listScreen(player, title, entries, back) {
    // Filtered HERE rather than at the five call sites that reach it — Recent,
    // a branch, a search, and both halves of one person's history. A funnel is
    // only a funnel if nothing goes round it.
    entries = readableLog(player, entries)

    if (!entries.length) { info(player, "Nothing logged there yet."); return back() }
    return readingView(player, {
        hub: "settings",
        title,
        entries,
        renderOne: readLine,
        onPick: (entry, home) => entryScreen(player, entry.id, home),
        back
    })
}

// ------------------------------------------------------------------- chat
//
// A separate door because it answers a different question. The action log says
// who did what TO somebody; this says what was actually said, which is the
// other half of most moderation decisions — an argument gets reported twenty
// minutes late and otherwise the only honest answer is "I wasn't there".
//
// This is the screen the reading view suits best. Chat is a CONVERSATION, and a
// conversation split one-line-per-button is the one thing you cannot follow;
// run together under a day heading it reads the way it was said.
//
// Private messages are not in here. They never pass through the channel funnel
// this reads from, and players can switch them off in their own settings — a
// log that kept them anyway would make that preference a lie.

/**
 * One line, as it was said: name and words on one row, like chat itself.
 *
 * Tagged `[Chat]` or `[Sign]`, because the two read identically otherwise and
 * "somebody wrote this on a sign at spawn" is a different thing from
 * "somebody said this once in chat". The tag is the first thing on the line
 * for the same reason chat clients put it there — you skim down the left edge.
 *
 * A sign's COORDINATE goes underneath rather than inline. It is what you need
 * second, after deciding the words matter, and a coordinate in the middle of a
 * sentence makes the sentence unreadable.
 */
function chatReadLine(entry) {
    const sign = entry.kind === "sign"
    const tag = sign ? "§6[Sign]" : "§b[Chat]"
    const where = !sign && entry.channel ? ` §8[${entry.channel}]` : ""
    const out = [`§8${clockOf(entry.at)} ${tag}${where} §f${entry.name}§7: §r${entry.text}`]
    if (sign && entry.was) out.push(`§8      was "${entry.was}"`)
    if (sign && entry.where) out.push(`§8      ${entry.where}`)
    return out
}

/**
 * One command, as it was typed.
 *
 * A refused command is kept and marked rather than dropped — somebody working
 * down the list trying what sticks looks exactly like a column of refusals,
 * and nothing else in the pack would show it.
 *
 * `ran` is what a command actually did, such as /clock day setting the time to
 * 1000. Shown underneath
 * only when it differs from what was typed, because for most commands it does
 * not and a line repeated back adds nothing.
 */
function commandReadLine(entry) {
    const typed = commandText(entry)
    const tag = entry.refused ? "§c[Cmd]" : "§a[Cmd]"
    const out = [`§8${clockOf(entry.at)} ${tag} §f${entry.name}§7: §r${typed}`]
    if (entry.refused) out.push(`§c      refused — ${entry.refused}`)
    else if (entry.ran && entry.ran !== typed) out.push(`§8      ran as ${entry.ran}`)
    return out
}

async function commandListScreen(player, title, entries, back) {
    if (!entries.length) { info(player, "No commands recorded there yet."); return back() }
    return readingView(player, {
        hub: "settings",
        title,
        entries,
        renderOne: commandReadLine,
        back
    })
}

async function chatListScreen(player, title, lines, back) {
    if (!lines.length) { info(player, "No chat recorded there yet."); return back() }
    return readingView(player, {
        hub: "chat",
        title,
        entries: lines,
        renderOne: chatReadLine,
        back
    })
}

/**
 * May this person read a line back?
 *
 * **You can read back what you could have heard.** Channels are not all public
 * — the comment in core/channels.js says so outright: a channel made later
 * gates on its own node, "which is what lets a manager run a room most staff
 * cannot read". Those lines were going into the log all the same, and the log
 * asked only for `admin.logs`. So a moderator read back a room they cannot
 * enter, off a screen captioned "Public chat only".
 *
 * Matched by id where the entry has one. Entries written before 2.3.0 do not,
 * so their display name is matched against the live channels instead; a line
 * from a channel that no longer exists is treated as restricted, because the
 * one thing that must not happen is defaulting an unknown room to readable.
 */
function canReadChatLine(player, entry) {
    const channels = allChannels()
    const byId = entry.channelId
        ? channels.find(c => c.id === entry.channelId)
        : undefined
    const found = byId ?? (entry.channel
        ? channels.find(c => String(c.display ?? "").replace(/§./g, "") === entry.channel)
        : undefined)
    // No channel at all on the entry means the world had none when it was
    // said — single-channel worlds log a bare line, and that IS the public one.
    if (!entry.channel && !entry.channelId) return true
    if (!found) return has(player, "chat.viewall")
    return canUse(player, found)
}

/** The lines this person is allowed to see, in the order they came. */
function readableChat(player, entries) {
    return entries.filter(entry => canReadChatLine(player, entry))
}

async function chatScreen(player, back) {
    const again = () => chatScreen(player, back)
    const kept = chatLogSize()
    const signs = readableChat(player, recentSigns(300)).length

    return menu(player, {
        title: hubTitle("chat", "Chat log"),
        body: [
            subtitle(kept ? `${kept} lines kept.` : "Nothing recorded yet."),
            "§8Chat and signs together. Private messages are never recorded, and you only see rooms you can enter."
        ].join("\n"),
        buttons: [
            { text: hubEntry("chat", "Recent", "Everything said and written, newest first"), run: () => chatListScreen(player, "Recent chat", readableChat(player, recentChat(150)), again) },
            signs
                ? { text: hubEntry("chat", "Signs only", `${signs} written on signs`), run: () => chatListScreen(player, "Signs", readableChat(player, recentSigns(150)), again) }
                : null,
            { text: hubEntry("chat", "Search", "Find a word, or everything one player said"), run: () => chatSearchScreen(player, again) },
            has(player, "admin.settings")
                ? { text: hubEntry("actions", "Clear the chat log", "Deletes every saved line"), run: () => clearChatScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function chatSearchScreen(player, back) {
    const values = await modal(player, hubTitle("chat", "Search chat"), [
        { id: "text", type: "text", label: "A word, or a player's name", placeholder: "diamond" }
    ])
    if (!values) return back()
    const text = String(values.text ?? "").trim()
    if (!text) return back()
    return chatListScreen(player, `Chat · "${text}"`, readableChat(player, searchChat(text, 150)), back)
}

async function clearChatScreen(player, back) {
    const yes = await confirm(player, hubTitle("chat", "Clear chat log"),
        `Delete all ${chatLogSize()} saved lines?\n\n§8The action log is not touched.`,
        "§cClear")
    if (!yes) return back()
    clearChatLog()
    ok(player, "Chat log cleared.")
    return back()
}

// ------------------------------------------------------------------ commands
//
// **Everything typed, including what was refused.** The command log is its own
// table for the reason chat is: `/warps`, `/online` and `/info` are typed
// constantly by ordinary players, and sharing the audit log's ring buffer
// would push every ban out of Recent within minutes.
//
// Command BLOCKS sit here too, because "what commands ran on this server" is
// one question and a repeating command block is the loudest possible answer to
// it. They stay audit entries — placing a block is an action with a location
// and a detail view — so they get their own button rather than being flattened
// into the typed list, which would lose the entry screen they open.

async function commandsScreen(player, back) {
    const again = () => commandsScreen(player, back)
    const kept = commandLogSize()
    const refused = refusedCommands(300).length
    const blocks = branch("cmdblock")

    return menu(player, {
        title: hubTitle("settings", "Commands"),
        body: [
            subtitle(kept ? `${kept} commands kept.` : "Nothing recorded yet."),
            "§8Every command typed, whether it ran or was refused."
        ].join("\n"),
        buttons: [
            { text: hubEntry("settings", "Recent", "Everything typed, newest first"), run: () => commandListScreen(player, "Recent commands", recentCommands(150), again) },
            refused
                ? { text: hubEntry("actions", "Refused", `${refused} refused (no permission, or nobody matched)`), run: () => commandListScreen(player, "Refused commands", refusedCommands(150), again) }
                : null,
            blocks.length
                ? { text: hubEntry("settings", "Command blocks", `${blocks.length} placed or broken · who and where`), run: () => listScreen(player, "Command blocks", blocks, again) }
                : null,
            { text: hubEntry("settings", "Search", "Find a command, an argument, or one player"), run: () => commandSearchScreen(player, again) },
            has(player, "admin.settings")
                ? { text: hubEntry("actions", "Clear the command log", "Deletes every saved command"), run: () => clearCommandsScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function commandSearchScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "Search commands"), [
        { id: "text", type: "text", label: "A command, an argument, or a player's name", placeholder: "give" }
    ])
    if (!values) return back()
    const text = String(values.text ?? "").trim()
    if (!text) return back()
    return commandListScreen(player, `Commands · "${text}"`, searchCommands(text, 150), back)
}

async function clearCommandsScreen(player, back) {
    const yes = await confirm(player, hubTitle("settings", "Clear command log"),
        `Delete all ${commandLogSize()} saved commands?\n\n§8The action log and the chat log are not touched.`,
        "§cClear")
    if (!yes) return back()
    clearCommandLog()
    ok(player, "Command log cleared.")
    return back()
}

async function peopleScreen(player, back) {
    const seen = people()
    if (!seen.length) { info(player, "Nobody is in the log yet."); return back() }
    return pagedMenu(player, {
        title: hubTitle("settings", "Logs · players"),
        body: subtitle("Every player in the log, whether they acted or were acted on."),
        items: seen,
        render: person => ({
            text: `§f${person.name}§r\n§8${readableLog(player, about(person.id)).length} received`
                + ` · ${readableLog(player, by(person.id)).length} did`
        }),
        onPick: person => personScreen(player, person, () => peopleScreen(player, back)),
        back
    })
}

async function personScreen(player, person, back) {
    const received = readableLog(player, about(person.id))
    const did = readableLog(player, by(person.id))
    const said = readableChat(player, chatBy(person.id, 150))
    const typed = commandsBy(person.id, 150)
    return menu(player, {
        title: hubTitle("settings", person.name),
        body: [
            subtitle("What was done to them, what they did, said and typed."),
            `§fDone to them: §7${received.length}`,
            `§fThings they did: §7${did.length}`,
            `§fLines of chat: §7${said.length}`,
            `§fCommands typed: §7${typed.length}`
        ].join("\n"),
        buttons: [
            { text: hubEntry("actions", "Received", "What staff did to them, for appeals"), run: () => listScreen(player, `${person.name} · received`, received, () => personScreen(player, person, back)) },
            { text: hubEntry("ranks", "Did", "What they did as staff, to check their work"), run: () => listScreen(player, `${person.name} · did`, did, () => personScreen(player, person, back)) },
            // The third question people actually ask about somebody, and the
            // one the action log could never answer.
            said.length
                ? { text: hubEntry("chat", "Said", `${said.length} line${said.length === 1 ? "" : "s"} of chat and signs`), run: () => chatListScreen(player, `${person.name} · said`, said, () => personScreen(player, person, back)) }
                : null,
            // The fourth question, and the one that used to have no answer at
            // all: what has this person actually been typing?
            typed.length
                ? { text: hubEntry("settings", "Typed", `${typed.length} command${typed.length === 1 ? "" : "s"}`), run: () => commandListScreen(player, `${person.name} · typed`, typed, () => personScreen(player, person, back)) }
                : null
        ].filter(Boolean),
        back
    })
}

async function filterScreen(player, back) {
    return menu(player, {
        title: hubTitle("settings", "Filter"),
        body: subtitle("Actions only. Chat and commands have their own screens."),
        buttons: groupsFor().map(g => {
            const entries = groupEntries(g)
            return {
                text: `${g.label}§r\n§8${g.hint} · ${entries.length}`,
                run: () => listScreen(player, g.label, entries, () => filterScreen(player, back))
            }
        }),
        back
    })
}

/**
 * Search, across all three logs at once.
 *
 * Somebody arriving at this screen knows a word — a name, a slur, a command —
 * and does NOT know which of the three logs it will turn out to be in. Asking
 * them to guess first, and to repeat the search twice more when they guess
 * wrong, is the kind of thing that makes people stop using a log.
 *
 * All three matches are case-insensitive substrings, so "ste" finds "NotSteve"
 * whatever case it was typed in.
 */
async function searchScreen(player, back) {
    const again = () => searchScreen(player, back)
    const values = await modal(player, hubTitle("settings", "Search logs"), [
        { id: "text", type: "text", label: "Name, action, wording or command", placeholder: "grief" }
    ])
    if (!values) return back()
    const text = String(values.text ?? "").trim()
    if (!text) return back()

    const actions = search(text)
    const said = readableChat(player, searchChat(text, 150))
    const typed = searchCommands(text, 150)
    const total = actions.length + said.length + typed.length
    if (!total) { info(player, `Nothing matching "§f${text}§7".`); return back() }

    // One hit and one place to look: skip the menu and show it. Making
    // somebody tap through a chooser with a single live option is a screen
    // that exists only to be dismissed.
    const only = [
        actions.length && (() => listScreen(player, `"${text}"`, actions, back)),
        said.length && (() => chatListScreen(player, `Chat · "${text}"`, said, back)),
        typed.length && (() => commandListScreen(player, `Commands · "${text}"`, typed, back))
    ].filter(Boolean)
    if (only.length === 1) return only[0]()

    return menu(player, {
        title: hubTitle("settings", `"${text}"`),
        body: subtitle(`${total} match${total === 1 ? "" : "es"} across the three logs.`),
        buttons: [
            actions.length
                ? { text: hubEntry("settings", "Actions", `${actions.length} match${actions.length === 1 ? "" : "es"}`), run: () => listScreen(player, `"${text}"`, actions, again) }
                : null,
            said.length
                ? { text: hubEntry("chat", "Chat", `${said.length} line${said.length === 1 ? "" : "s"} said or written`), run: () => chatListScreen(player, `Chat · "${text}"`, said, again) }
                : null,
            typed.length
                ? { text: hubEntry("settings", "Commands", `${typed.length} command${typed.length === 1 ? "" : "s"}`), run: () => commandListScreen(player, `Commands · "${text}"`, typed, again) }
                : null
        ].filter(Boolean),
        back
    })
}

// -------------------------------------------------------------------- detail

async function entryScreen(player, entryId, back) {
    const entry = getEntry(entryId)
    if (!entry) { info(player, "That entry is too old and was removed from the log."); return back() }
    // Checked again here, not only in the list that led here. This screen is
    // reachable by id and it is where an UNDO lives — the one place where being
    // able to read an entry turns into being able to change what it did.
    if (!canReadEntry(player, entry)) {
        err(player, "That entry is above your rank.")
        return back()
    }

    const blocked = canUndo(entry) ? undoBlocked(player, entry) : ""
    const body = [
        `§f${entry.action}`,
        subtitle(formatDate(entry.at) + ` · ${formatDuration(Date.now() - entry.at)} ago`),
        "",
        `§fBy: §7${entry.actor?.name ?? "console"}`,
        entry.target ? `§fTo: §7${entry.target.name}` : "",
        entry.detail ? `\n§f${entry.detail}` : "",
        entry.undone ? `\n§8Undone by ${entry.undone.by}` : "",
        blocked ? `\n§8You can't undo this. ${blocked}` : ""
    ].filter(Boolean).join("\n")

    return menu(player, {
        title: hubTitle("settings", "Log entry"),
        body,
        buttons: canUndo(entry) && !blocked
            ? [{ text: "§eUndo this §8· restores what it changed", run: () => undoScreen(player, entryId, back) }]
            : [],
        back
    })
}

/**
 * The permission each kind of undo needs, and how to say it. Undoing is doing
 * the opposite, so it needs what doing needed. Before 2.8.7 it needed only
 * the logs: anyone who could read them could lift a ban or put settings back.
 */
const UNDO_NEEDS = {
    ban:      ["admin.ban", "ban players"],
    mute:     ["admin.mute", "mute players"],
    freeze:   ["admin.freeze", "freeze players"],
    tpa:      ["admin.tpatoggle", "turn a player's TPA on and off"],
    nickname: ["admin.nickname", "change display names"],
    config:   ["admin.settings", "change settings"],
    ranks:    ["ranks.grant", "give ranks"]
}

/**
 * Why `player` may not undo this entry, or "" when they may. A rank change
 * also follows the rules for giving ranks: every rank it gives back or takes
 * away must be one they could give or take themselves, and it may not raise
 * them. The whole rank list is for owners and operators only.
 */
export function undoBlocked(player, entry) {
    const undo = entry?.undo
    if (entry?.target?.id && !canActOn(player, entry.target.id)) return `${entry.target.name} outranks you.`
    if (undo?.kind === "ladder" && !canReplaceRankList(player)) return "Only an operator, or someone with the top rank and every permission, can put the whole rank list back."
    const [node, words] = UNDO_NEEDS[undo?.kind] ?? []
    if (node && !has(player, node)) return `You need permission to ${words}.`
    if (undo?.kind === "ranks") {
        const targetId = entry.target?.id
        const now = heldRankIds(targetId)
        const then = (undo.ranks ?? []).filter(id => getRank(id))
        const back = then.filter(id => !now.includes(id))
        const gone = now.filter(id => !then.includes(id))
        if (back.some(id => !canEditRank(player, getRank(id)) || nodesBeyond(player, id).length)) {
            return "It gives back a rank you can't give: one at or above yours, or with permissions you don't have."
        }
        if (gone.some(id => !canEditRank(player, getRank(id)))) return "It takes away a rank at or above yours."
        if (targetId === player.id && gainedBy(player, { held: then }).length) return "It would give you permissions you don't have."
    }
    return ""
}

async function undoScreen(player, entryId, back) {
    const entry = getEntry(entryId)
    if (!canUndo(entry)) { info(player, "That can't be undone."); return back() }

    const blocked = undoBlocked(player, entry)
    if (blocked) { err(player, `You can't undo that. ${blocked}`); return back() }

    const yes = await confirm(player, hubTitle("settings", "Undo"),
        `${describeUndo(entry)}\n\n§8The original entry stays in the log, marked as undone.`, "§eUndo it")
    if (!yes) return back()

    const applied = applyUndo(entry)
    if (!applied) { err(player, "Couldn't undo that. What it changed no longer exists."); return back() }
    markUndone(entry, player)
    ok(player, "Undone.")
    return back()
}

function describeUndo(entry) {
    switch (entry.undo?.kind) {
        case "ban": return `Lift the ban on §f${entry.target?.name}§r?`
        case "mute": return `Lift the mute on §f${entry.target?.name}§r?`
        case "freeze": return `Set §f${entry.target?.name}§r back to ${entry.undo.frozen ? "frozen" : "unfrozen"}?`
        case "tpa": return `Set §f${entry.target?.name}§r's TPA back to ${entry.undo.closed ? "closed" : "open"}?`
        case "ranks": return `Restore §f${entry.target?.name}§r to: §7${(entry.undo.ranks ?? []).join(", ") || "no ranks"}?`
        case "nickname": return entry.undo.previous
            ? `Put §f${entry.target?.name}§r's display name back to ${entry.undo.previous}§r?`
            : `Clear §f${entry.target?.name}§r's display name again?`
        case "config": return "Put every setting back to how it was before this change?"
        case "ladder": return "Put the whole rank list back to how it was before this change?"
        default: return "Undo this change?"
    }
}

/** Apply the stored PRIOR STATE — never a reverse instruction. */
export function applyUndo(entry) {
    const undo = entry.undo
    const targetId = entry.target?.id
    try {
        switch (undo?.kind) {
            case "ban": unban(targetId); return true
            case "mute": unmute(targetId); return true
            case "freeze": return setFrozenById(targetId, undo.frozen)
            case "tpa": setTpaClosed(targetId, undo.closed); return true
            case "ranks": setRanks(targetId, undo.ranks ?? [], entry.target?.name); return true
            case "nickname": setNickname(targetId, undo.previous ?? ""); return true
            case "config": replaceOverrides(undo.overrides ?? {}); return true
            case "ladder": return restoreSnapshot()
            default: return false
        }
    } catch (e) {
        console.error(`[Admin+] undo failed for ${entry.id}: ${e}`)
        return false
    }
}

function setFrozenById(targetId, frozen) {
    const target = world.getAllPlayers().find(p => p.id === targetId)
    if (!target) return false      // input permissions need a live player
    setFrozen(target, frozen)
    return true
}
