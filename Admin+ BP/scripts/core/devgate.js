import { CommandPermissionLevel } from "@minecraft/server"

// The Dev gate: a "Dev" tag AND operator status, both.
//
// Deliberately two locks, because each one alone is weak. The tag is something
// any staff member with /tag could give themselves; op is handed out loosely on
// a lot of realms. Requiring both means somebody had to mean it.
//
// This lives in its own file rather than in features/code.js because more than
// one feature is locked behind it now, and having them import a UI module to
// ask a permission question was a circular import waiting to happen.

export const DEV_TAG = "Dev"

/** Operator, in the sense the gate means it. */
export function hasOperator(player) {
    try {
        const level = player?.commandPermissionLevel
        return typeof level === "number" && level >= (CommandPermissionLevel?.GameDirectors ?? 1)
    } catch { return false }
}

/** Holds the tag — half the gate on its own, which is the point of the other half. */
export function inDeveloperMode(player) {
    try {
        return player.getTags().some(t => t.toLowerCase() === DEV_TAG.toLowerCase())
    } catch { return false }
}

/**
 * Put somebody in or out of developer mode.
 *
 * This grants nothing an operator did not already have: any op can type
 * `/tag @s add Dev` and always could. `/mode` is a better door onto the same
 * room, not a wider one — which is why it asks for operator and then simply
 * writes the tag rather than pretending to be a second authority.
 */
export function setDeveloperMode(player, on) {
    try {
        if (on) player.addTag(DEV_TAG)
        else player.removeTag(DEV_TAG)
        return true
    } catch (e) {
        console.warn(`[Admin+] could not change developer mode for ${player?.name}: ${e}`)
        return false
    }
}

export function canUseCode(player) {
    return inDeveloperMode(player) && hasOperator(player)
}
