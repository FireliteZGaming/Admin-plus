import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { record } from "../core/logs.js"
import { runAsServer, checkCommand } from "../core/execute.js"
import { COMMANDS, ENUMS, SELECTOR_TYPES, codenameFor } from "../core/vanillaparams.js"

// The vanilla command set, typed, without operator.
//
// One registration per command, because a registration has one fixed parameter
// list and a single /cmd could therefore never be `EntitySelector` for kill and
// `Location BlockType` for setblock at the same time. See core/vanillaparams.js
// for the table and the reasoning.
//
// The gain is that the GAME does the parsing: item and block names complete,
// enums offer their vocabulary, and a bad argument is refused before any of
// this code runs. Selector arguments are the exception and it is a deliberate
// one — see render() below.
//
// Everything still goes through runAsServer, so all three of the properties
// that made /cmd worth building survive: it runs at operator level for somebody
// who does not hold operator, the live `commands.allowed` list still decides
// what may run, and every call is logged and announced. Same power, written
// down.

const P = CustomCommandParamType

// The `z` prefix is GONE as of 2.1.15 — `/a:zkill` is now `/a:kill`. See
// CODENAME in core/vanillaparams.js for every name and the reasoning.
//
// The prefix bought exactly one thing: the in-game command list is sorted
// alphabetically, and "z" pushed all 56 of these below the pack's own, whose
// names run from admin to warps. That is a real convenience and it is now
// gone; the 56 interleave. It was not worth a leading letter of noise on
// every name, and the only genuine COLLISION with the pack's own commands was
// `tp`, which CODENAME handles by itself.

/**
 * Registered enum names, keyed by the short name used in the table.
 *
 * In the pack's own namespace, because there is no other one to be in. Giving
 * these their own `cmd:` was tried and refused twice over: registerEnum itself
 * would not take a second namespace, and commands carrying no enums at all were
 * refused with the same error. A pack gets one namespace.
 */
const enumName = {}
for (const [key, values] of Object.entries(ENUMS)) {
    // z_ prefixed because the pack already defines an enum called "gamemode"
    // for /gm and the two would collide. The COMMANDS dropped their z in
    // 2.1.15; these keep theirs, because an enum name is internal — nobody
    // ever types it — so renaming would be a registration change with nothing
    // to show for it.
    enumName[key] = defineEnum(`z_${key}`, values)
}

/**
 * Turn one argument back into command text.
 *
 * Selectors are the case worth explaining, and it changed in 2.1.13.
 *
 * They used to be registered as `EntitySelector`/`PlayerSelector` so the engine
 * would resolve them and hand back `Entity[]`, which the pack tagged and pasted
 * back as `@e[tag=…]`. **That cannot work for the people this feature exists
 * for.** The engine expands a custom command's selector argument at the
 * CALLER's permission level, so `/a:zkill @p` was refused with *insufficient
 * permissions for selector expansion* before this file's handler ever ran —
 * which is exactly the audience `/a:z*` is for: somebody with a rank and no op.
 *
 * So the selector is taken as TEXT and pasted straight into the line. The
 * dimension expands it when the command runs, at operator level, which is the
 * same mechanism everything else here already leans on.
 *
 * The cost is real and worth naming: the engine's selector auto-completion is
 * gone for these arguments, and the set now resolves when the command runs
 * rather than when it was typed. A command that cannot run is worth less than
 * one without completion.
 *
 * @returns {string|undefined} text, or undefined if this argument is absent
 */
function render(value, type, tag, cleanup) {
    if (value === undefined || value === null) return undefined

    if (SELECTOR_TYPES.has(type)) {
        // Never quoted: `"@e[type=cow]"` is a name, not a selector. A selector
        // carrying spaces has to arrive quoted to survive the game's own
        // tokeniser, and the quotes come back off here.
        const text = String(value).trim().replace(/^"(.*)"$/s, "$1")
        return text || undefined
    }

    if (type === P.Location) {
        const { x, y, z } = value
        if ([x, y, z].some(n => typeof n !== "number" || !Number.isFinite(n))) return undefined
        return `${x} ${y} ${z}`
    }

    if (type === P.ItemType || type === P.BlockType || type === P.EntityType) {
        return value.id ?? String(value)
    }

    if (type === P.Boolean) return value ? "true" : "false"
    if (type === P.Integer || type === P.Float) return String(value)

    // String and Enum. A value carrying spaces has to be quoted or it becomes
    // two arguments on the way back into the game.
    const text = String(value)
    return /\s/.test(text) ? JSON.stringify(text) : text
}

