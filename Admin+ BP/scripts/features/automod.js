import { world, system } from "@minecraft/server"
import { modal } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err } from "../core/util.js"
import { has, isStaff } from "../core/ranks.js"
import { setSetting, flag } from "../core/settings.js"
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

const TAG = "§6§l[Automod] §r"

function alertStaff(text) {
    for (const player of world.getAllPlayers()) {
        if (has(player, "admin.automod")) {
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
        tell(player, "§eStop spamming.§7 Carry on and you will be muted.")
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

    alertStaff(`§f${displayName(player)}§7 muted §f${length}§7 for spam §8(strike ${strike}, ${count} in 10s)`)
    record(undefined, "automod.spam", player, `muted ${length} · strike ${strike} · ${count} in 10s`)
}

export function installAutomod() {
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
            if (!player || isStaff(player)) return
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
        label: () => "Ore alerts\n§8One line per vein, however big it gets"
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

export async function automodScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back() }

    const before = Object.fromEntries(CHECKS.map(check => [check.id, flag(check.key)]))
    const values = await modal(player, hubTitle("settings", "Automod"),
        CHECKS.map(check => ({
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
    for (const check of CHECKS) {
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
