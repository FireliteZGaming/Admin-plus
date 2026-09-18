import {
    system, Player, CommandPermissionLevel, CustomCommandStatus,
    CustomCommandParamType as P
} from "@minecraft/server"
import { CONFIG, NS } from "../config.js"
import { has } from "./ranks.js"
import { resolveSelector, SELECTOR_HINT } from "./selector.js"
import { noteCommand } from "./cmdlog.js"

// Native slash commands.
//
// Two Bedrock rules this file exists to encapsulate:
//   1. A custom command MUST be registered namespaced ("admin:admin"). The bare
//      form (/admin) still works at the keyboard as long as nothing else claims
//      that name — which is why every command here is named for bare use.
//   2. A command callback runs in a READ-ONLY context: it may not mutate the
//      world and may not show a form. Anything real has to be deferred one tick
//      with system.run(), so `run` handlers here are always called deferred.
//
// permissionLevel is left at Any and cheatsRequired false; gating is done by the
// Admin+ permission node instead, so ranks — not op status — decide access.

const pending = []
const enums = []

/**
 * @param {{
 *   name: string, description?: string, perm?: string, group?: string,
 *   mandatory?: {name: string, type: any}[],
 *   optional?: {name: string, type: any}[],
 *   run: (player: Player, args: any[]) => string | void
 * }} spec
 *
 * `group` only labels a command for screens that list them. It is NOT a
 * namespace: **a pack gets exactly one**, and trying to give the vanilla
 * passthroughs their own `cmd:` cost two releases to disprove. Bedrock refuses
 * `registerEnum` outright for a second namespace —
 *
 *     Custom Command depends on one or more unknown enums [cmd:musicop]
 *     Custom Command Enum namespaces must match. Namespace 'cmd' does not
 *     match existing namespace 'a'.
 *
 * — and refuses commands carrying no enums at all for the same reason. So
 * everything lives under one namespace and grouping is done by NAME.
 */
export function command(spec) { pending.push(spec) }

/**
 * Every command this pack declares, for screens that list them.
 *
 * Generated rather than written out, because the hand-typed list on the About
 * screen had gone stale: it named 19 of 51 and still advertised commands that
 * had been renamed. A list of what exists should be derived from what exists.
 *
 * @param {string} [group] only commands in this group; omit for ungrouped
 */
/**
 * Every command spec, whole — name, perm, typed parameters and handler.
 *
 * registeredCommands() returns only NAMES, which is all a listing screen wants.
 * The console needs the rest: to run "gm creative Steve" it has to know that
 * `player` is a PlayerSelector and hand the handler entities rather than
 * the word. See core/dispatch.js.
 */
export function commandSpecs() { return [...pending] }

export function registeredCommands(group) {
    return pending
        .filter(spec => (spec.group ?? undefined) === group)
        .map(spec => spec.name)
        .sort()
}

/**
 * Declare a value set for an Enum parameter. Enums are what give a command
 * tab-completion over its own vocabulary (the gamemode names, for instance)
 * instead of a free-text string the player has to spell correctly.
 *
 * The enum name must be namespaced, and a parameter references it by putting
 * that name in the parameter's `name` field with type Enum.
 * @returns {string} the namespaced enum name, ready to use as a parameter name
 */
export function defineEnum(shortName, values) {
    const name = `${NS}:${shortName}`
    enums.push({ name, values })
    return name
}

function deny(reason) {
    return { status: CustomCommandStatus.Failure, message: CONFIG.brand.err + reason }
}

const SELECTOR_TYPES = new Set([P.PlayerSelector, P.EntitySelector])

/**
 * **No command this pack registers may declare a selector parameter.**
 *
 * A parameter registered as `PlayerSelector` or `EntitySelector` is expanded by
 * the ENGINE, at the command's declared permission level — and this registry
 * declares `Any` for everything, deliberately, because Admin+ exists to be
 * usable by people who are not operators. So every `@` form is refused before
 * the handler is ever called, with a bare `<insufficient permissions for
 * selector expansion>` that names nothing.
 *
 * It looked random for months because the two commonest cases are the two that
 * work: a literal name gets through, and leaving an optional argument off gets
 * through. Only `@s`, `@p`, `@a` fail. `/tp` was fixed at the call site in
 * 2.1.21 and the 54 vanilla passthroughs in their own file — and main.js said
 * out loud that roughly two dozen of the pack's own commands were still wrong.
 * `/vanish` was reported from a world, which is the whole two dozen.
 *
 * Fixing it HERE instead of in 23 handlers is what stops it coming back: a
 * command that declares a selector now gets plain text at the engine and the
 * resolved entities at the handler, so handlers are untouched and a new
 * command cannot reintroduce the bug by declaring the natural-looking type.
 *
 * The spec object itself is never mutated — core/dispatch.js reads the ORIGINAL
 * types out of commandSpecs() to do its own resolution for the console.
 */
/**
 * **`picker: true` opts a command OUT of that, and back into the game's own
 * target picker.** Asked for by name, 2026-09-12: *"put player selectors for
 * mute, warn and those things so people can actually use them."*
 *
 * What it buys: typing `/mute ` pops the game's list of online players, so a
 * moderator picks a gamertag instead of spelling one. What it costs is the
 * whole paragraph above — the `@` forms go back to being refused on that
 * command, because the picker and the refusal are the same registration.
 *
 * A NAME chosen from that list still works, which is why the trade is worth
 * making on moderation commands specifically: naming one person is what they
 * are for, and `/mute @a` is not a thing anybody needs. It is deliberately not
 * the default, so a command that wants to act on a group keeps working.
 */
