import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, err, info, formatDate, formatDuration } from "../core/util.js"
import { has, canActOn, setRanks, restoreSnapshot } from "../core/ranks.js"
import { unban, unmute, setFrozen, setTpaClosed } from "../core/moderation.js"
import { setNickname } from "../core/identity.js"
import { replaceOverrides } from "../core/settings.js"
import {
    recent, about, by, branch, search, people, getEntry,
    canUndo, markUndone, size, summarise
} from "../core/logs.js"

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
    { id: "player", label: "Player tools", hint: "sudo" }
]

export async function logsScreen(player, back) {
    if (!has(player, "admin.logs")) { err(player, "You can't read the logs."); return back() }
    const again = () => logsScreen(player, back)

    return menu(player, {
        title: hubTitle("settings", "Logs"),
        body: subtitle(`${size()} entries kept. Newest first.`),
        buttons: [
            { text: hubButton("settings", "Recent", "Everything, newest first"), run: () => listScreen(player, "Recent", recent(120), again) },
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

async function listScreen(player, title, entries, back) {
    if (!entries.length) { info(player, "Nothing logged there yet."); return back() }
    return pagedMenu(player, {
        title: hubTitle("settings", title),
        body: subtitle(`${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`),
        items: entries,
        render: entry => ({ text: line(entry) }),
        onPick: entry => entryScreen(player, entry.id, () => listScreen(player, title, entries, back)),
        back
    })
}

async function peopleScreen(player, back) {
    const seen = people()
    if (!seen.length) { info(player, "The log hasn't seen anyone yet."); return back() }
    return pagedMenu(player, {
        title: hubTitle("settings", "Logs · players"),
        body: subtitle("Everyone the log has touched, either side."),
        items: seen,
        render: person => ({ text: `§f${person.name}§r\n§8${about(person.id).length} received · ${by(person.id).length} did` }),
        onPick: person => personScreen(player, person, () => peopleScreen(player, back)),
        back
    })
}

async function personScreen(player, person, back) {
    const received = about(person.id)
    const did = by(person.id)
    return menu(player, {
        title: hubTitle("settings", person.name),
        body: [
            subtitle("Two questions, two views."),
            `§fDone to them: §7${received.length}`,
            `§fThings they did: §7${did.length}`
        ].join("\n"),
        buttons: [
            { text: hubEntry("actions", "Received", "What staff did to them — the appeal view"), run: () => listScreen(player, `${person.name} · received`, received, () => personScreen(player, person, back)) },
            { text: hubEntry("ranks", "Did", "What they did as staff — the audit view"), run: () => listScreen(player, `${person.name} · did`, did, () => personScreen(player, person, back)) }
        ],
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
