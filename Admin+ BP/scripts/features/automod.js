import { world, system } from "@minecraft/server"
import { modal, INCOMPLETE } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { CHAT_AUTOMOD_ON_HOLD, AUTOMOD_ON_HOLD } from "../core/hold.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff } from "../core/ranks.js"
import { setSetting, flag, setting, overrides } from "../core/settings.js"
import { sw, num, txt, fieldFor, applyField } from "../core/settingFields.js"
import { record } from "../core/logs.js"
import {
    config, noteOre, noteBreak, noteChat, drainFinishedVeins,
    describeVein, forgetPlayer, spamStrike, spamPenalty, forgetStrikes
} from "../core/automod.js"
import { mute } from "../core/moderation.js"
import { addWarning } from "../core/warnings.js"
import { formatDuration } from "../core/util.js"
import { displayName } from "../core/identity.js"

// /admin ▸ Settings ▸ Automod
//
// Alerts go to staff holding admin.automod and into the log as automod.*.
//
// **Automod acts on spam now**, which reverses the rule this file used to state
// — "nothing is ever punished automatically". That rule was not wrong about
// bans: an ore alert or a fast-breaking flag is a GUESS, and a guess must not
// punish. Flooding chat is different. It is not inferred from behaviour that
// might be innocent; it is counted, and the person doing it knows they are
// doing it. Twitch has worked this way for a decade and nobody finds it unjust,
// because the first thing that happens is being told, and the punishment is a
// minute.
//
// Everything else automod notices still only alerts. Ore veins and block-break
// rates stay a guess, and stay staff's call.
//
// **It speaks as [Automod], never as [Admin+].** The pack's prefix means "a
// person with a rank did this to you". A mute nobody chose needs to say so, or
// the first thing the player does is accuse whoever is online.

/** One line per vein: "Nova found a x8 diamond ore vein at 120 12 -301". */
function reportVein(vein) {
    const where = vein.at ? ` §8at ${vein.at.x} ${vein.at.y} ${vein.at.z}` : ""
    alertStaff(`§f${vein.name}§7 found a §f${describeVein(vein)}§7 vein.${where}`)
    record(undefined, "automod.ore", { id: vein.playerId, name: vein.name },
        `${describeVein(vein)} vein`)
}

/**
 * What to DO about a screened message, beyond holding it.
 *
 * **Ships as hold-only, and that is not timidity.** A term filter is a GUESS —
 * it matches words, it cannot read intent, and this pack's standing rule is
 * that automod punishes what it COUNTS and only alerts on what it guesses.
 * Turning this up is choosing to punish on a guess, which is a real choice a
 * realm is entitled to make, so the switch exists.
 *
 * **The message is held either way.** Punishing does not replace the queue: a
 * false positive has to stay recoverable, and a moderator seeing what was
 * caught is the only thing that tells you the setting is too aggressive.
 *
 * Its own action, not the spam ladder. Flooding chat and saying a slur are
 * different offences, and sharing a strike counter would push somebody who
 * spammed once straight up the ladder for saying something unrelated.
 */
export function actOnFilter(player, flagged) {
    const action = String(setting("filter.action") ?? "hold").trim().toLowerCase()
    if (action === "warn") {
        try {
            addWarning({ name: "Automod" }, player,
                `${flagged.label} in chat`, `matched "${flagged.term}"`)
        } catch { /* warnings storage unavailable */ }
        alertStaff(`§f${displayName(player)}§7 was warned for §f${flagged.label}§7 in chat.`)
        return "warn"
    }
    if (action === "mute") {
        const seconds = Math.max(1, Math.floor(Number(setting("filter.muteSeconds"))) || 300)
        mute(player, seconds * 1000, `${flagged.label} in chat (automod)`, undefined)
        player.sendMessage(`${TAG}§cYou were muted for §f${seconds}s§c: ${flagged.label} in chat.`)
        alertStaff(`§f${displayName(player)}§7 was muted §f${seconds}s§7 for §f${flagged.label}§7 in chat.`)
        return "mute"
    }
    return "hold"
}

