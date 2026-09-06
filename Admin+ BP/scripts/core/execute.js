import { world } from "@minecraft/server"
import { setting } from "./settings.js"
import { has, commandNode } from "./ranks.js"

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

/**
 * ONE list, and it is a whitelist.
 *
 * There is no blocklist any more, and there does not need to be: /op does not
 * work because it is not on the list, not because something specifically
 * forbids it. Two lists to reason about was one too many — an owner had to
 * check both to answer "can this person run that", and a mistake in either
 * direction was silent.
 *
 * Empty means NOTHING runs. That is the safe reading of an empty list for a
 * feature that hands out operator-level power, and it makes turning /cmd on
 * a deliberate act rather than a default.
 */
function allowed() {
    return String(setting("commands.allowed") ?? "")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
}

/** What tab-completion should offer. */
export function allowedCommands() { return allowed() }

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
    const list = allowed()

    if (!list.length) {
        return {
            ok: false,
            reason: "No vanilla commands are turned on. An owner turns them on in Settings ▸ Vanilla commands."
        }
    }
    if (!list.includes(name)) {
        return {
            ok: false,
            // Naming what IS on beats naming what is not: the person has a
            // command in mind and wants to know what to use instead.
            reason: `"${name}" is not turned on here. Allowed: §f${list.join("§c, §f")}`
        }
    }
    return { ok: true, command: text }
}

/**
 * Run one command as the server, positioned on the player who asked.
 * @returns {{ok: true, output: string} | {ok: false, reason: string}}
 */
/**
 * May THIS player run this command, once the world allows it at all?
 *
 * Two layers, and both have to say yes. `commands.allowed` is the world asking
 * whether a command exists here; the `cmd.<name>` node is the ladder asking who
 * may use it — so a Mod can have /a:zkill and be refused /a:zgamemode, which is
 * worth doing wherever a vanilla command duplicates something the pack already
 * does better.
 *
 * An ordinary node, so `cmd.*` grants the set, it inherits down the ladder, and
 * `-cmd.gamemode` carves a hole in an inherited wildcard. has() also lets a real
 * operator through when no rank has an opinion, which keeps a fresh world's host
 * from locking themselves out.
 *
 * @returns {{ok: true, command: string} | {ok: false, reason: string}}
 */
export function mayRun(player, line) {
    const checked = checkCommand(line)
    if (!checked.ok) return checked

    const name = commandName(checked.command)
    if (!has(player, commandNode(name))) {
        return {
            ok: false,
            reason: `Your rank is not allowed "${name}". An owner grants it in Ranks ▸ the rank ▸ Permissions ▸ Operator.`
        }
    }
    return checked
}

export function runAsServer(player, line) {
    const checked = mayRun(player, line)
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