/**
 * Build the whole line.
 *
 * Stops at the first absent argument. Bedrock fills optional parameters
 * positionally, so a later one cannot be present when an earlier one is missing
 * — and if that ever stopped being true, emitting a gap would produce a
 * malformed command rather than a wrong one, which is the better failure.
 */
export function buildLine(spec, args, tag, cleanup = []) {
    // `fixed` is literal words the command needs but nobody should have to
    // type, emitted straight after the name. /replaceitem is the reason: its
    // grammar is `replaceitem entity <target> …` and `replaceitem block
    // <pos> …`, where the second word chooses between two different overloads
    // rather than carrying any information the caller supplies. Registering it
    // as a parameter would mean offering a choice with exactly one valid
    // answer.
    const parts = [spec.name, ...(spec.fixed ?? [])]
    const params = spec.params ?? []
    for (let i = 0; i < params.length; i++) {
        const piece = render(args[i], params[i][1], tag, cleanup)
        if (piece === undefined) break
        parts.push(piece)
    }
    return parts.join(" ")
}

/** A tag no player could plausibly own, unique per invocation. */
let counter = 0
export function tempTag() {
    counter = (counter + 1) % 100000
    return `apcmd_${Date.now().toString(36)}_${counter}`
}

for (const spec of COMMANDS) {
    const mandatory = []
    const optional = []
    for (const [name, type, isOptional, enumKey] of spec.params ?? []) {
        // Bedrock links an Enum parameter to its values BY NAME: the parameter's
        // name must be the registered enum's namespaced name, not a label of our
        // choosing. Getting this wrong registers a command whose enum silently
        // offers nothing.
        // A selector is registered as a STRING. Registering it as
        // EntitySelector makes the ENGINE expand it, and it does that at the
        // caller's permission level — so `/a:zkill @p` was refused outright for
        // anybody without op, which is everybody this command set is for. See
        // render() above.
        const entry = type === P.Enum
            ? { name: enumName[enumKey], type }
            : { name, type: SELECTOR_TYPES.has(type) ? P.String : type }
        ;(isOptional ? optional : mandatory).push(entry)
    }

    const registered = codenameFor(spec.name)
    command({
        name: registered,
        group: "vanilla",
        // Name the vanilla command when the registration is called something
        // else, so `/a:count` says out loud that it is `testfor` and nobody
        // has to come and read this file to find that out.
        description: registered === spec.name
            ? `${spec.help} — operator-level, logged`
            : `${spec.help} (vanilla /${spec.name}) — operator-level, logged`,
        mandatory,
        optional,
        run: (player, args) => {
            // The live allowlist is still the authority. The command exists as a
            // registration either way, so this is what keeps `commands.allowed`
            // meaningful — an owner who removes `summon` from the list stops it
            // running even though /a:zsummon is still a word the game knows.
            const gate = checkCommand(spec.name)
            if (!gate.ok) return err(player, gate.reason)

            const tag = tempTag()
            const cleanup = []
            try {
                const line = buildLine(spec, args, tag, cleanup)
                const result = runAsServer(player, line)
                if (!result.ok) return err(player, result.reason)
                ok(player, `Ran §f/${result.command}§a.`)
                record(player, "admin.cmd", undefined, result.command)
            } finally {
                // The tag must not outlive the command, or a later selector
                // would pick these entities up again. Entities the command
                // killed are gone and throw here, which is fine.
                for (const entity of cleanup) {
                    try { entity.removeTag(tag) } catch { /* died or unloaded */ }
                }
            }
        }
    })
}

export { COMMANDS }