const TAG = "§6§l[Automod] §r"

/**
 * One line to every staff member who can act on automod.
 *
 * Exported so the chat screen speaks with the SAME voice: the tag lives
 * in one place, because two copies of a sentinel that must agree is how
 * the multiline form quietly stopped being multiline.
 */
/**
 * Tell the staff who are meant to hear it.
 *
 * **Being told and being able to retune are two different jobs**, and
 * `admin.automod` used to be both. A moderator who should see "somebody is
 * mining forty blocks a second" had to be handed the spam ladder and the held
 * queue to get it, because there was one switch where there are two decisions.
 *
 * `admin.alerts` is the watching half. `admin.automod` keeps the editing half —
 * the config screen, the held queue and the panel buttons that reach them.
 *
 * EITHER node hears the alert, and that is deliberate rather than lazy: the new
 * one is absent from every rank table already out there, so a world upgrading
 * into this would have gone quiet for its whole staff until an owner noticed.
 * Accepting the old node means the split only ever ADDS a capability. Same
 * caveat the vanilla-commands switch hit in 2.6.4, handled the other way round.
 */
export function alertStaff(text) {
    for (const player of world.getAllPlayers()) {
        if (has(player, "admin.alerts") || has(player, "admin.automod")) {
            player.sendMessage(`${TAG}${text}`)
        }
    }
}

/** To the person it is about, in automod's own voice. */
function tell(player, text) {
    try { player.sendMessage(`${TAG}${text}`) } catch { /* left mid-message */ }
}

/**
 * Spam, answered.
 *
 * The ladder is config (`automod.spamLadder`, seconds per strike) and ships as
 * 0, 60, 300, 600 — a talking-to, then a minute, then five, then ten for that
 * one and every one after it.
 *
 * A strike also puts a WARNING on the record at the point the ladder stops
 * being a nudge, so the escalation is visible to staff and counts toward
 * whatever they do about repeat offenders. The first strike does not: being
 * told once is not a mark against you.
 */
function punishSpam(player, count) {
    const strike = spamStrike(player)
    const seconds = spamPenalty(strike)

    if (!seconds) {
        tell(player, "§eStop spamming.§7 If you keep going, you will be muted.")
        alertStaff(`§f${displayName(player)}§7 was told to stop spamming §8(${count} in 10s)`)
        record(undefined, "automod.spam", player, `warned · ${count} in 10s`)
        return
    }

    const length = formatDuration(seconds * 1000)
    mute(player, seconds * 1000, `Spam (automod, strike ${strike})`, undefined)
    tell(player, `§cMuted for ${length}§7 for spamming. You will be told when it ends.`)

    // The record entry, from strike three on — the point the ladder stops being
    // a nudge. Filed by automod rather than by whoever happens to be online,
    // and it shows up in /warnings like any other.
    if (strike >= 3) {
        // Signed "Automod", not "console": a warning on somebody's record should
        // name what put it there, and console is what a human at the server
        // console would be.
        try { addWarning({ name: "Automod" }, player, `Spam (strike ${strike})`, `${count} messages in 10s`) }
        catch (e) { console.warn(`[Admin+] automod could not file a warning: ${e}`) }
    }

    alertStaff(`§f${displayName(player)}§7 was muted §f${length}§7 for spam §8(strike ${strike}, ${count} in 10s)`)
    record(undefined, "automod.spam", player, `muted ${length} · strike ${strike} · ${count} in 10s`)
}

