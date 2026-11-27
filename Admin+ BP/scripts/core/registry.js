import {
    system, Player, CommandPermissionLevel, CustomCommandStatus,
    CustomCommandParamType as P
} from "@minecraft/server"
import { CONFIG, NS } from "../config.js"
import { has } from "./ranks.js"
import { resolveSelector, SELECTOR_HINT } from "./selector.js"
import { noteCommand } from "./cmdlog.js"
import { askFor, askable } from "./ask.js"

// Native slash commands.
//
// Bedrock rules this file exists to encapsulate:
//   1. A custom command MUST be registered namespaced ("a:admin"). The bare
//      form (/admin) still works at the keyboard while nothing else claims it.
//   2. A command callback runs in a READ-ONLY context: it may not change the
//      world or show a form. Every handler is deferred a tick with system.run().
//   3. A command takes at most EIGHT parameters. Over that the registration is
//      refused and the command silently does not exist.
//   4. A pack gets exactly ONE namespace, enums included. `group` on a spec is
//      a label for screens that list commands, never a namespace.
//
// permissionLevel stays Any and cheatsRequired false. Ranks decide access
// through the Admin+ permission node, not operator status.
//
// THE THREE RULES every command gets from here, so no two can differ:
//   - Leave an argument off and it is asked for (core/ask.js). A spec's
//     `mandatory` list means "needed", not "must be typed".
//   - A player argument offers the game's own player list. `picker: false`
//     opts a command out, back to typed text.
//   - A `rest: true` text argument takes a plain sentence, no quotes.

const PARAM_LIMIT = 8
const pending = []
const enums = []

/**
 * @param {{
 *   name: string, description?: string, perm?: string, group?: string,
 *   picker?: boolean,
 *   mandatory?: Param[], optional?: Param[],
 *   run: (player: Player, args: any[]) => any
 * }} spec
 *
 * @typedef {{
 *   name: string, type: any,
 *   rest?: boolean,       last String parameter only: takes a whole sentence
 *   ask?: (player: Player) => Promise<any>,   own prompt, in the handler's shape
 *   label?: string,       the question the default prompt asks
 *   placeholder?: string, greyed example text in a text prompt
 *   choices?: string[],   the Enum values worth a button, when not all are
 *   self?: boolean,       include the asker in the player pick list
 *   only?: (player: Player, asker: Player) => boolean   narrow that list
 *   empty?: string        what to say when that list has nobody in it
 * }} Param
 */
export function command(spec) { pending.push(spec) }

/**
 * One check every command passes before it runs, after its permission: a
 * function given the player and the command's name that answers true, false,
 * or a promise of either. Set once, by features/terms.js (3.1.6).
 */
let gate = null
export function setCommandGate(fn) { gate = typeof fn === "function" ? fn : null }

/** Every command spec, whole. core/dispatch.js runs them from typed text. */
export function commandSpecs() { return [...pending] }

/**
 * The names of every command in a group (omit for ungrouped), sorted. Derived,
 * because a hand-typed list goes stale.
 */
export function registeredCommands(group) {
    return pending
        .filter(spec => (spec.group ?? undefined) === group)
        .map(spec => spec.name)
        .sort()
}

/**
 * Declare the value set for an Enum parameter, which is what makes it
 * tab-complete. A parameter references it by using the returned name as its
 * own `name`, with type Enum.
 * @returns {string} the namespaced enum name
 */
export function defineEnum(shortName, values) {
    const name = `${NS}:${shortName}`
    enums.push({ name, values })
    return name
}

function deny(reason) {
    return { status: CustomCommandStatus.Failure, message: CONFIG.brand.err + reason }
}

function isEmpty(value) {
    return value === undefined || value === null || value === ""
        || (Array.isArray(value) && !value.length)
}

// ------------------------------------------------------------ selector types

const SELECTOR_TYPES = new Set([P.PlayerSelector, P.EntitySelector])

/**
 * A selector parameter is expanded by the ENGINE at the command's declared
 * permission level, which is `Any` here, so every `@` form is refused before
 * the handler runs. A literal name gets through. Two answers, per command:
 *
 *   picker (the default)  keep the real type. The game offers its player list
 *                         and a picked name works. `@` forms do not.
 *   picker: false         hand the engine plain text and resolve it here with
 *                         core/selector.js. `me`, `all` and `@a` work, and
 *                         there is no list.
 *
 * The spec is never mutated: core/dispatch.js reads the original types.
 */
function usesPicker(spec) { return spec.picker !== false }

/**
 * The name a text-typed selector carries, since the name is the only hint left
 * on screen while the argument is being typed. A needed slot must say `me` has
 * to be typed; an optional one may say leaving it off means you.
 */
function selectorName(name, required) {
    return required ? `${name}_me_or_all` : `${name}_or_me`
}

function forEngine(params, picker, required) {
    if (picker) return [...(params ?? [])]
    return (params ?? []).map(p => SELECTOR_TYPES.has(p.type)
        ? { name: selectorName(p.name, required), type: P.String }
        : p)
}

/** Which argument slots arrive as text and must reach the handler as entities. */
function selectorSlots(spec) {
    if (usesPicker(spec)) return []
    return [...(spec.mandatory ?? []), ...(spec.optional ?? [])]
        .map((p, i) => SELECTOR_TYPES.has(p.type)
            ? { i, name: p.name, playersOnly: p.type === P.PlayerSelector }
            : undefined)
        .filter(Boolean)
}

// -------------------------------------------------------------- engine shape

/** Does this command ask for what it was not given? */
function asks(spec) {
    return (spec.mandatory ?? []).every(askable)
}

