import { world, system } from "@minecraft/server"
import { Table } from "../core/storage.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { setting, setSetting, resetSetting, overrides } from "../core/settings.js"
import { record } from "../core/logs.js"
import { menu, modal, subtitle, INCOMPLETE } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { guardIcon } from "../core/look.js"
import { adminplusDisabled } from "../core/terms.js"
import { kick, ban } from "../core/moderation.js"
import { alertStaff } from "./automod.js"
import {
    noteJoin, noteSpawn, noteChat, noteLeave, joined, scoreOf, decide,
    botsOn, alertsOn, botAction, actAt, botLevel, levelForSeconds, LEVELS, SCORE_STEPS
} from "../core/botcheck.js"

// Bot Guard, the half that touches the game (3.0.1 as bot detection, named
// Bot Guard in 3.0.3; core/botcheck.js is the thinking). It listens for
// joins, first spawns, chat and leaving; every 10 seconds it scores who
// joined but never entered; it keeps the possible-bot list; it tells staff
// once per step; and at the limit it kicks or bans, when the server chose
// that. Kicks and bans go by NAME (the server route in core/moderation.js),
// because a bot that never spawned has no player object to act on. Each flag
// and action also goes in the content log, so a playtest log shows it.

const list = new Table("possibleBots", {})
/** Who an automatic action is written down as. It speaks as itself. */
const BOT_GUARD = { id: "automod", name: "Bot Guard" }
const CHECK_TICKS = 200
/** Ids acted on this session, so a slow kick isn't sent twice. */
const acted = new Set()

/** What /automod ▸ Bot Guard edits: each setting's home (tests/settingspages). */
export const BOT_FIELDS = [
    { key: "automod.bots", kind: "toggle", label: "Bot Guard" },
    { key: "automod.botLevel", kind: "dropdown", label: "Level" },
    { key: "automod.botAlerts", kind: "toggle", label: "Alerts" },
    { key: "automod.botAction", kind: "dropdown", label: "At the limit" },
    { key: "automod.botActAt", kind: "slider", label: "The limit (%)", min: 50, max: 100, step: 5 }
]
const ACTIONS = [
    { id: "none", label: "No action (just flag)", word: "flag only" },
    { id: "kick", label: "Kick", word: "kick" },
    { id: "ban", label: "Ban", word: "ban" }
]
/** Bot Guard's alerts go through here, so the Alerts switch covers every one. */
function tell(text) { if (alertsOn()) alertStaff(text) }

/**
 * 3.0.1 and 3.0.2 stored a wait in seconds (`automod.botGrace`); 3.0.3 stores a
 * level. Moved over once, from the check loop, because it writes.
 */
let carriedOver = false
function carryOverOldWait() {
    if (carriedOver) return
    carriedOver = true
    const stored = overrides()
    if (stored["automod.botGrace"] === undefined) return
    if (stored["automod.botLevel"] === undefined) setSetting("automod.botLevel", levelForSeconds(stored["automod.botGrace"]))
    resetSetting("automod.botGrace")
}

export function actionWord() { return ACTIONS.find(a => a.id === botAction())?.word ?? "flag only" }

// ----------------------------------------------------------------- the list

function readList() { return { ...(list.get("all") ?? {}) } }
function writeList(entries) {
    try { list.set("all", entries) } catch (e) { console.warn(`[Admin+] Bot Guard: couldn't save the list: ${e}`) }
}

/** Highest score first, then the newest. */
export function possibleBots() {
    return Object.values(readList()).sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen)
}

/**
 * Score everyone who joined but hasn't entered, put them on the list, tell
 * staff when someone appears or climbs, and act at the limit.
 * @returns the entries staff were told about this time
 */
