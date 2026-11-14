import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, info, formatDuration } from "../core/util.js"
import { has } from "../core/ranks.js"
import { isBeta } from "../core/channel.js"
import { tabText, pillText, logIcon } from "../core/look.js"
import { phraseFor, PHRASES } from "../core/audit.js"
import { recent, getEntry, canUndo, branch } from "../core/logs.js"
import { recentChat, recentSigns, chatLogSize, clearChatLog } from "../core/chatlog.js"
import { recentCommands, refusedCommands, commandLogSize, clearCommandLog, commandText } from "../core/cmdlog.js"
import {
    logsScreen, canReadEntry, readableLog, readableChat, groupsFor, undoBlocked, undoScreen,
    chatReadLine, commandReadLine, dayLabel, clockOf, READ_PAGE
} from "./logsUI.js"

// /admin ▸ Logs in Admin+'s own look (2.12.5, Beta). Default keeps logsUI.js
// exactly as it was.
//
// The user, 2026-11-13: "do a complete overhaul on logs and do what you think
// is honestly best, in both style and layout ... I want something distinct
// for logs too, not close to the template one".
//
// What changed, and why:
//   1. It opens on the log itself. The old screen was six doors (Actions,
//      Chat, Commands, Players, Filter, Search) before a single entry.
//   2. Three tabs, Actions, Chat and Commands, and three filters that work on
//      all of them: Player, Kind and Search. Discord's audit log works the
//      same way: the list first, the filters on top.
//   3. Actions are a timeline: a line down the left, a picture for each kind
//      of action, a marker where the day changes, and a plain sentence,
//      "Firelite banned Steve". One tap opens an entry; it used to take two.
//   4. An entry says what happened in words, never "mod.ban", and offers Undo
//      or says why not.
// The same reading rules as before: you only see what you could have been
// told (canReadEntry, readableChat in logsUI.js).

/** Open Logs: the timeline in Admin+'s own look, the old screens on Default. */
export function openLogs(player, back) {
    return isBeta() ? logbookScreen(player, back) : logsScreen(player, back)
}

const TABS = [
    { id: "actions", label: "Actions" },
    { id: "chat", label: "Chat" },
    { id: "commands", label: "Commands" }
]

/** Entries on one page of the Actions timeline. */
const PAGE = 10

/** The picture for each kind of action, from tools/genlook.py (log_<key>). */
const KIND_ICON = {
    moderation: "moderation", chatmod: "chatmod", people: "people", stafftools: "staff",
    server: "server", reports: "reports", land: "land", oldsigns: "signs", blocks: "blocks"
}

/** Kinds a tab can be narrowed to. Actions use the log's own groups. */
function kindsFor(tab) {
    if (tab === "chat") return [{ id: "signs", label: "Signs only", hint: "what was written on signs" }]
    if (tab === "commands") return [
        { id: "refused", label: "Refused", hint: "no permission, or nobody matched" },
        { id: "blocks", label: "Command blocks", hint: "placed or broken, who and where" }
    ]
    return groupsFor()
}

const inGroup = (entry, group) => group.prefixes.some(p => entry.action === p || entry.action.startsWith(`${p}.`))

/** Which kind an action belongs to, for its picture. */
export function kindOfEntry(entry) {
    if (String(entry?.action).startsWith("cmdblock")) return "blocks"
    return groupsFor().find(group => inGroup(entry, group))?.id ?? "server"
}

// ------------------------------------------------------------- the sentence
//
// One sentence per entry, the way a person would say it: "Firelite banned
// Steve". Actions with a person on the receiving end reuse the staff
// announcement's words (core/audit.js PHRASES), so the log and the chat line
// say the same thing. Everything else has its own words here. A test checks
// that every action the pack writes has a sentence, so the plain fallback
// "made a change" never shows for a known one.