/**
 * What Bedrock is told about a command's parameters.
 *
 * A command that asks registers everything as optional, because the engine
 * refuses a command outright when a mandatory parameter is absent and the
 * handler would never get the chance to ask.
 *
 * A `rest` parameter is followed by spare word slots up to the eight-parameter
 * cap: Bedrock's String takes one word unless quoted, so a sentence arrives as
 * several arguments and is joined back together before the handler sees it.
 *
 * @returns {{mandatory: Param[], optional: Param[], rest: number, problem?: string}}
 */
function engineShape(spec) {
    const declared = [...(spec.mandatory ?? []), ...(spec.optional ?? [])]
    const mandatory = forEngine(spec.mandatory, usesPicker(spec), true)
    const optional = forEngine(spec.optional, usesPicker(spec), false)

    let rest = declared.findIndex(p => p.rest)
    let problem
    if (rest !== -1 && (rest !== declared.length - 1 || declared[rest].type !== P.String)) {
        problem = `"${declared[rest].name}" is marked rest but is not the last String parameter`
        rest = -1
    }
    const words = rest === -1 ? [] : Array.from(
        { length: PARAM_LIMIT - declared.length },
        (_, i) => ({ name: `word${i + 2}`, type: P.String }))

    return asks(spec)
        ? { mandatory: [], optional: [...mandatory, ...optional, ...words], rest, problem }
        : { mandatory, optional: [...optional, ...words], rest, problem }
}

/** Ask for each missing argument in turn. False when the player backs out. */
async function fill(player, spec, args, missing) {
    for (const i of missing) {
        const param = spec.mandatory[i]
        const values = enums.find(e => e.name === param.name)?.values
        const value = await askFor(player, spec, param, values)
        if (isEmpty(value)) return false
        args[i] = value
    }
    return true
}

// -------------------------------------------------------------- registration

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    // Enums must exist before any command references one.
    for (const { name, values } of enums) {
        try {
            customCommandRegistry.registerEnum(name, values)
        } catch (e) {
            console.error(`[Admin+] failed to register enum ${name}: ${e}`)
        }
    }

    for (const spec of pending) {
        const fullName = `${NS}:${spec.name}`
        const declared = (spec.mandatory?.length ?? 0) + (spec.optional?.length ?? 0)
        if (declared > PARAM_LIMIT) {
            console.error(`[Admin+] /${fullName} asks for ${declared} parameters; Bedrock allows ${PARAM_LIMIT}. It has NOT been registered - shorten it.`)
            continue
        }

        const shape = engineShape(spec)
        if (shape.problem) console.error(`[Admin+] /${fullName}: ${shape.problem}`)
        const slots = selectorSlots(spec)
        const asking = asks(spec)

        try {
            customCommandRegistry.registerCommand({
                name: fullName,
                description: spec.description ?? `Admin+ ${spec.name}`,
                permissionLevel: CommandPermissionLevel.Any,
                cheatsRequired: false,
                mandatoryParameters: shape.mandatory,
                optionalParameters: shape.optional
            }, (origin, ...args) => {
                const player = origin.sourceEntity
                if (!(player instanceof Player)) {
                    return deny("This command can only be run by a player.")
                }

                // Every command is logged from here, the one place they all
                // pass through. Captured first: the steps below replace text
                // with entities, and the log wants what was typed.
                const typed = [...args]
                if (spec.perm && !has(player, spec.perm)) {
                    noteCommand(player, spec.name, typed, "no permission")
                    return deny("You don't have permission to use that.")
                }

                // A sentence arrived as separate words; hand over one string.
                if (shape.rest !== -1) {
                    const words = args.slice(shape.rest).filter(w => typeof w === "string" && w.length)
                    args.length = declared
                    args[shape.rest] = words.length ? words.join(" ") : undefined
                }

                // Text-typed selectors become entities. An empty slot stays
                // undefined, because that is how /gm and friends mean "me".
                for (const slot of slots) {
                    const text = args[slot.i]
                    if (isEmpty(text)) continue
                    const found = resolveSelector(text, player, slot.playersOnly)
                    if (!found.ok || !found.entities.length) {
                        noteCommand(player, spec.name, typed, `nothing matched "${text}"`)
                        return deny(found.reason ?? `nothing matched "${text}". ${SELECTOR_HINT}`)
                    }
                    args[slot.i] = found.entities
                }

                noteCommand(player, spec.name, typed)
                const missing = asking
                    ? (spec.mandatory ?? []).map((_, i) => i).filter(i => isEmpty(args[i]))
                    : []

                // Hop out of the read-only context before touching anything.
                system.run(() => {
                    // Most handlers are async, and a rejected promise sails past
                    // a plain try/catch. Catch both shapes.
                    const report = (e) => {
                        player.sendMessage(CONFIG.brand.prefix + CONFIG.brand.err + `Command failed: ${e}`)
                        console.error(`[Admin+] /${fullName} failed: ${e}\n${e?.stack ?? ""}`)
                    }
                    const run = () => {
                        try {
                            const result = spec.run(player, args)
                            if (result && typeof result.then === "function") result.then(undefined, report)
                        } catch (e) {
                            report(e)
                        }
                    }
                    const go = () => {
                        if (!missing.length) return run()
                        fill(player, spec, args, missing).then(filled => { if (filled) run() }, report)
                    }
                    // The gate (3.1.6, features/terms.js): an owner who hasn't
                    // accepted Admin+'s terms sees them first, and the command
                    // runs only once they accept.
                    const pass = gate ? gate(player, spec.name) : true
                    if (pass === true) return go()
                    Promise.resolve(pass).then(yes => { if (yes === true) go() }, report)
                })
                return { status: CustomCommandStatus.Success }
            })
        } catch (e) {
            console.error(`[Admin+] failed to register /${fullName}: ${e}`)
        }
    }
})
