import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, err, info, formatDate, formatDuration } from "../core/util.js"
import { has, canActOn, canSeeActionsOf, setRanks, restoreSnapshot } from "../core/ranks.js"
import { allChannels, canUse } from "../core/channels.js"
import { unban, unmute, setFrozen, setTpaClosed } from "../core/moderation.js"
import { setNickname } from "../core/identity.js"
import { replaceOverrides } from "../core/settings.js"
import {
    recent, about, by, branch, search, people, getEntry,
    canUndo, markUndone, size, summarise
} from "../core/logs.js"
import {
    recentChat, chatBy, searchChat, chatLogSize, clearChatLog
} from "../core/chatlog.js"

// /admin ▸ Logs
//
//   Recent    everything, newest first
//   Players   pick someone: what was done TO them, and what THEY did
//   Filter    by branch — moderation, ranks, names, config, reports
//   Search    free text over names and details
//
// Entries that changed something reversible carry the prior state and can be
// undone from here.

const BRANCHES = [
    { id: "mod", label: "Moderation", hint: "bans, kicks, mutes, freezes" },
    { id: "rank", label: "Ranks", hint: "grants, revokes, ladder changes" },
    { id: "name", label: "Display names", hint: "nicknames set and cleared" },
    { id: "warp", label: "Warps", hint: "created and deleted" },
    { id: "report", label: "Reports", hint: "filed and handled" },
    { id: "config", label: "Config", hint: "< Code > edits and resets" },
    { id: "player", label: "Player tools", hint: "sudo" },
    { id: "sign", label: "Signs", hint: "what players wrote on them" },
    { id: "cmdblock", label: "Command blocks", hint: "placed and broken, by whom" }
]