const LOG_PHRASES = {
    "mod.tpTo": t => `went to ${t}`,
    "mod.invsee.take": t => `took an item from ${t}'s inventory`,
    "mod.invsee.destroy": t => `deleted an item from ${t}'s inventory`,
    "mod.enderchest.take": t => `took an item from ${t}'s ender chest`,
    "admin.knockback": t => t ? `hit ${t} with the Knockback stick` : "used the Knockback stick",
    "admin.items": () => "took an admin item",
    "admin.staffmode": (_t, d) => d.startsWith("on") ? "turned on staff mode" : "turned off staff mode",
    "admin.vanish": () => "vanished",
    "admin.unvanish": () => "came back from vanish",
    "admin.lagclear": () => "cleared lag",
    "admin.clearchat": () => "cleared the chat",
    "admin.guestOn": () => "turned on the guest list",
    "admin.guestOff": () => "turned off the guest list",
    "admin.guestAdd": () => "added a player to the guest list",
    "admin.guestRemove": () => "took a player off the guest list",
    "admin.maintenanceOn": () => "turned on maintenance mode",
    "admin.maintenanceOff": () => "turned off maintenance mode",
    "automation.save": () => "saved an automation",
    "automation.delete": () => "deleted an automation",
    "automation.rename": () => "renamed an automation",
    "automation.on": () => "turned an automation on",
    "automation.off": () => "turned an automation off",
    "automation.error": () => "stopped after 3 problems in a row",
    "automod.spam": (t, d) => d.startsWith("muted") ? `muted ${t} for spam` : `warned ${t} for spam`,
    "automod.ore": t => `flagged ${t} for mining ore`,
    "automod.breaks": t => `flagged ${t} for breaking blocks fast`,
    "automod.config": () => "changed automod settings",
    "chat.approve": t => `let a held message from ${t} through`,
    "chat.deny": t => `blocked a held message from ${t}`,
    "chat.denyAll": () => "blocked every held message",
    "chat.broadcast": () => "sent a broadcast",
    "chat.mute": () => "muted a chat room",
    "chat.unmute": () => "unmuted a chat room",
    "claim.created": () => "claimed land",
    "claim.removed": () => "gave up land",
    "cmdblock.placed": () => "placed a command block",
    "cmdblock.broken": () => "broke a command block",
    "config.edit": () => "changed settings",
    "config.preset": () => "applied a saved setup",
    "config.presetSave": () => "saved a setup",
    "config.reset": () => "factory reset Admin+",
    "config.serverPreset": () => "applied a server preset",
    "creator.console": () => "ran a command from the console",
    "dev.mode": (_t, d) => d === "developer" ? "turned on developer mode" : "turned off developer mode",
    "hologram.create": () => "made floating text",
    "hologram.edit": () => "changed floating text",
    "hologram.delete": () => "deleted floating text",
    "hologram.move": () => "moved floating text",
    "hologram.clear": () => "cleared all floating text",
    "omni.spawnArea": () => "made spawn an area",
    "omni.spawnDelete": () => "deleted the spawn area",
    "omni.spawnOn": () => "turned on spawn as an area",
    "omni.spawnPoint": () => "set the spawn point",
    "rank.delete": () => "deleted a rank",
    "rank.preset": () => "applied a ready-made rank list",
    "report.filed": t => t ? `reported ${t}` : "filed a report",
    "report.handled": t => t ? `handled a report about ${t}` : "handled a report",
    "warp.create": () => "made a warp",
    "warp.delete": () => "deleted a warp",
    "warp.move": () => "moved a warp",
    "warp.access": () => "changed who can use a warp",
    "warp.spawnSet": () => "moved spawn",
    "warp.spawnEdit": () => "changed spawn"
}

/** Sentences whose words already hold the detail, so it isn't said twice. */
const DETAIL_IN_SENTENCE = new Set(["rank.grant", "rank.revoke", "rank.set", "mod.gamemode", "name.set", "name.clear", "automation.rank", "dev.mode"])

const plain = s => String(s ?? "").replace(/§./g, "")
const lowerFirst = s => s ? s[0].toLowerCase() + s.slice(1) : s

/** Who did it, in words. The log stores "console" for the server itself. */
export function actorOf(entry) {
    const name = entry?.actor?.name
    if (name && name !== "console") return name
    return String(entry?.action).startsWith("automod.") ? "Automod" : "The server"
}

/** What they did, starting lower-case so it follows the name: "banned Steve". */
export function phraseOf(entry) {
    const target = entry?.target?.name ?? ""
    const detail = String(entry?.detail ?? "")
    const self = !!(entry?.actor?.id && entry.actor.id === entry?.target?.id)
    const own = LOG_PHRASES[entry?.action]
    if (own) return own(target, detail, self)
    if (PHRASES[entry?.action] && target) {
        return lowerFirst(phraseFor(entry.action, target, detail, self, entry.undo?.previous))
    }
    if (String(entry?.action).startsWith("sign.")) return "wrote on a sign"
    return "made a change"
}

