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

export function canUseCode(player) {
    try {
        const tagged = player.getTags().some(t => t.toLowerCase() === DEV_TAG.toLowerCase())
        if (!tagged) return false
        const level = player.commandPermissionLevel
        return typeof level === "number" && level >= (CommandPermissionLevel?.GameDirectors ?? 1)
    } catch { return false }
}
