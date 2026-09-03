import { world, system } from "@minecraft/server"
import { CONFIG } from "../config.js"

// Startup self-check.
//
// The honest limitation first: when a pack's manifest requires a BETA module and
// the world has Beta APIs switched off, the scripts never run at all — Bedrock
// refuses to create the script context, so there is no code alive to complain.
// Any addon claiming to "detect beta APIs being off" from inside its own scripts
// is really detecting something else, which is why those warnings are wrong as
// often as they are right.
//
// What this DOES catch is the failure that actually strands people: the scripts
// load, but the API surface they were written against is not there — a module
// version that has moved on, or a feature that shifted between beta and stable.
// That state is silent otherwise, and it is exactly what broke this pack once
// already.

/** Each probe names a capability and how to test for it. */
const PROBES = [
    {
        id: "chat",
        label: "Chat channels, staff chat and mute enforcement",
        test: () => !!world.beforeEvents?.chatSend?.subscribe
    },
    {
        id: "commands",
        label: "Slash commands",
        test: () => !!system.beforeEvents?.startup?.subscribe
    },
    {
        id: "blocks",
        label: "Spawn protection",
        test: () => !!world.beforeEvents?.playerBreakBlock?.subscribe
    }
]

/** @returns {{id: string, label: string}[]} whatever is missing */
export function missingCapabilities() {
    return PROBES.filter(probe => {
        try { return !probe.test() } catch { return true }
    }).map(({ id, label }) => ({ id, label }))
}

export const BETA_NOTICE =
    "§7Turn on §9Beta-API's §7or §cUpdate/Install §7the latest version of this mod"

/** Long enough to read, short enough not to nag. */
const REMIND_TICKS = 20 * 60 * 5

/**
 * The other half of the watchdog in functions/admin/heartbeat.mcfunction.
 *
 * Functions are data, so they keep running when the script context fails to
 * start — which is exactly what happens when Beta APIs is off and the manifest
 * asks for a beta module. That function counts this score DOWN every tick on every player; this
 * pushes it back up while the scripts are alive. If it ever reaches zero, the
 * scripts are not running, and the function says so in chat. It is the only
 * channel that reaches a player when nothing of ours is executing.
 */
function startHeartbeat() {
    const dimension = () => world.getDimension("overworld")
    const beat = () => {
        try {
            // 100 against a 1-per-tick countdown: five seconds of slack, so a
            // laggy tick or two never reads as "dead".
            dimension().runCommand("scoreboard players set @a ap_alive 100")
        } catch { /* objectives arrive with the first tick of the function */ }
    }
    system.run(beat)
    system.runInterval(beat, 20)
}

export function installHealthCheck() {
    startHeartbeat()
    const missing = missingCapabilities()
    if (!missing.length) {
        console.log("[Admin+] self-check passed — every capability present")
        return
    }

    for (const item of missing) {
        console.warn(`[Admin+] unavailable: ${item.label} (${item.id})`)
    }

    const tell = (player) => {
        player.sendMessage([
            `${CONFIG.brand.prefix}§cSome features are switched off.`,
            BETA_NOTICE,
            "",
            ...missing.map(m => `§8· ${m.label}`),
            "§8Run /function check for the short version."
        ].join("\n"))
    }

    // Tell whoever is already here, then anyone who arrives, then occasionally —
    // a one-off message at world load is missed by everybody.
    system.run(() => {
        for (const player of world.getAllPlayers()) tell(player)
    })

    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (initialSpawn) system.run(() => tell(player))
    })

    system.runInterval(() => {
        for (const player of world.getAllPlayers()) tell(player)
    }, REMIND_TICKS)
}
