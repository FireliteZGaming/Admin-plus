import { has, whereToGrant } from "./ranks.js"

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

/**
 * The two halves, split 2026-09-13 because they are not the same trust.
 *
 * `admin.smite` is the visible, harmless, reversible half: lightning and the
 * knockback stick. Somebody notices, everybody laughs,
 * and the log says who.
 *
 * `admin.sudo` puts WORDS IN SOMEBODY'S MOUTH and runs commands as them. It is
 * impersonation, it is invisible to the person it happens to, and an owner can
 * reasonably want staff who may smite but may not do that.
 *
 * One switch called "troll" could not express that, and told a thirteen-year-old
 * nothing about what they were handing over.
 */
export const SMITE = "admin.smite"
export const SUDO = "admin.sudo"

/** May this player use troll tools? Defaults to the harmless half. */
export function trollAllowed(player, node = SMITE) {
    return has(player, node)
}

/** Why not, phrased for the person who just tried — or undefined. */
export function trollBlockedBy(player, node = SMITE) {
    // Phrased the way every other locked item is, and pointing at the switch by
    // the name the rank editor puts on the button.
    if (!has(player, node)) {
        return `Needs §f${whereToGrant(node)}`
    }
    return undefined
}
