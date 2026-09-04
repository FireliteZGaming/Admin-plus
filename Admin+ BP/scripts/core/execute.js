import { world } from "@minecraft/server"
import { setting } from "./settings.js"

// Running vanilla commands without being an operator.
//
// This is the honest answer to "my Co-Owner lost op and says they lost power",
// because they DID. A rank grants everything Admin+ can do; op grants the whole
// vanilla command set — /give, /effect, /time, /summon, /fill, /enchant — and no
// permission node in this pack could ever hand that over. Saying "you have the
// same power" was not true.
//
// It is true now. A command run from a DIMENSION executes at operator level
// whatever the person who asked for it holds, which is the same mechanism
// core/moderation.js already uses to kick somebody. So a rank can be given the
// vanilla command set without anybody being opped.
//
// Wrapped in `execute as ... at ...` so @s and ~ ~ ~ mean what the person
// typing them expects. Without that, everything would resolve against the
// dimension's origin and half the commands people actually want would misfire.
//
// WHY THIS IS BETTER THAN OP, and the reason it is worth building at all:
// operator is invisible. Nothing records that an operator ran /give, and
// nothing can. Every command through here is logged and announced to the ranks
// above the person who ran it. Same power, written down.

/** Commands that would let somebody step outside the rank system entirely. */
function denied() {
    return String(setting("commands.denied") ?? "")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
}

/** The first word, without a leading slash. */
export function commandName(line) {
    return String(line ?? "").trim().replace(/^\//, "").split(/\s+/)[0].toLowerCase()
}

/**
 * @returns {{ok: true, command: string} | {ok: false, reason: string}}
 */
export function checkCommand(line) {
    const text = String(line ?? "").trim().replace(/^\//, "")
    if (!text) return { ok: false, reason: "Type a command to run." }

    const name = commandName(text)
    if (denied().includes(name)) {
        return {
            ok: false,
            // Naming the setting matters: an owner who genuinely wants this
            // allowed should be able to find the switch without guessing.
            reason: `"${name}" is on the blocked list. An owner can change that in Settings ▸ Blocked commands.`
        }
    }
    return { ok: true, command: text }
}

/**
 * Run one command as the server, positioned on the player who asked.
 * @returns {{ok: true, output: string} | {ok: false, reason: string}}
 */
export function runAsServer(player, line) {
    const checked = checkCommand(line)
    if (!checked.ok) return checked

    const dimension = player?.dimension ?? world.getDimension("overworld")
    // as + at, so @s is them and ~ is where they are standing.
    const wrapped = `execute as "${player.name}" at @s run ${checked.command}`
    try {
        const result = dimension.runCommand(wrapped)
        return { ok: true, output: String(result?.successCount ?? 0), command: checked.command }
    } catch (e) {
        // A command that the game refuses is normal — a typo, a bad selector,
        // nothing matched. Hand the message back rather than swallowing it.
        return { ok: false, reason: String(e).replace(/^Error: /, "") }
    }
}
