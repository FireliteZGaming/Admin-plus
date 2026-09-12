import { has } from "./ranks.js"

// One answer to "may this person use a troll tool", for everything that is one.
//
// **It is the ladder, and only the ladder.** There used to be a second switch —
// `feature.troll`, a world-level toggle that shipped OFF — and it was the wrong
// shape for the job twice over.
//
// It confused the person it was supposed to protect. An operator opening
// `/items` saw three of seven and nothing said why: `has()` lets an operator
// through any rank node, so the ladder half passed, and the world half failed
// silently. The items did not look switched off, they looked missing.
//
// And it asked a question the ranks already answer. "Does this world have troll
// tools" is not separate from "which ranks may use them" — a world that wants
// none gives the node to nobody, which is the same act performed once instead
// of twice, in the place people already go to decide who may do what.
//
// So there is one switch now: `admin.troll`, in Settings ▸ Ranks ▸ the rank ▸
// Staff tools, where it shows as `troll`. Operators pass it, as they pass every
// node no rank has an opinion about.

/** May this player use troll tools? */
export function trollAllowed(player) {
    return has(player, "admin.troll")
}

/** Why not, phrased for the person who just tried — or undefined. */
export function trollBlockedBy(player) {
    if (!has(player, "admin.troll")) {
        return "Your rank doesn't hold troll tools. Settings ▸ Ranks ▸ Staff tools ▸ troll."
    }
    return undefined
}
