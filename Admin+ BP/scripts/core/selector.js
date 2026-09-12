import { world, GameMode } from "@minecraft/server"
import { displayName } from "./identity.js"

// Resolving `@e[type=cow,r=10]` ourselves, without asking the command parser.
//
// WHY THIS EXISTS, and it is the answer to a two-day hunt.
//
// A custom command parameter registered as EntitySelector or PlayerSelector is
// expanded BY THE ENGINE, at the command's declared permission level — and this
// pack registers everything at `Any`, because the whole point is to hand power
// to people who do not hold operator. So every `@` form is refused there:
//
//     <insufficient permissions for selector expansion>
//
// printed with NO `[Admin+]` prefix, because it happens before the handler
// runs. That last detail is what finally identified it: the pack's own error
// messages are prefixed, and this one was bare.
//
// Nothing downstream can help with that. The `@a`-vs-`@e` rule, running per
// entity with `@s`, the direct script-API routes in entityapi.js — all correct,
// all reached only if the handler starts, and it does not.
//
// A literal NAME works, because a name is not a selector and needs no
// expansion. That is why `/exp 100 Steve` succeeded while `/slay @e[…]` never
// began.
//
// So selectors come in as plain text and are resolved here instead, through
// `dimension.getEntities()` — the script API's own query, which is the route
// `/gm` has always taken and the reason `/gm` has always worked. No parser, no
// permission, nothing to refuse.
//
// THE COST, stated plainly: the game no longer offers `@a @e @p @r @s` as you
// type. That was traded away once before in 2.1.13 and put back in 2.1.16
// because a blank text box is no use to somebody who does not know selector
// syntax. It has to go back, because the alternative is a picker that offers
// five selectors and refuses all five, which is worse than one that offers
// none. The command descriptions carry the vocabulary instead.

/**
 * Find a player by what somebody TYPED, which is not always their gamertag.
 *
 * Nicknames are the reason. Admin+ shows a nicknamed player as their nickname
 * everywhere — the list, the nametag, chat — so that is the name staff read off
 * the screen and type back in. Matching only the gamertag meant `/eff Starlight
 * speed` answered "nobody here is called Starlight" about somebody standing in
 * front of them wearing exactly that name.
 *
 * The gamertag wins when both could match. It is the name that cannot be
 * changed by the person answering to it, so if one player's gamertag is another
 * player's nickname, the gamertag is the safer read — and a moderator typing a
 * gamertag they looked up in the ban list must never reach somebody else.
 *
 * Nicknames are compared with their formatting codes stripped, because the
 * codes are not something anybody can type: displayName() already returns the
 * plain form, which is also what was on screen.
 *
 * Several matches come back as several. A shared nickname is a real situation
 * and the caller already reports how many it affected; silently picking one of
 * two people would be the worse answer.
 */
function playerNamed(name) {
    const wanted = String(name).toLowerCase()
    const everyone = world.getAllPlayers()
    const byGamertag = everyone.filter(p => p.name.toLowerCase() === wanted)
    if (byGamertag.length) return byGamertag
    return everyone.filter(p => displayName(p).toLowerCase() === wanted)
}

/**
 * Split `type=cow,family=!monster,r=10` on commas that are NOT inside a nested
 * brace or bracket — `scores={a=1,b=2}` has to survive as one filter.
 */
function splitFilters(body) {
    const out = []
    let depth = 0, current = ""
    for (const ch of body) {
        if (ch === "{" || ch === "[") depth++
        else if (ch === "}" || ch === "]") depth--
        else if (ch === "," && depth === 0) { out.push(current); current = ""; continue }
        current += ch
    }
    if (current.trim()) out.push(current)
    return out.map(s => s.trim()).filter(Boolean)
}

/** `minecraft:` is optional everywhere a type is written; the API wants it. */
function namespaced(id) {
    const text = String(id).trim()
    return text.includes(":") ? text : `minecraft:${text}`
}

const GAME_MODES = {
    survival: GameMode?.Survival, s: GameMode?.Survival, 0: GameMode?.Survival,
    creative: GameMode?.Creative, c: GameMode?.Creative, 1: GameMode?.Creative,
    adventure: GameMode?.Adventure, a: GameMode?.Adventure, 2: GameMode?.Adventure,
    spectator: GameMode?.Spectator, 3: GameMode?.Spectator
}

/**
 * Turn the filters inside `[...]` into EntityQueryOptions.
 *
 * Only filters with a real equivalent are honoured. An unknown one is REPORTED
 * rather than ignored, because silently dropping `r=10` off a `/slay` is how
 * somebody kills the whole world instead of the mobs beside them.
 *
 * @returns {{options: object, unsupported: string[]}}
 */
