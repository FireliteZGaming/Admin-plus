import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { record } from "../core/logs.js"
import { runAsServer, checkCommand } from "../core/execute.js"
import { COMMANDS, ENUMS, SELECTOR_TYPES } from "../core/vanillaparams.js"

// /a:z<command> — the vanilla command set, typed, without operator.
//
// One registration per command, because a registration has one fixed parameter
// list and a single /cmd could therefore never be `EntitySelector` for kill and
// `Location BlockType` for setblock at the same time. See core/vanillaparams.js
// for the table and the reasoning.
//
// The gain is that the GAME does the parsing: `/a:zkill @e[` opens the engine's
// own selector completion with every filter it supports, item and block names
// complete, and a bad argument is refused before any of this code runs.
//
// Everything still goes through runAsServer, so all three of the properties
// that made /cmd worth building survive: it runs at operator level for somebody
// who does not hold operator, the live `commands.allowed` list still decides
// what may run, and every call is logged and announced. Same power, written
// down.

const P = CustomCommandParamType
/**
 * The prefix every vanilla passthrough carries: `/a:zkill`, `/a:zgive`.
 *
 * It is a "z" because the in-game command list is sorted ALPHABETICALLY and
 * there is nowhere else to put these. A pack gets one namespace, so all 56 sit
 * in the same list as the pack's own 49; "z" is the only prefix that puts every
 * one of them below every one of ours, whose names run from admin to warps.
 *
 * It also sidesteps a collision for free: this pack already owns /a:tp, and
 * vanilla has a tp of its own. /a:ztp is nobody else's.
 */
const PREFIX = "z"

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
    // z_ prefixed for the same reason the commands are, and because the pack
    // already defines an enum called "gamemode" for /gm.
    enumName[key] = defineEnum(`z_${key}`, values)
}

/**
 * Turn one resolved argument back into command text.
 *
 * Selectors are the case worth explaining. The game hands back resolved
 * `Entity[]` / `Player[]` rather than the text that was typed, so the selector
 * cannot be pasted back — every entity gets a one-shot tag instead and the line
 * targets `@e[tag=…]`.
 *
 * That is better than the text would have been: the set is resolved ONCE, so
 * `@e[type=cow,c=3]` acts on exactly the three cows the game picked, and cannot
 * quietly re-resolve to a different three when the command runs a tick later.
 *
 * @returns {string|undefined} text, or undefined if this argument is absent
 */
function render(value, type, tag, cleanup) {
    if (value === undefined || value === null) return undefined

    if (SELECTOR_TYPES.has(type)) {
        const list = Array.isArray(value) ? value : [value]
        if (!list.length) return undefined
        for (const entity of list) {
            try { entity.addTag(tag); cleanup.push(entity) } catch { /* already gone */ }
        }
        return `@e[tag=${tag}]`
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
    const parts = [spec.name]
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
        const entry = type === P.Enum
            ? { name: enumName[enumKey], type }
            : { name, type }
        ;(isOptional ? optional : mandatory).push(entry)
    }

    command({
        name: `${PREFIX}${spec.name}`,
        group: "vanilla",
        description: `${spec.help} — operator-level, logged`,
        perm: "admin.commands",
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
