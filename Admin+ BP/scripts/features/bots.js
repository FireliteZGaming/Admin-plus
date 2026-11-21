import { world, system } from "@minecraft/server"
import { Table } from "../core/storage.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { setting, setSetting, overrides } from "../core/settings.js"
import { record } from "../core/logs.js"
import { menu, modal, subtitle, INCOMPLETE } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { kick, ban } from "../core/moderation.js"
import { alertStaff } from "./automod.js"
import {
    noteJoin, noteSpawn, noteChat, noteLeave, joined, scoreOf, decide,
    botsOn, alertsOn, botAction, actAt, graceSeconds, SCORE_STEPS
} from "../core/botcheck.js"

// Bot detection, the half that touches the game (3.0.1; core/botcheck.js is
// the thinking). It listens for joins, first spawns, chat and leaving; every
// 10 seconds it scores who joined but never entered; it keeps the
// possible-bot list; it tells staff once per step; and at the limit it kicks
// or bans, when the server chose that. Kicks and bans go by NAME (the server
// route in core/moderation.js), because a bot that never spawned has no
// player object to act on.

const list = new Table("possibleBots", {})
/** Who an automatic action is written down as. Automod speaks as itself. */
const AUTOMOD = { id: "automod", name: "Automod" }
const CHECK_TICKS = 200
/** Ids acted on this session, so a slow kick isn't sent twice. */
const acted = new Set()

/** What /automod ▸ Bot detection edits: each setting's home (tests/settingspages). */
export const BOT_FIELDS = [
    { key: "automod.bots", kind: "toggle", label: "Bot detection" },
    { key: "automod.botAlerts", kind: "toggle", label: "Alert staff" },
    { key: "automod.botAction", kind: "dropdown", label: "At the limit" },
    { key: "automod.botActAt", kind: "slider", label: "The limit (%)", min: 50, max: 100, step: 5 },
    { key: "automod.botGrace", kind: "slider", label: "Wait before judging a new player (seconds)", min: 60, max: 600, step: 30 }
]
const ACTIONS = [
    { id: "none", label: "No action (just flag)", word: "flag only" },
    { id: "kick", label: "Kick", word: "kick" },
    { id: "ban", label: "Ban", word: "ban" }
]
/** Bot detection's alerts go through here, so the Alert staff switch covers every one. */
function tell(text) { if (alertsOn()) alertStaff(text) }

export function actionWord() { return ACTIONS.find(a => a.id === botAction())?.word ?? "flag only" }

// ----------------------------------------------------------------- the list

function readList() { return { ...(list.get("all") ?? {}) } }
function writeList(entries) {
    try { list.set("all", entries) } catch (e) { console.warn(`[Admin+] bot detection: couldn't save the list: ${e}`) }
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
            tell(`§fPossible bot: ${r.name}§7, §f${score}%§7 (${reasons.join(", ")}). §8/automod to look.`)
            told.push(entry)
        }
        const action = decide(score)
        if (action !== "none" && !acted.has(r.id)) {
            acted.add(r.id)
            act(entry, action, AUTOMOD)
        }
    }
    if (changed) writeList(entries)
    return told
}

/** Kick or ban by name, write it down, and say what happened. */
export async function act(entry, action, by) {
    const target = { id: entry.id, name: entry.name }
    const reason = "Removed by Automod: this account joined but never entered the world, which is what bots do."
    let done
    if (action === "ban") done = (await ban(target, 0, reason, by))?.ok === true
    else done = await kick(target, reason)
    const word = action === "ban" ? "banned" : done ? "kicked" : "kick failed"
    const entries = readList()
    if (entries[entry.key]) { entries[entry.key].action = word; writeList(entries) }
    const who = by?.id === AUTOMOD.id ? "Automod" : by?.name ?? "Staff"
    tell(`§f${who}§7 ${word === "kick failed" ? `couldn't kick §f${entry.name}§7` : `${word} §f${entry.name}§7`} (§f${entry.score}%§7 likely a bot).`)
    record(by?.id === AUTOMOD.id ? undefined : by, "automod.bot", target, `${word} · ${entry.score}%`)
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
    tell(`§f${player.name}§7 entered the world, so they're off the possible bots list.`)
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
        try { checkBots() } catch (e) { console.warn(`[Admin+] bot detection: ${e}`) }
    }, CHECK_TICKS)
    console.log("[Admin+] bot detection ready")
    return true
}

// ---------------------------------------------------------------- screens

/** /automod ▸ Bot detection: the switch, what to do at the limit, the limit, the wait. */
export async function botSettingsScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back?.() }
    const s = SCORE_STEPS
    const values = await modal(player, hubTitle("settings", "Bot detection"), [
        { type: "label", label: `§7Bots join but never enter the world. Each gets a score: never entered after the wait §f${s.stuck}%§7, still not after two and a half waits §f+${s.longer}§7, chatted without entering §f+${s.chat}§7, posted a link §f+${s.link}§7, a name like Xbox's made-up ones §f+${s.name}§7. Alert staff tells staff in chat; with it off, accounts are still listed and the action still happens.` },
        { id: "on", type: "toggle", label: "Bot detection", default: botsOn() },
        { id: "alerts", type: "toggle", label: "Alert staff", default: alertsOn() },
        { id: "action", type: "dropdown", label: "At the limit", options: ACTIONS.map(a => a.label), default: Math.max(0, ACTIONS.findIndex(a => a.id === botAction())) },
        { id: "at", type: "slider", label: "The limit (%)", min: 50, max: 100, step: 5, default: actAt() },
        { id: "grace", type: "slider", label: "Wait before judging a new player (seconds)", min: 60, max: 600, step: 30, default: graceSeconds() }
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
    if (values.on !== undefined) set("automod.bots", values.on ? "true" : "false", `bot detection ${values.on ? "on" : "off"}`)
    if (values.alerts !== undefined) set("automod.botAlerts", values.alerts ? "true" : "false", `staff alerts ${values.alerts ? "on" : "off"}`)
    if (values.action !== undefined && ACTIONS[values.action]) set("automod.botAction", ACTIONS[values.action].id, `at the limit: ${ACTIONS[values.action].word}`)
    if (values.at !== undefined) set("automod.botActAt", String(values.at), `limit ${values.at}%`)
    if (values.grace !== undefined) set("automod.botGrace", String(values.grace), `wait ${values.grace} s`)
    if (!changed.length) { info(player, "§7Nothing changed."); return back?.() }
    record(player, "automod.config", undefined, changed.join(" · "), { kind: "config", overrides: previous })
    ok(player, `Bot detection: §r${changed.join("§a, §r")}§a.`)
    return back?.()
}

/** /automod ▸ Possible bots. */
export async function botListScreen(player, back) {
    const again = () => botListScreen(player, back)
    const bots = possibleBots()
    return menu(player, {
        title: hubTitle("settings", "Possible bots"),
        body: subtitle(bots.length
            ? "Accounts that joined but never entered the world, highest score first."
            : "Nobody right now. Accounts that join but never enter the world show up here."),
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
                    ok(player, `§f${entry.name}§a is off the possible bots list.`)
                    record(player, "automod.bot", { id: entry.id, name: entry.name }, "cleared")
                    return back()
                }
            }
        ].filter(Boolean),
        back
    })
}