export function installAutomod() {
    // All of automod is on hold since 2.12.14 (core/hold.js): nothing listens,
    // so no ore alert, break-rate alert or chat strike can happen.
    if (AUTOMOD_ON_HOLD) return
    const breakEvent = world.afterEvents?.playerBreakBlock
    if (breakEvent?.subscribe) {
        breakEvent.subscribe(eventData => {
            const player = eventData.player
            if (!player || isStaff(player)) return

            if (config.ores()) {
                // The BLOCK's position, not the player's — veins are grouped by
                // where the ore was, and a player can stand still and mine out
                // in several directions.
                const finished = noteOre(
                    player,
                    eventData.brokenBlockPermutation?.type?.id ?? eventData.block?.typeId ?? "",
                    eventData.block?.location)
                if (finished) reportVein(finished)
            }

            const rate = noteBreak(player)
            if (rate) {
                const text = `§f${player.name}§7 broke §f${rate}§7 blocks in a second.`
                alertStaff(text)
                record(undefined, "automod.breaks", player, `${rate} blocks/second`)
            }
        })
    }

    // A vein is normally reported the moment the next one starts. This catches
    // the last vein of a session, which would otherwise sit unreported until
    // they happened to mine again.
    system.runInterval(() => {
        if (!config.ores()) return
        for (const vein of drainFinishedVeins()) reportVein(vein)
    }, 40)

    const chatEvent = world.beforeEvents?.chatSend
    if (chatEvent?.subscribe) {
        chatEvent.subscribe(eventData => {
            const player = eventData.sender
            // On hold since 2.9.2 (core/hold.js): nobody is warned or muted.
            if (CHAT_AUTOMOD_ON_HOLD || !player || isStaff(player)) return
            const verdict = noteChat(player)
            if (!verdict) return
            system.run(() => {
                // Typing fast is NOT spamming. Said out loud and nothing else:
                // no strike, no mute, nothing on the record, and staff are not
                // told — a burst of "yes" in an argument is not an incident.
                if (verdict.kind === "fast") {
                    tell(player, "§7You are typing quickly. §8Slow down a little.")
                    return
                }
                punishSpam(player, verdict.count)
            })
        })
    }

    world.afterEvents.playerLeave?.subscribe(({ playerId }) => {
        forgetPlayer(playerId)
        // Strikes are session state, like the rates they come from. Somebody
        // who leaves and comes back starts clean, which is the same forgiveness
        // the forget window gives them for waiting.
        forgetStrikes(playerId)
    })
}

// ------------------------------------------------------------------- the UI
//
// Toggles, and nothing else. Every automod check is either on or off, so the
// screen that configures it IS the toggles — not a hub with a switches screen
// inside it. This used to be three sub-screens deep; the two that are gone
// (thresholds, watched ores) set numbers almost nobody changes twice, and those
// values live in < Code > with every other tuning key. The numbers still in
// play are named in the labels, so the screen never hides what a check means.

const CHECKS = [
    {
        id: "ores",
        key: "automod.ores",
        label: () => "Ore alerts\n§8One alert per vein, whatever its size"
    },
    {
        id: "breaks",
        key: "automod.breaks",
        label: () => `Break rate\n§8Flags over ${config.breakRate()} blocks a second`
    },
    {
        id: "spam",
        key: "automod.spam",
        label: () => `Chat flooding\n§8Flags over ${config.spamRate()} messages in 10s`
    }
]

/** The checks the screen shows. Chat flooding is left off while chat automod is on hold. */
export function shownChecks() {
    return CHECKS.filter(check => !(CHAT_AUTOMOD_ON_HOLD && check.id === "spam"))
}

/**
 * Beta (2.12.7): each check is a section with its own numbers under its
 * switch. They were in Server ▸ Advanced ▸ Every setting alone, which the
 * user wanted gone. Each default sits inside its slider, on a step.
 */
