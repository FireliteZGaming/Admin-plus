import { world } from "@minecraft/server"
import { knownHolders } from "./ranks.js"
import { getNickname, stripCodes } from "./identity.js"

// Display names that copy another player. Admin+ shows a player by their
// display name everywhere, so one that matches somebody else's gamertag or
// display name lets a player pass as them. Closed in 2.10.1, from the user's
// exploit check (2026-11-12): "changing a display name ... which could
// ultimately mess with the stuff".

const plain = s => stripCodes(String(s ?? "")).trim().toLowerCase()

/**
 * The player who already goes by `value`, other than `targetId`, or nothing.
 * Compared without colour codes and capital letters, so "§cSteve" is Steve.
 */
export function nameTakenBy(targetId, value) {
    const want = plain(value)
    if (!want) return undefined
    const seen = new Map()
    for (const holder of knownHolders()) seen.set(holder.id, holder.name)
    for (const player of world.getAllPlayers()) seen.set(player.id, player.name)
    for (const [id, name] of seen) {
        if (id === targetId) continue
        if (plain(name) === want || plain(getNickname(id)) === want) return name
    }
    return undefined
}