export function checkBots(now = Date.now()) {
    carryOverOldWait()
    if (adminplusDisabled()) return []
    if (!botsOn()) return []
    const entries = readList()
    const told = []
    let changed = false
    for (const r of joined()) {
        const { score, reasons } = scoreOf(r, now)
        if (!score) continue
        const key = r.name.toLowerCase()
        const before = entries[key]
        const entry = {
            key, id: r.id, name: r.name, score, reasons,
            firstFlagged: before?.firstFlagged ?? now, lastSeen: now, action: before?.action ?? ""
        }
        entries[key] = entry
        changed = true
        if (!before || before.score < score) {
            tell(`§fBot Guard§7 flagged §f${r.name}§7: §f${score}%§7 likely a bot (${reasons.join(", ")}). §8/automod to look.`)
            console.log(`[Admin+] Bot Guard: flagged ${r.name}, ${score}% (${reasons.join(", ")})`)
            told.push(entry)
        }
        const action = decide(score)
        if (action !== "none" && !acted.has(r.id)) {
            acted.add(r.id)
            act(entry, action, BOT_GUARD)
        }
    }
    if (changed) writeList(entries)
    return told
}

/** Kick or ban by name, write it down, and say what happened. */
export async function act(entry, action, by) {
    const target = { id: entry.id, name: entry.name }
    const reason = "Removed by Bot Guard: this account joined but never entered the world, which is what bots do."
    let done
    if (action === "ban") done = (await ban(target, 0, reason, by))?.ok === true
    else done = await kick(target, reason)
    const word = action === "ban" ? "banned" : done ? "kicked" : "kick failed"
    const entries = readList()
    if (entries[entry.key]) { entries[entry.key].action = word; writeList(entries) }
    const who = by?.id === BOT_GUARD.id ? BOT_GUARD.name : by?.name ?? "Staff"
    tell(`§f${who}§7 ${word === "kick failed" ? `couldn't kick §f${entry.name}§7` : `${word} §f${entry.name}§7`} (§f${entry.score}%§7 likely a bot).`)
    console.log(`[Admin+] Bot Guard: ${who} ${word === "kick failed" ? "couldn't kick" : word} ${entry.name} (${entry.score}%)`)
    record(by?.id === BOT_GUARD.id ? undefined : by, "automod.bot", target, `${word} · ${entry.score}%`)
    return done
}

/** They entered the world: whatever the list said, they aren't this kind of bot. */
function clearEntered(player) {
    const entries = readList()
    const key = String(player?.name ?? "").toLowerCase()
    const entry = entries[key]
    if (!entry || entry.action) return
    delete entries[key]
    writeList(entries)
    tell(`§f${player.name}§7 entered the world, so they're off Detected Bots.`)
}

export function installBotDetection() {
    const after = world.afterEvents
    after?.playerJoin?.subscribe?.(({ playerId, playerName }) => {
        try { noteJoin(playerId, playerName) } catch { /* next join */ }
    })
    after?.playerSpawn?.subscribe?.(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        try { noteSpawn(player.id); clearEntered(player) } catch { /* gone */ }
    })
    after?.chatSend?.subscribe?.(({ sender, message }) => {
        try { noteChat(sender?.id, message) } catch { /* gone */ }
    })
    after?.playerLeave?.subscribe?.(({ playerId }) => {
        try { noteLeave(playerId); acted.delete(playerId) } catch { /* gone */ }
    })
    system.runInterval(() => {
        try { checkBots() } catch (e) { console.warn(`[Admin+] Bot Guard: ${e}`) }
    }, CHECK_TICKS)
    console.log("[Admin+] Bot Guard ready")
    return true
}

// ---------------------------------------------------------------- screens

/** The Automod hub's line under Bot Guard. */
export function botGuardSummary() {
    const detected = possibleBots().length
    const count = detected ? ` · ${detected} detected` : ""
    return botsOn()
        ? `§aon§8 · ${botLevel().label} · at ${actAt()}%: ${actionWord()}${alertsOn() ? "" : " · alerts off"}${count}`
        : `§coff§8 · catches half-joined bots${count}`
}