/** The whole sentence, coloured for a row: the name stands out. */
export function sentenceOf(entry) {
    return `§f§l${actorOf(entry)}§r §f${plain(phraseOf(entry))}`
}

/** The second line of a row: when, the detail, and whether it can be undone. */
export function noteOf(entry) {
    const parts = [clockOf(entry.at)]
    const detail = plain(entry.detail).trim()
    if (detail && !DETAIL_IN_SENTENCE.has(entry.action)) parts.push(detail.length > 48 ? `${detail.slice(0, 47)}…` : detail)
    if (entry.undone) parts.push("undone")
    else if (canUndo(entry)) parts.push("can be undone")
    return `§8${parts.join(" · ")}`
}

// ------------------------------------------------------------- filtering

const NOBODY = { id: undefined, name: "Anyone" }

function matchesAction(entry, text) {
    const needle = text.toLowerCase()
    return [actorOf(entry), entry.target?.name, entry.detail, plain(phraseOf(entry))]
        .some(field => String(field ?? "").toLowerCase().includes(needle))
}

/** The action entries this person may see, narrowed by the filters. Newest first. */
export function actionsFor(player, state) {
    let list = readableLog(player, recent(1000))
    if (state.kind) {
        const group = groupsFor().find(g => g.id === state.kind)
        if (group) list = list.filter(entry => inGroup(entry, group))
    }
    if (state.player?.id) list = list.filter(e => e.actor?.id === state.player.id || e.target?.id === state.player.id)
    if (state.text) list = list.filter(e => matchesAction(e, state.text))
    return list
}

/** Chat and sign lines this person may read, narrowed by the filters. */
export function chatFor(player, state) {
    let list = readableChat(player, state.kind === "signs" ? recentSigns(300) : recentChat(300))
    if (state.player?.id) list = list.filter(line => line.who === state.player.id)
    if (state.text) {
        const needle = state.text.toLowerCase()
        list = list.filter(line => [line.text, line.name, line.was].some(f => String(f ?? "").toLowerCase().includes(needle)))
    }
    return list
}

/** Commands, narrowed by the filters. Command blocks are action entries. */
export function commandsFor(player, state) {
    if (state.kind === "blocks") {
        let blocks = readableLog(player, branch("cmdblock"))
        if (state.player?.id) blocks = blocks.filter(e => e.actor?.id === state.player.id)
        if (state.text) blocks = blocks.filter(e => matchesAction(e, state.text))
        return blocks
    }
    let list = state.kind === "refused" ? refusedCommands(300) : recentCommands(300)
    if (state.player?.id) list = list.filter(line => line.who === state.player.id)
    if (state.text) {
        const needle = state.text.toLowerCase()
        list = list.filter(line => [commandText(line), line.name, line.ran].some(f => String(f ?? "").toLowerCase().includes(needle)))
    }
    return list
}

/** What a tab holds under the filters. Kinds belong to one tab only. */
function listFor(player, state, tab) {
    const own = { ...state, kind: tab === state.tab ? state.kind : undefined }
    if (tab === "chat") return chatFor(player, own)
    if (tab === "commands") return commandsFor(player, own)
    return actionsFor(player, own)
}