export function parseFilters(body, origin) {
    const options = {}
    const unsupported = []

    for (const filter of splitFilters(body)) {
        const at = filter.indexOf("=")
        if (at === -1) { unsupported.push(filter); continue }
        const key = filter.slice(0, at).trim().toLowerCase()
        let value = filter.slice(at + 1).trim()
        const negated = value.startsWith("!")
        if (negated) value = value.slice(1).trim()
        value = value.replace(/^"(.*)"$/s, "$1")

        switch (key) {
            case "type":
                if (negated) (options.excludeTypes ??= []).push(namespaced(value))
                else options.type = namespaced(value)
                break
            case "family":
                if (negated) (options.excludeFamilies ??= []).push(value)
                else (options.families ??= []).push(value)
                break
            case "tag":
                if (negated) (options.excludeTags ??= []).push(value)
                else (options.tags ??= []).push(value)
                break
            case "name":
                if (negated) (options.excludeNames ??= []).push(value)
                else options.name = value
                break
            case "m":
            case "gamemode": {
                const mode = GAME_MODES[value.toLowerCase()]
                if (mode === undefined) { unsupported.push(filter); break }
                if (negated) (options.excludeGameModes ??= []).push(mode)
                else options.gameMode = mode
                break
            }
            case "r": options.maxDistance = Number(value); break
            case "rm": options.minDistance = Number(value); break
            case "l": options.maxLevel = Number(value); break
            case "lm": options.minLevel = Number(value); break
            case "c": {
                // Bedrock's `c` counts from nearest; a NEGATIVE count means
                // farthest first, which the API splits into two options.
                const count = Number(value)
                if (!Number.isFinite(count) || count === 0) { unsupported.push(filter); break }
                if (count > 0) options.closest = count
                else options.farthest = -count
                break
            }
            case "x": case "y": case "z": {
                const base = options.location ?? { ...(origin ?? { x: 0, y: 0, z: 0 }) }
                base[key] = Number(value)
                options.location = base
                break
            }
            case "dx": case "dy": case "dz": {
                const box = options.volume ?? { x: 0, y: 0, z: 0 }
                box[key.slice(1)] = Number(value)
                options.volume = box
                break
            }
            default:
                unsupported.push(filter)
        }
    }

    // Distance is meaningless without somewhere to measure from.
    if ((options.maxDistance !== undefined || options.minDistance !== undefined
        || options.closest !== undefined || options.farthest !== undefined)
        && !options.location && origin) {
        options.location = { x: origin.x, y: origin.y, z: origin.z }
    }
    return { options, unsupported }
}

/**
 * Resolve selector TEXT to entities, using the script API rather than the
 * command parser.
 *
 * @param text      what they typed: `@e[type=cow]`, `@s`, `@p`, or a bare name
 * @param player    who typed it — the origin for `@s`, `@p` and any distance
 * @param playersOnly  true for a parameter the vanilla command types as a player
 * @returns {{ok: boolean, entities: object[], reason?: string, unsupported?: string[]}}
 */
export function resolveSelector(text, player, playersOnly = false) {
    const raw = String(text ?? "").trim().replace(/^"(.*)"$/s, "$1")
    if (!raw) return { ok: false, entities: [], reason: "no target given." }

    if (!raw.startsWith("@")) {
        // A plain name. Players are the only thing you can name.
        const found = playerNamed(raw)
        if (!found.length) return { ok: false, entities: [], reason: `nobody here is called or nicknamed "${raw}".` }
        return { ok: true, entities: found }
    }

    const base = raw.slice(1, 2).toLowerCase()
    const open = raw.indexOf("[")
    const body = open === -1 ? "" : raw.slice(open + 1, raw.lastIndexOf("]"))
    const { options, unsupported } = parseFilters(body, player?.location)

    const dimension = player?.dimension ?? world.getDimension("overworld")
    let entities = []
    try {
        switch (base) {
            case "s":
                entities = player ? [player] : []
                break
            case "p": {
                const near = { ...options, location: options.location ?? player?.location, closest: options.closest ?? 1 }
                entities = dimension.getPlayers(near)
                break
            }
            case "r": {
                const pool = dimension.getPlayers(options)
                entities = pool.length ? [pool[Math.floor(Math.random() * pool.length)]] : []
                break
            }
            case "a":
                entities = dimension.getPlayers(options)
                break
            case "e":
                entities = dimension.getEntities(options)
                break
            default:
                return { ok: false, entities: [], reason: `"${raw}" is not a selector I know.` }
        }
    } catch (e) {
        return { ok: false, entities: [], reason: String(e).replace(/^Error: /, "") }
    }

    if (playersOnly) entities = entities.filter(e => e.typeId === "minecraft:player")
    return { ok: true, entities, unsupported }
}

/** The vocabulary, for a command description — since the game no longer offers it. */
export const SELECTOR_HELP = "@s @p @r @a @e · filters: type= family= tag= name= r= rm= c= m= x= y= z= dx= dy= dz= (! to negate)"