export const CHECK_PAGES = {
    ores: {
        title: "Ore alerts",
        fields: [
            sw("automod.ores", "Ore alerts", "One alert per vein, whatever its size"),
            num("automod.veinRadius", "Blocks apart that still count as one vein", "", 1, 16),
            num("automod.veinIdle", "Seconds with no new find before a vein is reported", "", 2, 60),
            txt("automod.oreThresholds", "Ores it watches, and how big a vein alerts", "Ore and size pairs, like diamond_ore:3, ancient_debris:2. Empty uses the built-in list.")
        ]
    },
    breaks: {
        title: "Fast breaking",
        fields: [
            sw("automod.breaks", "Fast breaking", "Flags mining faster than the number below"),
            num("automod.breakRate", "Blocks a second before it flags", "Keep this high: TNT and Efficiency V break blocks fast without cheating", 5, 100, 5)
        ]
    },
    spam: {
        title: "Chat flooding",
        fields: [
            sw("automod.spam", "Chat flooding", "Counts messages, then warns and mutes"),
            num("automod.spamRate", "Messages in 10 seconds before they're told they're typing fast", "No strike, and nothing is recorded", 2, 30),
            num("automod.spamHard", "Messages in 10 seconds that count as spam", "Each strike is punished harder. Always at least one more than typing fast.", 3, 40),
            txt("automod.spamLadder", "Mute for each strike, in seconds", "In order, separated by commas. 0 is a warning only, and the last one repeats."),
            num("automod.spamForget", "Minutes with no strike before strikes go back to zero", "", 5, 240, 5)
        ]
    }
}

/** A field's words: its label, then its detail in grey. */
const labelOf = field => [field.label, field.detail ? `§8${field.detail}` : ""].filter(Boolean).join("\n")

/** Beta's Checks: one page, a section per check (CHECK_PAGES). */
async function checksPageScreen(player, back) {
    const pages = shownChecks().map(check => CHECK_PAGES[check.id])
    const fields = []
    for (const page of pages) {
        if (fields.length) fields.push({ type: "divider" })
        fields.push({ type: "label", label: `§l${page.title}§r` })
        for (const field of page.fields) fields.push(fieldFor(field, labelOf(field)))
    }
    const values = await modal(player, hubTitle("settings", "Automod checks"), fields, { strict: true, submit: "Save" })
    if (values === undefined) return back()
    if (values === INCOMPLETE) {
        err(player, "Not every setting came back from the game, so nothing was saved. Try again.")
        return back()
    }

    const previous = overrides()
    const changed = [], refused = []
    for (const field of pages.flatMap(page => page.fields)) {
        const answer = applyField(field, values[field.key], field.label)
        if (answer.words) changed.push(answer.words)
        if (answer.refused) refused.push(answer.refused)
    }
    if (refused.length) err(player, refused.join("\n"))
    if (!changed.length) {
        if (!refused.length) info(player, "Nothing changed.")
        return back()
    }
    record(player, "automod.config", undefined, changed.join(" · ").replace(/§./g, ""), { kind: "config", overrides: previous })
    ok(player, `Automod: §r${changed.join("§a, §r")}§a.`)
    return back()
}

export async function automodScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back() }
    // The Checks pages are everyone's since 2.12.10; the old list below is
    // kept but nothing reaches it.
    return checksPageScreen(player, back)

    const checks = shownChecks()
    const before = Object.fromEntries(checks.map(check => [check.id, flag(check.key)]))
    const values = await modal(player, hubTitle("settings", "Automod"),
        checks.map(check => ({
            id: check.id,
            type: "toggle",
            label: check.label(),
            default: before[check.id]
        })))
    if (!values) return back()

    // Only speak when something actually moved. Submitting a form unchanged is
    // the commonest thing that happens on it, and "Automod updated" after a
    // no-op is the kind of line that trains people to stop reading.
    const changed = []
    for (const check of checks) {
        const now = !!values[check.id]
        if (now === before[check.id]) continue
        setSetting(check.key, now ? "true" : "false")
        changed.push(`${check.id} ${now ? "on" : "off"}`)
    }
    if (!changed.length) return back()

    record(player, "automod.config", undefined, changed.join(" · "))
    ok(player, `Automod: §f${changed.join("§a, §f")}§a.`)
    return back()
}