/** Everyone in any of the three logs that this person may read, by name. */
function peopleEverywhere(player) {
    const seen = new Map()
    const add = (id, name) => { if (id && name && !seen.has(id)) seen.set(id, { id, name }) }
    for (const entry of readableLog(player, recent(1000))) { add(entry.actor?.id, entry.actor?.name); add(entry.target?.id, entry.target?.name) }
    for (const line of readableChat(player, recentChat(300))) add(line.who, line.name)
    for (const line of recentCommands(300)) add(line.who, line.name)
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ------------------------------------------------------------- the screen

/** Rows for action entries: a day marker where the day changes, then each entry. */
function timelineRows(player, entries, state, back) {
    const rows = []
    let lastDay
    for (const entry of entries) {
        const day = dayLabel(entry.at)
        if (day !== lastDay) { rows.push({ label: day }); lastDay = day }
        rows.push({
            text: `${sentenceOf(entry)}\n${noteOf(entry)}`,
            icon: logIcon(KIND_ICON[kindOfEntry(entry)] ?? "server"),
            run: () => entryScreen(player, entry.id, back)
        })
    }
    return rows
}

/** Chat or commands as reading text, grouped by day. */
function readingBody(lines, renderOne, page, pages, total) {
    const body = []
    let lastDay
    for (const line of lines) {
        const day = dayLabel(line.at)
        if (day !== lastDay) {
            if (body.length) body.push("")
            body.push(`§b${day}`)
            lastDay = day
        }
        body.push(...renderOne(line))
    }
    if (pages > 1) body.push("", `§8Page ${page + 1} of ${pages} · ${total} in all`)
    return body.join("\n")
}

/**
 * The Logs: tabs, filter pills, then the open tab's entries. `state` holds the
 * open tab, the filters and the page, and every button makes a new state.
 */
export async function logbookScreen(player, back, state = { tab: "actions" }) {
    if (!has(player, "admin.logs")) { info(player, "You can't read the logs."); return back?.() }
    const again = next => logbookScreen(player, back, { ...state, ...next })
    const here = () => logbookScreen(player, back, state)
    const tab = state.tab ?? "actions"
    const page = state.page ?? 0
    const kinds = kindsFor(tab)
    const kind = kinds.find(k => k.id === state.kind)

    const buttons = TABS.map(t => ({
        text: tabText(`${t.label} · ${listFor(player, state, t.id).length}`, t.id === tab),
        run: () => again({ tab: t.id, kind: undefined, page: 0 })
    }))
    buttons.push(
        { text: pillText(`Player · ${state.player?.name ?? "anyone"}`, !!state.player), run: () => playerPicker(player, state, back) },
        { text: pillText(`Kind · ${kind?.label ?? "all"}`, !!kind), run: () => kindPicker(player, state, back) },
        { text: pillText(state.text ? `Search · ${state.text}` : "Search", !!state.text), run: () => searchBox(player, state, back) }
    )

    const list = listFor(player, state, tab)
    const timeline = tab === "actions" || (tab === "commands" && state.kind === "blocks")
    const size = timeline ? PAGE : READ_PAGE
    const pages = Math.max(1, Math.ceil(list.length / size))
    const at = Math.min(page, pages - 1)
    const slice = list.slice(at * size, (at + 1) * size)
    const filtered = !!(state.player || state.kind || state.text)

    let body
    if (!list.length) body = filtered ? "§7Nothing matches these filters." : "§7Nothing logged here yet."
    else if (timeline) body = `§7${at * size + 1} to ${at * size + slice.length} of ${list.length}, newest first`
    else body = readingBody(slice, tab === "chat" ? chatReadLine : commandReadLine, at, pages, list.length)

    if (timeline) buttons.push(...timelineRows(player, slice, state, here))
    if (at > 0) buttons.push({ text: "§fNewer\n§8Back up the list", icon: logIcon("newer"), run: () => again({ page: at - 1 }) })
    if (at < pages - 1) buttons.push({ text: "§fOlder\n§8Further down the list", icon: logIcon("older"), run: () => again({ page: at + 1 }) })
    if (tab === "chat" && has(player, "admin.settings") && chatLogSize()) {
        buttons.push({ text: "§cClear the chat log\n§8Deletes every saved line", icon: logIcon("clear"), run: () => clearScreen(player, "chat", here) })
    }
    if (tab === "commands" && has(player, "admin.settings") && commandLogSize()) {
        buttons.push({ text: "§cClear the command log\n§8Deletes every saved command", icon: logIcon("clear"), run: () => clearScreen(player, "commands", here) })
    }

    return menu(player, { title: hubTitle("settings", "Logs"), body, buttons, back, layout: "logs" })
}

/** Player: anyone, or one person across all three tabs. */
async function playerPicker(player, state, back) {
    const people = peopleEverywhere(player)
    const home = () => logbookScreen(player, back, state)
    return pagedMenu(player, {
        title: hubTitle("settings", "Logs · player"),
        body: subtitle("Pick a player to see what they did, what was done to them, and what they said and typed."),
        items: [NOBODY, ...people],
        render: person => person === NOBODY
            ? { text: "§fAnyone\n§8Show everybody" }
            : { text: `§f${person.name}${state.player?.id === person.id ? " §b· showing" : ""}` },
        onPick: person => logbookScreen(player, back, { ...state, player: person === NOBODY ? undefined : person, page: 0 }),
        back: home
    })
}

/** Kind: what the open tab can be narrowed to. */
async function kindPicker(player, state, back) {
    const tab = state.tab ?? "actions"
    const home = () => logbookScreen(player, back, state)
    const pick = id => logbookScreen(player, back, { ...state, kind: id, page: 0 })
    return menu(player, {
        title: hubTitle("settings", "Logs · kind"),
        body: subtitle(`Narrow ${TABS.find(t => t.id === tab).label.toLowerCase()} to one kind.`),
        buttons: [
            { text: `§fAll${state.kind ? "" : " §b· showing"}\n§8Every kind`, run: () => pick(undefined) },
            ...kindsFor(tab).map(k => ({
                text: `§f${k.label}${state.kind === k.id ? " §b· showing" : ""} §8· ${listFor(player, { ...state, kind: k.id }, tab).length}\n§8${k.hint}`,
                icon: tab === "actions" || k.id === "blocks" ? logIcon(KIND_ICON[k.id] ?? "server") : undefined,
                run: () => pick(k.id)
            }))
        ],
        back: home
    })
}

/** Search: a word, a name, or part of a sentence. Empty clears it. */
async function searchBox(player, state, back) {
    const values = await modal(player, hubTitle("settings", "Search the logs"), [
        { id: "text", type: "text", label: "A name, a word, or part of what happened\n§8Leave it empty to stop searching.", placeholder: "Example: grief", default: state.text ?? "" }
    ], { submit: "Search" })
    if (!values) return logbookScreen(player, back, state)
    const text = String(values.text ?? "").trim()
    return logbookScreen(player, back, { ...state, text: text || undefined, page: 0 })
}

async function clearScreen(player, which, back) {
    const chat = which === "chat"
    const count = chat ? chatLogSize() : commandLogSize()
    const yes = await confirm(player, hubTitle("settings", chat ? "Clear the chat log" : "Clear the command log"),
        `Delete all ${count} saved ${chat ? "lines" : "commands"}?\n\n§8The other logs are not touched.`, "§cClear")
    if (!yes) return back()
    if (chat) clearChatLog(); else clearCommandLog()
    ok(player, chat ? "Chat log cleared." : "Command log cleared.")
    return back()
}

// ------------------------------------------------------------- one entry

/** Whether it can be undone, in words. */
function undoLine(player, entry) {
    if (entry.undone) return `§7Undo: §fundone by ${entry.undone.by}`
    if (!canUndo(entry)) return "§7Undo: §fnot something that can be undone"
    const blocked = undoBlocked(player, entry)
    return blocked ? `§7Undo: §fnot for you. ${blocked}` : "§7Undo: §fyes, below"
}

/**
 * One entry: the sentence, when, the kind and the details, then Undo (or why
 * not) and a way to see everything about the people in it.
 */
export async function entryScreen(player, entryId, back) {
    const entry = getEntry(entryId)
    if (!entry) { info(player, "That entry is too old and was removed from the log."); return back() }
    // Checked again here: this screen is where an undo lives.
    if (!canReadEntry(player, entry)) { info(player, "That entry is above your rank."); return back() }

    const group = groupsFor().find(g => inGroup(entry, g))
    const kindLabel = kindOfEntry(entry) === "blocks" ? "Command blocks" : group?.label ?? "Server"
    const detail = plain(entry.detail).trim()
    const body = [
        sentenceOf(entry),
        `§8${dayLabel(entry.at)} at ${clockOf(entry.at)} · ${formatDuration(Date.now() - entry.at)} ago`,
        "",
        `§7Kind: §f${kindLabel}`,
        detail ? `§7Details: §f${detail}` : "",
        undoLine(player, entry)
    ].filter(Boolean).join("\n")

    const buttons = []
    if (canUndo(entry) && !undoBlocked(player, entry)) {
        buttons.push({ text: "§eUndo it\n§8Put back what it changed", icon: logIcon("undo"), run: () => undoScreen(player, entryId, back) })
    }
    const about = person => ({
        text: `§fEverything about ${person.name}\n§8What they did, said and typed, and what was done to them`,
        icon: logIcon("search"),
        run: () => logbookScreen(player, back, { tab: "actions", player: { id: person.id, name: person.name } })
    })
    if (entry.target?.id) buttons.push(about(entry.target))
    if (entry.actor?.id && entry.actor.id !== entry.target?.id) buttons.push(about(entry.actor))

    return menu(player, { title: hubTitle("settings", "Log entry"), body, buttons, back, layout: "logs" })
}
