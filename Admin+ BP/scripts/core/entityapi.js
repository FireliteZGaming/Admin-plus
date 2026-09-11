import { EntityDamageCause } from "@minecraft/server"

// Doing to an entity directly what the command would have done to it.
//
// WHY. `dimension.runCommand` will not expand `@e`, so an entity argument
// cannot go through a rebuilt command line at all. The fallback — running the
// command ON each entity with `@s` through `Entity.runCommand` — gets round the
// expansion, but it buys two new problems:
//
//   * it is a full command PARSE per entity, and `/slay @e[type=zombie]` beside
//     a mob farm is hundreds of them in one tick;
//   * a mob is not an operator, so whether it may run `kill @s` at all is not
//     something to rely on.
//
// Neither problem exists if the command never becomes text. `entity.kill()` is
// one native call: no parser, no selector, no permission, and nothing to refuse.
// This is the route /gm has always taken, which is why /gm has always worked
// while every one of these fought the parser.
//
// Only commands whose whole effect is reproducible are here. A command that is
// PARTLY reproducible would be worse than none — it would look like it worked
// and quietly do less — so anything not listed falls through to the command
// route unchanged.

/** Seconds as a command writes them; ticks as the API wants them. */
const ticks = seconds => Math.max(1, Math.round(Number(seconds ?? 30) * 20))

/**
 * `EntityDamageCause` is an enum of camelCase names; the command takes
 * snake_case words. Rather than carry a mapping that would rot, the lookup is
 * done by squashing both sides — `entity_attack` and `entityAttack` both become
 * `entityattack`.
 */
const CAUSES = new Map(
    Object.values(EntityDamageCause ?? {})
        .filter(v => typeof v === "string")
        .map(v => [v.toLowerCase().replace(/[^a-z]/g, ""), v])
)
function causeFor(word) {
    if (!word) return undefined
    return CAUSES.get(String(word).toLowerCase().replace(/[^a-z]/g, ""))
}

/**
 * How to perform each command on one entity, given the arguments the engine
 * already resolved. Returning false means "not done" and the caller falls back.
 *
 * Keyed by the VANILLA command name, not the codename: the codename is what a
 * person types and can be changed on a whim; this is about what the command IS.
 */
const ROUTES = new Map([
    // /slay <targets>
    ["kill", (entity) => { entity.kill(); return true }],

    // /dmg <targets> <amount> [cause]
    ["damage", (entity, args) => {
        const amount = Number(args[1])
        if (!Number.isFinite(amount) || amount <= 0) return false
        const cause = causeFor(args[2])
        entity.applyDamage(amount, cause ? { cause } : undefined)
        return true
    }],

    // /label <targets> <add|remove|list> [name]
    ["tag", (entity, args) => {
        const action = String(args[1] ?? "").toLowerCase()
        const name = args[2]
        if (action === "add" && name) return entity.addTag(String(name)), true
        if (action === "remove" && name) return entity.removeTag(String(name)), true
        // `list` prints, and printing is the command's job rather than this
        // one's — it has a caller to report to and this does not.
        return false
    }],

    // /trigger <targets> <event>
    ["event", (entity, args) => {
        const name = String(args[1] ?? "")
        if (!name) return false
        entity.triggerEvent(name)
        return true
    }],

    // /eff <targets> <effect> [seconds] [amplifier] [hideParticles]
    ["effect", (entity, args) => {
        const which = String(args[1] ?? "").toLowerCase()
        if (!which) return false
        // `clear` is carried in the effect vocabulary so one registration can
        // reach both overloads — see the note on ENUMS.effect. There is no
        // "remove every effect" call, and clearing a list this code would have
        // to guess at would half-clear somebody while reporting success, so it
        // falls back to the command route instead.
        if (which === "clear") return false
        entity.addEffect(which, ticks(args[2]), {
            amplifier: Number.isFinite(Number(args[3])) ? Number(args[3]) : 0,
            showParticles: !args[4]
        })
        return true
    }]
])

/** Whether this command can be done without going near the parser. */
export function hasEntityRoute(commandName) { return ROUTES.has(commandName) }

/**
 * Perform `commandName` on every entity directly.
 *
 * A throw on one entity is counted, not propagated: one dead mob in a list of
 * forty is not a reason to abandon the other thirty-nine.
 *
 * @returns {{handled: boolean, affected: number}} handled false means nothing
 *   was attempted and the caller should fall back to the command route.
 */
export function runEntityRoute(commandName, entities, args) {
    const route = ROUTES.get(commandName)
    if (!route) return { handled: false, affected: 0 }

    const list = [...(entities ?? [])]
    if (!list.length) return { handled: false, affected: 0 }

    let affected = 0
    for (const entity of list) {
        try { if (route(entity, args)) affected++ } catch { /* died, or no such component */ }
    }
    // Not one of them worked. Either the arguments do not suit this route
    // (`/label … list`, which has nothing to return a list TO) or the route is
    // wrong about what it can do. Falling back costs a command parse and is
    // always safe; reporting a confident zero is not.
    if (affected === 0) return { handled: false, affected: 0 }
    return { handled: true, affected }
}

export { ROUTES as ENTITY_ROUTES }
