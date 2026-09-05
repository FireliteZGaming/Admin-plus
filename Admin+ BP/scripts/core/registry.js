import { system, Player, CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server"
import { CONFIG, NS } from "../config.js"
import { has } from "./ranks.js"

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
        try {
            customCommandRegistry.registerCommand({
                name: fullName,
                description: spec.description ?? `Admin+ ${spec.name}`,
                permissionLevel: CommandPermissionLevel.Any,
                cheatsRequired: false,
                mandatoryParameters: spec.mandatory ?? [],
                optionalParameters: spec.optional ?? []
            }, (origin, ...args) => {
                const player = origin.sourceEntity
                if (!(player instanceof Player)) {
                    return deny("This command can only be run by a player.")
                }
                if (spec.perm && !has(player, spec.perm)) {
                    return deny("You don't have permission to use that.")
                }
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
