import { world } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { wipeAll } from "../core/storage.js"
import { onPlayerJoin } from "../core/ranks.js"
import { inStaffMode } from "../core/staffmode.js"
import { isVanished, unvanish } from "../core/vanish.js"
import { applyFrozen, syncMuteTag } from "../core/moderation.js"
import { removeAll as removeAllHolograms } from "../core/holograms.js"
import { record } from "../core/logs.js"
import { stopStaffMode } from "./staffmode.js"

// FACTORY RESET: Admin+ wiped and started over, as on a world that just got
// the pack. The user, 2026-11-12: "Factory Reset does a complete wipe of the
// mod and resets it back to the state as if the mod just was added to your
// world." Before 2.9.3 it only put settings back.
//
// Some things belong to players, not to the pack, so they are handed back
// BEFORE anything is deleted:
//   1. Staff mode inventories of players who are online: given back now.
//   2. Staff mode inventories of players who are offline: KEPT, so they get
//      their things back the next time they join. Deleting them would delete
//      somebody's items, and no setting is worth that.
//   3. Vanished players are shown again, and frozen players can move
//      again.
//
// Two more tables are kept, because each undoes something in the world rather
// than configuring the pack: enderBlocks, the blocks an old version placed,
// which its sweep puts back; and devOps (3.1.6), the developers Admin+ made
// operators, so a decline after a reset still takes that operator status back
// (features/terms.js). Forget it and Admin+ could never tell its own op from
// one the owner gave.
//
// Everything else under the "ap:" prefix goes, including keys from older
// versions that no table knows about any more. One log line says who did it,
// so a wipe is never silent.

/** Tables a factory reset keeps. See above for why each one. */
export const KEPT_BY_RESET = Object.freeze(["staffmode", "enderBlocks", "devOps"])

/**
 * Wipe Admin+ and start it over. Only the Factory reset screen calls this,
 * after an operator has confirmed twice.
 * @returns {{removed: number, returned: number, holograms: number}}
 */
export function factoryReset(by) {
    const online = world.getAllPlayers()

    // 1. Hand back what belongs to players.
    let returned = 0
    for (const player of online) {
        if (!inStaffMode(player)) continue
        stopStaffMode(player)
        returned++
    }
    for (const player of online) if (isVanished(player)) unvanish(player)
    // Their entities go now rather than on the next sweep.
    const holograms = removeAllHolograms()

    // 2. Wipe everything else and put every table back to its first-day seed.
    const removed = wipeAll({ keep: KEPT_BY_RESET })

    // 3. Everyone online starts over as if they had just joined a fresh world:
    //    the starting rank, a plain nametag, free to move, no mute tag.
    for (const player of online) {
        try {
            onPlayerJoin(player)
            applyFrozen(player)
            syncMuteTag(player)
        } catch { /* left during the reset */ }
    }

    // 4. The one line that survives, and a word to everyone.
    record(by, "config.reset", undefined, "Factory reset: Admin+ wiped and started over")
    try {
        world.sendMessage(`${CONFIG.brand.prefix}§7An operator reset Admin+. Ranks, homes, warps, claims and settings start over.`)
    } catch { /* nobody to tell */ }
    return { removed, returned, holograms }
}