export async function logsScreen(player, back) {
    if (!has(player, "admin.logs")) { err(player, "You can't read the logs."); return back() }
    const again = () => logsScreen(player, back)

    return menu(player, {
        title: hubTitle("settings", "Logs"),
        body: subtitle(`${size()} entries kept. Newest first.`),
        buttons: [
            { text: hubButton("settings", "Recent", "Everything, newest first"), run: () => listScreen(player, "Recent", recent(120), again) },
            { text: hubButton("chat", "Chat", `What was actually said · ${chatLogSize()} lines`), run: () => chatScreen(player, again) },
            { text: hubButton("settings", "Players", "What was done to them, and what they did"), run: () => peopleScreen(player, again) },
            { text: hubButton("settings", "Filter", "By kind of action"), run: () => filterScreen(player, again) },
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

/** One line, as it was said: name and words on one row, like chat itself. */
function chatReadLine(entry) {
    const where = entry.channel ? `§8[${entry.channel}] ` : ""
    return [`§8${clockOf(entry.at)} ${where}§f${entry.name}§7: §r${entry.text}`]
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

    return menu(player, {
        title: hubTitle("chat", "Chat log"),
        body: [
            subtitle(kept ? `${kept} lines kept.` : "Nothing recorded yet."),
            "§8Private messages are never recorded, and you only see rooms you can enter."
        ].join("\n"),
        buttons: [
            { text: hubEntry("chat", "Recent", "Everything said, newest first"), run: () => chatListScreen(player, "Recent chat", readableChat(player, recentChat(150)), again) },
            { text: hubEntry("chat", "Search", "Find a word, or everything one person said"), run: () => chatSearchScreen(player, again) },
            has(player, "admin.settings")
                ? { text: hubEntry("actions", "Clear the chat log", "Throws away every line kept"), run: () => clearChatScreen(player, again) }
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
        `Throw away all ${chatLogSize()} recorded lines?\n\n§8The action log is not touched.`,
        "§cClear")
    if (!yes) return back()
    clearChatLog()
    ok(player, "Chat log cleared.")
    return back()
}

async function peopleScreen(player, back) {
    const seen = people()
    if (!seen.length) { info(player, "The log hasn't seen anyone yet."); return back() }
    return pagedMenu(player, {
        title: hubTitle("settings", "Logs · players"),
        body: subtitle("Everyone the log has touched, either side."),
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
    return menu(player, {
        title: hubTitle("settings", person.name),
        body: [
            subtitle("What was done to them, what they did, and what they said."),
            `§fDone to them: §7${received.length}`,
            `§fThings they did: §7${did.length}`,
            `§fLines of chat: §7${said.length}`
        ].join("\n"),
        buttons: [
            { text: hubEntry("actions", "Received", "What staff did to them — the appeal view"), run: () => listScreen(player, `${person.name} · received`, received, () => personScreen(player, person, back)) },
            { text: hubEntry("ranks", "Did", "What they did as staff — the audit view"), run: () => listScreen(player, `${person.name} · did`, did, () => personScreen(player, person, back)) },
            // The third question people actually ask about somebody, and the
            // one the action log could never answer.
            said.length
                ? { text: hubEntry("chat", "Said", `${said.length} line${said.length === 1 ? "" : "s"} of chat`), run: () => chatListScreen(player, `${person.name} · said`, said, () => personScreen(player, person, back)) }
                : null
        ].filter(Boolean),
        back
    })
}

async function filterScreen(player, back) {
    return menu(player, {
        title: hubTitle("settings", "Filter"),
        body: subtitle("Pick a branch."),
        buttons: BRANCHES.map(b => ({
            text: `${b.label}§r\n§8${b.hint} · ${branch(b.id).length}`,
            run: () => listScreen(player, b.label, branch(b.id), () => filterScreen(player, back))
        })),
        back
    })
}

async function searchScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "Search logs"), [
        { id: "text", type: "text", label: "Name, action or wording", placeholder: "grief" }
    ])
    if (!values) return back()
    const results = search(values.text)
    if (!results.length) { info(player, `Nothing matching "§f${values.text}§7".`); return back() }
    return listScreen(player, `"${values.text}"`, results, back)
}

// -------------------------------------------------------------------- detail

async function entryScreen(player, entryId, back) {
    const entry = getEntry(entryId)
    if (!entry) { info(player, "That entry has aged out of the log."); return back() }
    // Checked again here, not only in the list that led here. This screen is
    // reachable by id and it is where an UNDO lives — the one place where being
    // able to read an entry turns into being able to change what it did.
    if (!canReadEntry(player, entry)) {
        err(player, "That entry is above your rank.")
        return back()
    }

    const body = [
        `§f${entry.action}`,
        subtitle(formatDate(entry.at) + ` · ${formatDuration(Date.now() - entry.at)} ago`),
        "",
        `§fBy: §7${entry.actor?.name ?? "console"}`,
        entry.target ? `§fTo: §7${entry.target.name}` : "",
        entry.detail ? `\n§f${entry.detail}` : "",
        entry.undone ? `\n§8Undone by ${entry.undone.by}` : ""
    ].filter(Boolean).join("\n")

    return menu(player, {
        title: hubTitle("settings", "Log entry"),
        body,
        buttons: canUndo(entry)
            ? [{ text: "§eUndo this §8· restores what it changed", run: () => undoScreen(player, entryId, back) }]
            : [],
        back
    })
}

async function undoScreen(player, entryId, back) {
    const entry = getEntry(entryId)
    if (!canUndo(entry)) { info(player, "That can't be undone."); return back() }

    // Undo obeys rank protection: reversing an action on someone who outranks
    // you would be a way around the ladder.
    if (entry.target?.id && !canActOn(player, entry.target.id)) {
        return err(player, `${entry.target.name} outranks you — you can't undo that.`)
    }

    const yes = await confirm(player, hubTitle("settings", "Undo"),
        `${describeUndo(entry)}\n\n§8The original entry stays in the log, marked as undone.`, "§eUndo it")
    if (!yes) return back()

    const applied = applyUndo(entry)
    if (!applied) { err(player, "Couldn't undo that — the thing it changed is gone."); return back() }
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
        case "config": return "Restore the config to what it was before this edit?"
        case "ladder": return "Restore the rank ladder from the snapshot taken before this change?"
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