/**
 * What Bot Guard's banner says (3.1.5): its name, then the level and what
 * happens at the limit, or that it is off. Three short lines, so the first
 * clears the WATCHING pill in the banner's corner.
 */
export function botGuardStatus() {
    if (!botsOn()) return "§f§lBot Guard§r\n§7Off. Turn it on in Bot Moderation to catch accounts that join but never enter."
    const level = botLevel()
    return [
        "§f§lBot Guard§r",
        `§7Level §f${level.label}§7: §f${level.wait}§7 to enter`,
        `§7At §f${actAt()}%§7: §f${actionWord()}§7 · alerts §f${alertsOn() ? "on" : "off"}`
    ].join("\n")
}

/**
 * /automod ▸ Bot Guard (3.1.4): its two pages, the user's names, "Bot
 * Moderation" and "Detected Bots". Since 3.1.5 it has its own frame in
 * Admin+'s menus (core/look.js GUARD): the shield and this status in a
 * banner, lit and moving while Bot Guard is on, and the two pages as cards.
 */
export async function botGuardScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back?.() }
    const again = () => botGuardScreen(player, back)
    const detected = possibleBots().length
    return menu(player, {
        title: hubTitle("settings", "Bot Guard"),
        body: botGuardStatus(),
        layout: "guard",
        watching: botsOn(),
        buttons: [
            {
                text: hubEntry("settings", "Bot Moderation", botsOn() ? `§aon§8 · ${botLevel().label} · at ${actAt()}%: ${actionWord()}` : "§coff§8 · the level, alerts, and what happens at the limit"),
                card: { text: "§f§lBot Moderation§r\n§7Level, alerts and the limit", icon: guardIcon("moderation") },
                run: () => botSettingsScreen(player, again)
            },
            {
                text: hubEntry("settings", `Detected Bots (${detected})`, detected ? "Look at each one: kick, ban, or clear" : "None right now"),
                card: { text: `§f§lDetected Bots§r\n${detected ? `§f${detected}§7 to look at: kick, ban or clear` : "§7None right now"}`, icon: guardIcon("detected") },
                run: () => botListScreen(player, again)
            }
        ],
        back
    })
}

/** /automod ▸ Bot Guard ▸ Bot Moderation: the switch, the level, alerts, what to do at the limit, the limit. */
export async function botSettingsScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back?.() }
    const s = SCORE_STEPS
    const level = botLevel()
    const values = await modal(player, hubTitle("settings", "Bot Moderation"), [
        { type: "label", label: `§7Bot Guard catches half-joined accounts: they join but never enter the world, which is how ad bots usually show up.\n§7The level is how long a new join has to enter: ${LEVELS.map(l => `${l.label} §f${l.wait}§7`).join(", ")}. Use Low on a slow server where players take a while to load in. §8Max, almost instant, is in progress.\n§7Then each account gets a score: never entered after the wait §f${s.stuck}%§7, still not after two and a half waits §f+${s.longer}§7, chatted without entering §f+${s.chat}§7, posted a link §f+${s.link}§7, a name like Xbox's made-up ones §f+${s.name}§7. Alerts sends each one to staff. Flagged accounts go on the list either way.` },
        { id: "on", type: "toggle", label: "Bot Guard", default: botsOn() },
        { id: "level", type: "dropdown", label: "Level", options: LEVELS.map(l => `${l.label}: ${l.wait}`), default: Math.max(0, LEVELS.findIndex(l => l.id === level.id)) },
        { id: "alerts", type: "toggle", label: "Alerts", default: alertsOn() },
        { id: "action", type: "dropdown", label: "At the limit", options: ACTIONS.map(a => a.label), default: Math.max(0, ACTIONS.findIndex(a => a.id === botAction())) },
        { id: "at", type: "slider", label: "The limit (%)", min: 50, max: 100, step: 5, default: actAt() }
    ], { strict: true, submit: "Save" })
    if (!values) return back?.()
    if (values === INCOMPLETE) {
        err(player, "Not every setting came back from the game, so nothing was saved. Try again.")
        return back?.()
    }
    const previous = overrides()
    const changed = []
    const set = (key, next, words) => {
        if (String(setting(key)) === next) return
        setSetting(key, next)
        changed.push(words)
    }
    if (values.on !== undefined) set("automod.bots", values.on ? "true" : "false", `Bot Guard ${values.on ? "on" : "off"}`)
    // The level is compared with the one in force, so a world still on the old
    // wait isn't rewritten by a Save that left the level alone.
    if (values.level !== undefined && LEVELS[values.level] && LEVELS[values.level].id !== level.id) {
        setSetting("automod.botLevel", LEVELS[values.level].id)
        changed.push(`level ${LEVELS[values.level].label.toLowerCase()} (${LEVELS[values.level].wait})`)
    }
    if (values.alerts !== undefined) set("automod.botAlerts", values.alerts ? "true" : "false", `alerts ${values.alerts ? "on" : "off"}`)
    if (values.action !== undefined && ACTIONS[values.action]) set("automod.botAction", ACTIONS[values.action].id, `at the limit: ${ACTIONS[values.action].word}`)
    if (values.at !== undefined) set("automod.botActAt", String(values.at), `limit ${values.at}%`)
    if (!changed.length) { info(player, "§7Nothing changed."); return back?.() }
    record(player, "automod.config", undefined, changed.join(" · "), { kind: "config", overrides: previous })
    ok(player, `Bot Guard: §r${changed.join("§a, §r")}§a.`)
    return back?.()
}