/**
 * The suffix a downgraded selector parameter carries.
 *
 * The parameter NAME is the only surface left that can say what goes in the
 * slot: the description is off-screen by the time you are filling the argument
 * in, and the engine no longer offers `@a @e @p` as you type.
 *
 * **Mandatory and optional need different words, and getting that wrong is how
 * `/eff` became unusable without asking somebody.** `targets_or_me` on a
 * REQUIRED slot reads as "name some targets, or leave it out for me" — and
 * leaving it out is exactly what you cannot do. The word `me` has to be typed.
 * On an OPTIONAL slot that same name is honest, because omitting it really
 * does mean you.
 */
function selectorName(name, required) {
    return required ? `${name}_me_or_all` : `${name}_or_me`
}

function forEngine(params, picker, required) {
    if (picker) return params ?? []
    return (params ?? []).map(p => SELECTOR_TYPES.has(p.type)
        ? { name: selectorName(p.name, required), type: P.String }
        : p)
}

/** Which argument slots were selectors, and whether each was players-only. */
function selectorSlots(spec) {
    // A picker command keeps the real type, so the ENGINE expands it and the
    // handler already receives entities. Resolving here too would try to treat
    // an array of players as a piece of text.
    if (spec.picker) return []
    return [...(spec.mandatory ?? []), ...(spec.optional ?? [])]
        .map((p, i) => SELECTOR_TYPES.has(p.type)
            ? { i, name: p.name, playersOnly: p.type === P.PlayerSelector }
            : undefined)
        .filter(Boolean)
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    // Enums must exist before any command references one.
    for (const { name, values } of enums) {
        try {
            customCommandRegistry.registerEnum(name, values)
        } catch (e) {
            console.error(`[Admin+] failed to register enum ${name}: ${e}`)
        }
    }

    // Bedrock caps a custom command at eight parameters and REFUSES the whole
    // registration above that - the command then simply does not exist, with
    // only a line in the content log to say so. /broadcast shipped broken in
    // 0.32.0 for exactly this reason. Catch it here, loudly, rather than
    // letting the game drop the command on the floor.
    const PARAM_LIMIT = 8
    for (const spec of pending) {
        const fullName = `${NS}:${spec.name}`
        const paramCount = (spec.mandatory?.length ?? 0) + (spec.optional?.length ?? 0)
        if (paramCount > PARAM_LIMIT) {
            console.error(`[Admin+] /${fullName} asks for ${paramCount} parameters; Bedrock allows ${PARAM_LIMIT}. It has NOT been registered - shorten it.`)
            continue
        }
        const slots = selectorSlots(spec)
        try {
            customCommandRegistry.registerCommand({
                name: fullName,
                description: spec.description ?? `Admin+ ${spec.name}`,
                permissionLevel: CommandPermissionLevel.Any,
                cheatsRequired: false,
                mandatoryParameters: forEngine(spec.mandatory, spec.picker, true),
                optionalParameters: forEngine(spec.optional, spec.picker, false)
            }, (origin, ...args) => {
                const player = origin.sourceEntity
                if (!(player instanceof Player)) {
                    return deny("This command can only be run by a player.")
                }
                // Every command is logged from HERE, which is the one place all
                // of them pass through. Doing it per-command is how a command
                // ends up unlogged: there is nothing to remember, and anything
                // registered later is covered the moment it exists.
                //
                // Captured BEFORE the selector loop below, because that loop
                // replaces a slot's text with entity objects and the text is
                // what a person typed.
                const typed = [...args]
                if (spec.perm && !has(player, spec.perm)) {
                    noteCommand(player, spec.name, typed, "no permission")
                    return deny("You don't have permission to use that.")
                }
                // Selector slots arrive as text and reach the handler as
                // entities — see forEngine. A slot left empty stays undefined,
                // because "no argument" is how /vanish and friends mean "me",
                // and turning that into an empty array would break them.
                for (const slot of slots) {
                    const text = args[slot.i]
                    if (text === undefined || text === null || text === "") continue
                    const found = resolveSelector(text, player, slot.playersOnly)
                    if (!found.ok || !found.entities.length) {
                        noteCommand(player, spec.name, typed, `nothing matched "${text}"`)
                        return deny(found.reason ?? `nothing matched "${text}". ${SELECTOR_HINT}`)
                    }
                    args[slot.i] = found.entities
                }
                noteCommand(player, spec.name, typed)
                // Hop out of the read-only context before touching anything.
                system.run(() => {
                    // Most handlers are async (every panel screen returns a
                    // promise), and a rejected promise sails straight past a
                    // plain try/catch — the player would see nothing at all
                    // when a form path throws. Catch both shapes.
                    const report = (e) => {
                        player.sendMessage(CONFIG.brand.prefix + CONFIG.brand.err + `Command failed: ${e}`)
                        console.error(`[Admin+] /${fullName} failed: ${e}\n${e?.stack ?? ""}`)
                    }
                    try {
                        const result = spec.run(player, args)
                        if (result && typeof result.then === "function") result.then(undefined, report)
                    } catch (e) {
                        report(e)
                    }
                })
                return { status: CustomCommandStatus.Success }
            })
        } catch (e) {
            console.error(`[Admin+] failed to register /${fullName}: ${e}`)
        }
    }
})
