import { world } from "@minecraft/server"
import { setting } from "./settings.js"
import { deniedFor, commandNode, has, whereToGrant } from "./ranks.js"

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
// Wrapped in `execute at ...` so ~ ~ ~ means where the person is standing.
// Without that, everything would resolve against the dimension's origin and
// half the commands people actually want would misfire.
//
// NEVER `execute as`. That was the bug behind every "insufficient permission"
// report — /a:tp, /cmd, the console, all of it. `as` REPLACES the executor with
// the player, so the inner command is dispatched at THAT PLAYER's permission
// level, and handing it to the dimension in the first place bought nothing.
// `at` moves only position, rotation and dimension; the executor stays the
// server. The cost is that the command no longer knows who "you" are, and it is
// paid in two places, both below:
//
//   rewriteSelf         @s would be the server, so it is pointed at the player.
//   withExplicitTarget  an OMITTED target would be the server too — and there
//                       is no @s in `/gamemode creative` for the first rewrite
//                       to catch — so the target is written in.
//
// Between them nothing is left resolving against the executor, which is what
// "runs as them" has to mean once `as` is off the table.
//
// WHY THIS IS BETTER THAN OP, and the reason it is worth building at all:
// operator is invisible. Nothing records that an operator ran /give, and
// nothing can. Every command through here is logged and announced to the ranks
// above the person who ran it. Same power, written down.

