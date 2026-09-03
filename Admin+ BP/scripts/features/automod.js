import { world, system } from "@minecraft/server"
import { modal } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err } from "../core/util.js"
import { has, isStaff } from "../core/ranks.js"
import { setSetting, flag } from "../core/settings.js"
import { record } from "../core/logs.js"
import {
    config, noteOre, noteBreak, noteChat, drainFinishedVeins,
    describeVein, forgetPlayer
} from "../core/automod.js"

// /admin ▸ Settings ▸ Automod
//
// Alerts go to staff holding admin.automod and into the log as automod.*.
// Nothing is ever punished automatically — an alert names a player and staff
// decide, which is the only version of this that stays trustworthy.

/** One line per vein: "Nova found a x8 diamond ore vein at 120 12 -301". */
function reportVein(vein) {
    const where = vein.at ? ` §8at ${vein.at.x} ${vein.at.y} ${vein.at.z}` : ""
    alertStaff(`§f${vein.name}§7 found a §f${describeVein(vein)}§7 vein.${where}`)
    record(undefined, "automod.ore", { id: vein.playerId, name: vein.name },
        `${describeVein(vein)} vein`)
}

function alertStaff(text) {
    for (const player of world.getAllPlayers()) {
        if (has(player, "admin.automod")) {
            player.sendMessage(`§6§l[Automod] §r${text}`)
        }
    }
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
            const rate = noteChat(player)
            if (!rate) return
            system.run(() => {
                alertStaff(`§f${player.name}§7 sent §f${rate}§7 messages in 10s.`)
                record(undefined, "automod.spam", player, `${rate} messages in 10s`)
            })
        })
    }

    world.afterEvents.playerLeave?.subscribe(({ playerId }) => forgetPlayer(playerId))
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
