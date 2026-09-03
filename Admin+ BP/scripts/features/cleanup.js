import { world, system, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { err, info, broadcast } from "../core/util.js"
import { record } from "../core/logs.js"
import {
    judge, tally, describeTally, removableTypes,
    activeGroups, warnSeconds
} from "../core/cleanup.js"

// /clearchat and /lagclear.
//
// /lagclear warns first and only ever removes whitelisted clutter — see
// core/cleanup.js for why it is built that way round.

const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]

// -------------------------------------------------------------- clear chat

command({
    name: "clearchat",
    description: "Push chat history off everyone's screen",
    perm: "admin.clearchat",
    run: (player) => {
        // Bedrock has no "clear chat" — the only way is to scroll it off with
        // blank lines, which is what every server does.
        const blank = "\n".repeat(100)
        for (const target of world.getAllPlayers()) {
            target.sendMessage(blank)
        }
        broadcast(`§7Chat cleared by §f${player.name}§7.`)
        record(player, "admin.clearchat", undefined, "chat cleared")
    }
})

// --------------------------------------------------------------- lag clear

/** Everything the current settings would even consider removing. */
function candidates() {
    const types = removableTypes()
    if (!types.length) return []
    const found = []
    for (const id of DIMENSIONS) {
        let dimension
        try { dimension = world.getDimension(id) } catch { continue }
        for (const type of types) {
            try { found.push(...dimension.getEntities({ type })) } catch { /* type unknown here */ }
        }
    }
    return found
}

command({
    name: "lagclear",
    description: "Count clutter, warn, then clear it — /lagclear [seconds]",
    perm: "admin.lagclear",
    optional: [{ name: "seconds", type: CustomCommandParamType.Integer }],
    run: (player, [seconds]) => {
        const groups = activeGroups()
        if (!groups.length) {
            return err(player, "Every cleanup group is switched off — nothing would be removed.")
        }

        const found = candidates()
        const keepers = found.filter(e => !judge(e).remove)
        const removable = found.filter(e => judge(e).remove)

        if (!removable.length) {
            info(player, `Nothing to clear. §8(${found.length} looked at, ${keepers.length} protected)`)
            return
        }

        const delay = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : warnSeconds()
        info(player, `§7Clearing §f${describeTally(tally(removable))}§7.`)
        if (keepers.length) {
            info(player, `§8Leaving ${keepers.length} protected — named, tagged or valuable.`)
        }

        if (delay <= 0) return finish(player, removable)

        broadcast(`§eClearing dropped items and clutter in §f${delay}s§e — pick up anything you want.`)
        system.runTimeout(() => {
            // Re-judge at the moment of removal: something may have been picked
            // up, and a player may have dropped something new in the meantime.
            finish(player, candidates().filter(e => judge(e).remove))
        }, delay * 20)
    }
})

function finish(player, entities) {
    let removed = 0
    const counts = tally(entities)
    for (const entity of entities) {
        try {
            if (!entity.isValid) continue
            entity.remove()
            removed++
        } catch { /* already gone */ }
    }

    broadcast(`§7Cleared §f${removed}§7 ${removed === 1 ? "entity" : "entities"}. §8${describeTally(counts)}`)
    record(player, "admin.lagclear", undefined, `${removed} removed · ${describeTally(counts)}`)
}

/** What is out there, without touching anything. */
command({
    name: "lagcheck",
    description: "Count entities without removing anything",
    perm: "admin.lagclear",
    run: (player) => {
        const everything = []
        for (const id of DIMENSIONS) {
            try { everything.push(...world.getDimension(id).getEntities()) } catch { /* not loaded */ }
        }
        const rows = tally(everything)
        const clutter = everything.filter(e => judge(e).remove).length

        info(player, [
            `§f${everything.length}§7 entities loaded across all dimensions.`,
            `§f${clutter}§7 of them would be cleared by /lagclear.`,
            "",
            `§7Most common: §f${describeTally(rows, 8)}`,
            "§8Mob farms and villagers are counted but never cleared —",
            "§8if the top row is chickens, clearing items will not help."
        ].join("\n"))
    }
})