/** /automod ▸ Bot Guard ▸ Detected Bots. */
export async function botListScreen(player, back) {
    const again = () => botListScreen(player, back)
    const bots = possibleBots()
    return menu(player, {
        title: hubTitle("settings", "Detected Bots"),
        body: subtitle(bots.length
            ? "Half-joined accounts: they joined but never entered the world. Highest score first."
            : "Nobody right now. Half-joined accounts, which join but never\nenter the world, show up here."),
        buttons: bots.map(b => ({
            text: `§f${b.name} §8· §f${b.score}%§r\n§8${b.action || b.reasons[0] || ""}`,
            run: () => botEntryScreen(player, b.key, again)
        })),
        back
    })
}

async function botEntryScreen(player, key, back) {
    const entry = readList()[key]
    if (!entry) { info(player, "§7That account is no longer on the list."); return back() }
    const connected = joined().some(r => r.id === entry.id)
    const minutes = Math.max(1, Math.round((Date.now() - entry.firstFlagged) / 60000))
    return menu(player, {
        title: hubTitle("settings", entry.name),
        body: subtitle([
            `§f${entry.score}%§7 likely a bot:`,
            ...entry.reasons.map(r => `§7· ${r}`),
            `§7First flagged ${minutes} min ago. ${connected ? "Still connected." : "Not connected now."}`,
            entry.action ? `§7Done: §f${entry.action}§7.` : null
        ].filter(Boolean).join("\n")),
        buttons: [
            connected && has(player, "admin.kick")
                ? { text: "§cKick§r\n§8Removes them now; they can come back", run: async () => { await act(entry, "kick", player); return back() } }
                : null,
            has(player, "admin.ban")
                ? { text: "§4Ban§r\n§8Removes them, and every time they join", run: async () => { await act(entry, "ban", player); return back() } }
                : null,
            {
                text: "§aNot a bot§r\n§8Take them off the list",
                run: () => {
                    const entries = readList()
                    delete entries[key]
                    writeList(entries)
                    ok(player, `§f${entry.name}§a is off Detected Bots.`)
                    record(player, "automod.bot", { id: entry.id, name: entry.name }, "cleared")
                    return back()
                }
            }
        ].filter(Boolean),
        back
    })
}