/** The first word, without a leading slash. */
export function commandName(line) {
    return String(line ?? "").trim().replace(/^\//, "").split(/\s+/)[0].toLowerCase()
}

/**
 * @returns {{ok: true, command: string} | {ok: false, reason: string}}
 */
/**
 * Never, by anybody, however the ranks are set.
 *
 * Commands are on by default now, so this is the only thing standing between
 * `/cmd` and handing the world away — and it is not a setting, because a
 * setting that can grant `op` is `op`.
 *
 *   op, deop            the whole point. /cmd exists so a rank need not be
 *                       operator; a rank that can grant operator defeats it.
 *   execute, function,  WRAPPERS. Only the first word is ever checked, so each
 *   scriptevent,        of these carries anything at all behind it — "function
 *   schedule            mypack:whatever" can contain op.
 *   kick                removing somebody is this pack's job, through a path
 *                       that does not lock them out until the host restarts.
 *   the rest            dedicated-server and session administration, and the
 *                       editor/debug tooling.
 */
const NEVER = new Set([
    "op", "deop",
    "execute", "function", "scriptevent", "schedule",
    "kick",
    "allowlist", "permission", "changesetting", "reload", "reloadconfig",
    "save", "stop", "transfer", "setmaxplayers", "wsserver", "sendshowstoreoffer",
    "script", "gametest", "project"
])

/** Is this command refused to everyone, whatever their rank says? */
export function neverAllowed(name) {
    return NEVER.has(String(name ?? "").trim().toLowerCase())
}

export function checkCommand(line) {
    const text = String(line ?? "").trim().replace(/^\//, "")
    if (!text) return { ok: false, reason: "Type a command to run." }

    const name = commandName(text)
    if (neverAllowed(name)) {
        return { ok: false, reason: `"${name}" can never be run this way — it would hand the world over.` }
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
 * Two questions, and both have to say yes: does the rank hold
 * `admin.commands` at all, and has it been denied this one with
 * `-cmd.<name>`? Since 2.8.2 the only vanilla commands Admin+ runs for staff
 * are time and weather (/clock and /sky). The `commands.allowed` list that
 * used to sit in front of this was dropped then: nothing had checked it for
 * a long time.
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

    // **The gate that was declared and never connected.** `admin.commands` sat
    // in PERMISSION_NODES describing exactly this — "who may use the vanilla
    // command set at all" — and nothing ever asked about it, so the switch drew
    // in every rank editor and did nothing when flipped. Found 2026-09-13 after
    // the test meant to catch that turned out to be vacuous.
    //
    // It is one switch where there used to be fifty-five. `has()` still lets a
    // real operator through when no rank has an opinion, so a fresh world's host
    // cannot lock themselves out.
    if (!has(player, "admin.commands")) {
        return {
            ok: false,
            reason: `Your rank can't use vanilla commands. An owner turns that on in ${whereToGrant("admin.commands")}.`
        }
    }

    // And the per-command hole, kept as a MECHANISM rather than as fifty-five
    // rows in the editor. A rank carrying `-cmd.fill` is still refused /a:fill;
    // it is simply set in the config rather than hunted for in a list nobody
    // could scan.
    const name = commandName(checked.command)
    if (deniedFor(player, commandNode(name))) {
        return {
            ok: false,
            reason: `"${name}" is switched off for your rank.`
        }
    }
    return checked
}

/**
 * Rewrite every `@s` so it names the player instead of the executor.
 *
 * `execute at` leaves the server as the executor, which is the whole point — but
 * it also means `@s` is the server, and `/kill @s` would then hit nothing (or
 * the wrong thing). Every occurrence becomes the selector that picks out this
 * one player.
 *
 * `@s[...]` keeps its own arguments: they merge INTO the replacement rather than
 * trailing after it, because `@a[...][...]` is not a selector. Bracket depth is
 * counted so `hasitem=[{item=stone}]` survives, and `@sign`/`@stuff` are left
 * alone — only a bare `@s` is a selector.
 */
function rewriteSelf(text, me) {
    const head = me.slice(0, -1)          // "@a[tag=…,c=1" — always ends "]"
    let out = "", i = 0
    while (i < text.length) {
        const isSelf = text[i] === "@" && (text[i + 1] === "s" || text[i + 1] === "S")
            && !/[A-Za-z0-9_]/.test(text[i + 2] ?? "")
        if (!isSelf) { out += text[i++]; continue }

        let j = i + 2, args = ""
        if (text[j] === "[") {
            let depth = 0, k = j
            for (; k < text.length; k++) {
                const c = text[k]
                if (c === "[" || c === "{") depth++
                else if (c === "]" || c === "}") { depth--; if (depth === 0) { k++; break } }
            }
            args = text.slice(j + 1, k - 1).trim()
            j = k
        }
        out += args ? `${head},${args}]` : me
        i = j
    }
    return out
}

/**
 * Split a command into arguments the way the game does.
 *
 * Not `split(/\s+/)`. A selector carries spaces inside its brackets
 * (`@a[name="Some Player", r=5]`) and so does a quoted string, and either one
 * chopped into pieces would be counted as several arguments — which is the one
 * thing the table below must never get wrong.
 */
function tokenise(text) {
    const out = []
    let depth = 0, quoted = false, current = ""
    for (const c of String(text ?? "")) {
        if (c === '"') { quoted = !quoted; current += c; continue }
        if (!quoted) {
            if (c === "[" || c === "{") depth++
            else if (c === "]" || c === "}") depth--
            else if (depth === 0 && /\s/.test(c)) {
                if (current) out.push(current)
                current = ""
                continue
            }
        }
        current += c
    }
    if (current) out.push(current)
    return out
}

/** `~`, `^`, `10`, `-3.5` — a coordinate rather than somebody's name. */
function isCoord(token) { return /^[~^]|^[-+]?[0-9]/.test(String(token ?? "")) }

/**
 * Commands whose target may be LEFT OUT, and where it belongs when it is.
 *
 * This is the other half of dropping `execute as`, and the half that is easy to
 * miss: `as` did not only decide what `@s` meant, it decided what an OMITTED
 * target meant. `/gamemode creative` with nobody named is "the executor" — which
 * under `execute at` is the server, not the person who typed it. Rewriting `@s`
 * cannot reach that, because there is no `@s` in the text to rewrite.
 *
 * So the target is written in explicitly and nothing is ever left to default.
 *
 * `absent` decides whether the target really was left out, from the arguments
 * that ARE there, and it is deliberately conservative: when a command could be
 * read either way, it is left alone and the game answers for it. Guessing wrong
 * here does not fail — it silently acts on the wrong player, which is worse than
 * any error. `at` is where the target is spliced in, because for `/tp` it is the
 * FIRST argument and appending would teleport the world at them.
 *
 * Every entry is a real Bedrock grammar with an optional self-defaulting target.
 * A command whose target is mandatory does not belong here; nothing defaults.
 */
const SELF_TARGET = new Map([
    // `kill`, `clear`, `clearspawnpoint`: the target is the whole argument list.
    ["kill", { at: 0, absent: a => a.length === 0 }],
    ["clear", { at: 0, absent: a => a.length === 0 }],
    ["clearspawnpoint", { at: 0, absent: a => a.length === 0 }],

    // `spawnpoint [player] [x y z]` — a bare position is three arguments and no
    // player, and the game would read the first number as somebody's name.
    ["spawnpoint", {
        at: 0,
        absent: a => a.length === 0 || (a.length === 3 && a.every(isCoord))
    }],

    // `gamemode <mode> [player]`, `playsound <sound> [player] …`
    ["gamemode", { at: 1, absent: a => a.length === 1 }],
    ["playsound", { at: 1, absent: a => a.length === 1 }],

    // `xp <amount> [unit] [player]`. The unit is spelled out rather than counted,
    // so `xp 30 Steve` is left alone while `xp 30 levels` is not.
    ["xp", {
        at: a => a.length,
        absent: a => a.length === 1 || (a.length === 2 && /^(l|levels?|p|points?)$/i.test(a[1]))
    }],
    ["experience", {
        at: a => a.length,
        absent: a => a.length === 1 || (a.length === 2 && /^(l|levels?|p|points?)$/i.test(a[1]))
    }],

    // `tp`/`teleport` is the ambiguous one, and the command that started all of
    // this. `tp <destination>` teleports YOU; `tp <victim> <destination>`
    // teleports somebody else. So the victim was omitted when the first argument
    // is a coordinate, or when there is nothing after it that could be a
    // destination — `tp Steve` and `tp Steve true` both mean "send me to Steve".
    ["tp", { at: 0, absent: tpVictimOmitted }],
    ["teleport", { at: 0, absent: tpVictimOmitted }]
])

function tpVictimOmitted(args) {
    if (!args.length) return false          // invalid either way; let the game say so
    if (isCoord(args[0])) return true
    return args.length === 1 || /^(true|false)$/i.test(args[1] ?? "")
}

/**
 * Write the player in wherever the command would otherwise have defaulted to
 * whoever ran it.
 */
function withExplicitTarget(command, me) {
    const parts = tokenise(command)
    const rule = SELF_TARGET.get(String(parts[0] ?? "").toLowerCase())
    if (!rule) return command

    const args = parts.slice(1)
    if (!rule.absent(args)) return command

    const at = typeof rule.at === "function" ? rule.at(args) : rule.at
    args.splice(at, 0, me)
    return [parts[0], ...args].join(" ")
}

/** A tag no player could plausibly own, unique per invocation. */
let counter = 0
function runTag() {
    counter = (counter + 1) % 100000
    return `apx_${Date.now().toString(36)}_${counter}`
}

/**
 * Run one line once per entity, with `@s` standing for each of them in turn.
 *
 * **Why this exists: the dimension will not expand `@e`.** Every report from a
 * live world pointed the same way —
 *
 *     /exp 100                     worked   (no selector in the rebuilt line)
 *     execute at @a[tag=…,c=1]     worked   (that wrapper is in every command)
 *     kill @e[tag=…]               refused  "insufficient permissions for
 *                                            selector expansion"
 *
 * — so `dimension.runCommand` can expand `@a` and cannot expand `@e`. A command
 * whose argument is an ENTITY therefore cannot go through a rebuilt command
 * line at all, however carefully the line is written.
 *
 * The way out is to stop asking for expansion. The engine has already resolved
 * the argument, so the command is run ON each entity with `@s` in the slot:
 * `@s` names the executor and expands nothing. `Entity.runCommand` is the door,
 * and the whole point is that the entity is the origin, so there is no broad
 * selector for anything to refuse.
 *
 * Failures are counted rather than thrown: one dead mob in a list of forty is
 * not a reason to abandon the other thirty-nine.
 *
 * @returns {{ok: boolean, output: string, command: string, reason?: string}}
 */
export function runOnEach(player, line, entities) {
    const checked = mayRun(player, line)
    if (!checked.ok) return checked

    const list = [...(entities ?? [])]
    if (!list.length) {
        return { ok: false, reason: "nothing matched that selector.", command: checked.command }
    }

    let worked = 0
    let lastError = ""
    for (const entity of list) {
        try {
            const result = entity.runCommand(checked.command)
            if (Number(result?.successCount ?? 0) > 0) worked++
        } catch (e) {
            lastError = String(e).replace(/^Error: /, "")
        }
    }
    if (worked === 0) {
        return {
            ok: false,
            command: checked.command,
            reason: lastError || "the game refused it for every target — its own message is above this one"
        }
    }
    return { ok: true, output: String(worked), command: checked.command }
}

export function runAsServer(player, line) {
    const checked = mayRun(player, line)
    if (!checked.ok) return checked

    const dimension = player?.dimension ?? world.getDimension("overworld")

    // One specific player, named in a way a command can use. A tag rather than a
    // name because two people can share a name, and `@a[name=…]` would then hit
    // both. `@a`, not `@e`, because every command that takes this wants a player.
    //
    // `c=1`, NOT `limit=1`. `limit` is Java; Bedrock counts with `c`, and it
    // does not fail quietly — every command came back
    // `Syntax error: Unexpected "limit"`.
    let tag = null
    try {
        const candidate = runTag()
        player?.addTag?.(candidate)
        tag = candidate
    } catch { tag = null }
    const me = tag
        ? `@a[tag=${tag},c=1]`
        : `@a[name="${String(player?.name ?? "").replace(/"/g, "")}",c=1]`

    // `at`, never `as` — see the note at the top of this file. Two rewrites,
    // and between them nothing is left resolving against the executor: the
    // target is written in where it would have defaulted, then every @s is
    // pointed at the player rather than the server.
    const named = withExplicitTarget(checked.command, me)
    const wrapped = `execute at ${me} run ${rewriteSelf(named, me)}`
    try {
        const result = dimension.runCommand(wrapped)
        const affected = Number(result?.successCount ?? 0)
        // A command the game REFUSES does not throw. It comes back with
        // successCount 0 and writes its own complaint into chat — which meant
        // this reported a cheerful green "Ran /enchant …" directly above the
        // game's red "insufficient permissions for selector expansion", and
        // there was no way to tell from the pack which of the two was right.
        //
        // Zero is not always a failure: `/slay @e[type=cow]` with no cows
        // nearby legitimately affects nobody. So it is reported as what it is —
        // the command ran and changed nothing — rather than guessed at either
        // way.
        if (affected === 0) {
            return {
                ok: false,
                reason: "the game refused it or it matched nothing — its own message is above this one",
                command: checked.command,
                output: "0"
            }
        }
        return { ok: true, output: String(affected), command: checked.command }
    } catch (e) {
        // A command that the game refuses is normal — a typo, a bad selector,
        // nothing matched. Hand the message back rather than swallowing it.
        return { ok: false, reason: String(e).replace(/^Error: /, "") }
    } finally {
        // The tag must not outlive the command, or a later selector picks this
        // player up again.
        if (tag) { try { player.removeTag(tag) } catch { /* left, or unloaded */ } }
    }
}
