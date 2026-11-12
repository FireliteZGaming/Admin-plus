import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { noteExecuted } from "../core/cmdlog.js"
import { runAsServer, runOnEach, checkCommand } from "../core/execute.js"
import { hasEntityRoute, runEntityRoute } from "../core/entityapi.js"
import { resolveSelector, SELECTOR_HELP, SELECTOR_HINT } from "../core/selector.js"
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
// Everything goes through runAsServer: it runs at operator level for somebody
// who does not hold operator, the rank's `admin.commands` switch decides who
// may, and every call is logged and announced.

const P = CustomCommandParamType

// **Since 2.8.2 this registers two commands: time (/clock) and weather (/sky).**
// The other 52 vanilla wrappers were removed as excessive op commands, the
// user's call. Most of the machinery below (selectors, entity tags) was built
// for those and neither of the two uses it. It can all go once time and
// weather get purpose-built commands of their own, the way /gmc is.

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
        // TWO shapes arrive here, and which one depends on how the parameter is
        // registered — see the registration loop at the bottom of this file.
        //
        // Registered as a real EntitySelector/PlayerSelector, the ENGINE
        // resolves it and hands back Entity[]. That is the shape worth having,
        // because it is what makes the game offer `@a @e @p @r @s` and every
        // filter as you type. Without it the argument is a blank text box, and
        // a blank text box is useless to anyone who does not already know
        // selector syntax — which is most of the people this command set is
        // for.
        //
        // Each resolved entity gets a one-shot tag and the line targets
        // `@e[tag=…]`. That is not ceremony: it pins the set to exactly what
        // the engine matched when the command was typed, so
        // `@e[type=cow,c=3]` picks its three cows once and cannot re-resolve
        // to different ones a tick later.
        if (Array.isArray(value)) {
            if (!value.length) return undefined
            for (const entity of value) {
                // The tag travels WITH the entity into cleanup, because each
                // selector parameter gets its own — see buildLine. Removing by
                // a single shared tag would leave the others on.
                try { entity.addTag(tag); cleanup.push({ entity, tag }) } catch { /* died already */ }
            }
            // ONE player becomes their NAME, and that is the important case.
            //
            // A name is not a selector, so the game never expands it — and
            // expansion is precisely what gets refused. `/exp 100` worked in a
            // live world while `/ench @s …` did not, and the only difference
            // was that the first put no selector in the rebuilt line at all.
            // Writing the name reaches the same person and asks the parser for
            // nothing.
            //
            // Quoted, because a gamertag may contain spaces and would
            // otherwise arrive as two arguments. Any quote inside is dropped
            // rather than escaped: it cannot legally be in a gamertag, so
            // anything carrying one is not a name worth passing on intact.
            if (type === P.PlayerSelector && value.length === 1) {
                const name = String(value[0]?.name ?? "").replace(/"/g, "")
                if (name) return `"${name}"`
            }
            // More than one, or an entity that has no name to use. Vanilla
            // checks a selector's TYPE syntactically rather than what it
            // resolves to, so a player-typed argument handed `@e[tag=…]` is
            // refused with "Selector must be player-type" even when every
            // tagged entity IS a player. `@a` is also far less
            // permission-restricted than `@e`, which is every entity alive.
            return `${type === P.PlayerSelector ? "@a" : "@e"}[tag=${tag}]`
        }
        // Registered as a String, the raw text comes through instead and is
        // pasted straight in for the dimension to expand at operator level.
        // Kept working so flipping the registration back is one line, not a
        // rewrite — see the note there about why it might have to be.
        //
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
export function buildLine(spec, args, tag, cleanup = [], selfAt = -1) {
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
        // A tag PER PARAMETER, not one for the whole line. Three commands take
        // two selectors — /move, /mount and /dialog — and with a shared tag
        // `/move <cow> <steve>` came out as
        //     teleport @e[tag=T] @e[tag=T]
        // which teleports both sets to themselves. The suffix keeps the two
        // sides of the command apart.
        // `selfAt` names the one argument that becomes `@s`, because the
        // command is going to be run ON each of those entities rather than
        // handed to the dimension — `@s` expands nothing, which is the entire
        // point. See runOnEach in core/execute.js.
        const piece = i === selfAt
            ? (Array.isArray(args[i]) && args[i].length ? "@s" : undefined)
            : render(args[i], params[i][1], `${tag}_${i}`, cleanup)
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
        // Every parameter keeps its real type EXCEPT selectors, and that one
        // exception is forced. A parameter registered as EntitySelector or
        // PlayerSelector is expanded BY THE ENGINE at the command's declared
        // permission level — `Any`, because these exist for people without
        // operator — and every `@` form is refused there:
        //
        //     <insufficient permissions for selector expansion>
        //
        // printed with NO `[Admin+]` prefix, because it happens before this
        // file's handler runs. `/slay @e[family=monster]`, `/gift @p iron_leggings`
        // and `/ench @p` all died that way; `/exp 100 Steve` worked, because a
        // literal name is not a selector and needs no expansion.
        //
        // So the picker the engine offers is a lie: it suggests `@a @e @p @r
        // @s` and then refuses all five. A plain String with the vocabulary in
        // the description is worse than a working picker and better than a
        // lying one. core/selector.js resolves the text through the script
        // API's own query instead — no parser, no permission, nothing to
        // refuse. Location, ItemType, BlockType and the enums keep their types
        // and still complete.
        // The parameter NAME is the last surface left. The description is shown
        // while you are picking the command and gone by the time you are
        // filling it in; what stays on screen is `<targets: string>`, and
        // `string` tells somebody nothing about what a target looks like. A
        // suffix puts words that always work where they are already looking,
        // and `me` / `all` are real: see WORDS in core/selector.js.
        //
        // REQUIRED and OPTIONAL get different suffixes, because `_or_me` on a
        // required slot actively misleads. `/eff` reads `<targets_or_me>`,
        // which sounds like "leave it out and it means me" — and leaving it
        // out is the one thing that does not work. The word has to be typed,
        // so the name says so: `<targets_me_or_all>`.
        const entry = type === P.Enum
            ? { name: enumName[enumKey], type }
            : SELECTOR_TYPES.has(type)
                ? { name: isOptional ? `${name}_or_me` : `${name}_me_or_all`, type: P.String }
                : { name, type }
        ;(isOptional ? optional : mandatory).push(entry)
    }

    const registered = codenameFor(spec.name)
    command({
        name: registered,
        group: "vanilla",
        // Name the vanilla command when the registration is called something
        // else, so `/a:count` says out loud that it is `testfor` and nobody
        // has to come and read this file to find that out.
        // The selector vocabulary rides in the description for any command that
        // takes one, because the engine no longer offers it as you type — see
        // the registration note below. A description is the only surface left
        // that can say `@e[family=monster]` is a thing you may write.
        description: [
            spec.help,
            registered === spec.name ? "" : `(vanilla /${spec.name})`,
            (spec.params ?? []).some(p => SELECTOR_TYPES.has(p[1])) ? `· ${SELECTOR_HELP}` : "",
            "— operator-level, logged"
        ].filter(Boolean).join(" "),
        mandatory,
        optional,
        run: (player, args) => {
            // Refuses anything on NEVER in core/execute.js. With only time and
            // weather registered since 2.8.2 this is a guard, not a filter.
            const gate = checkCommand(spec.name)
            if (!gate.ok) return err(player, gate.reason)

            // Selector arguments arrive as TEXT and are resolved here, through
            // the script API rather than the command parser — see
            // core/selector.js for why. Everything downstream expects the same
            // Entity[] the engine used to hand over, so this is the only place
            // that changes.
            const resolved = [...args]
            for (let i = 0; i < (spec.params ?? []).length; i++) {
                const [, type] = spec.params[i]
                if (!SELECTOR_TYPES.has(type)) continue
                if (resolved[i] === undefined || resolved[i] === null) continue

                const found = resolveSelector(resolved[i], player, type === P.PlayerSelector)
                if (!found.ok) return err(player, found.reason)
                if (!found.entities.length) {
                    return err(player, `nothing matched §f${resolved[i]}§c. ${SELECTOR_HINT}`)
                }
                // A filter we cannot honour is REPORTED, never dropped: losing
                // `r=10` off a /slay is the difference between the mobs beside
                // you and every mob loaded.
                if (found.unsupported?.length) {
                    return err(player,
                        `I can't apply §f${found.unsupported.join(", ")}§c — refusing rather than ignoring it.`)
                }
                // **The ladder, applied to every one of them in one place.**
                //
                // Until 2.2.5 these had no rank protection whatsoever. Every
                // command that acts on a player through the panel or a pack
                // command checked canActOn; the vanilla passthroughs checked
                // nothing, so a moderator could `/slay` an owner, `/eff` them
                // poison, `/dmg` them, `/label` them or `/move` them into the
                // void. The permission node said who may use /slay. Nothing
                // said who they may use it ON.
                //
                // Mobs are untouched — a zombie has no rank — so `/slay
                // @e[family=monster]` behaves exactly as before. Only players
                // in the resolved set are filtered.
                const protectedFrom = found.entities.filter(e =>
                    e?.typeId === "minecraft:player" && !canActOn(player, e))
                if (protectedFrom.length) {
                    const allowed = found.entities.filter(e => !protectedFrom.includes(e))
                    const names = protectedFrom.map(e => displayName(e)).join(", ")
                    // Everything matched outranks them: refuse outright, so the
                    // command does not report a cheerful "0 affected" for what
                    // was actually a permission failure.
                    if (!allowed.length) {
                        return err(player, `§f${names}§c outrank${protectedFrom.length === 1 ? "s" : ""} you.`)
                    }
                    // Some of it did: carry on with the rest and SAY who was
                    // skipped. Silently trimming the set would make `/slay @a`
                    // look like it worked on everybody.
                    info(player, `§7Skipped §f${names}§7 — above your rank.`)
                    found.entities = allowed
                }
                resolved[i] = found.entities
            }
            args = resolved

            const tag = tempTag()
            const cleanup = []
            try {
                // An ENTITY argument cannot go through the dimension: it will
                // not expand `@e`, whatever filters follow it. `@a` it will,
                // which is why player arguments work and `/slay
                // @e[family=monster]` did not. So when the engine has resolved
                // an entity argument for us, that slot becomes `@s` and the
                // command runs once ON each of them — `@s` names the executor
                // and expands nothing at all.
                //
                // Only the FIRST such argument can be `@s`, because there is
                // one executor. The three commands taking two entity arguments
                // — /move, /mount, /dialog — still hand the second to the
                // dimension, and that half remains subject to the same limit.
                const params = spec.params ?? []
                const selfAt = params.findIndex((p, i) =>
                    p[1] === P.EntitySelector && Array.isArray(args[i]) && args[i].length)

                // Best route first: do it to the entities DIRECTLY, with no
                // command text at all. `entity.kill()` is one native call —
                // no parser, no selector, no permission to refuse, and none of
                // the per-entity parse cost that makes `/slay @e[type=zombie]`
                // beside a mob farm a problem. This is the route /gm has always
                // taken, which is why /gm has always worked.
                //
                // Only commands whose WHOLE effect is reproducible are routed
                // this way; everything else falls through untouched, and a
                // route that manages nothing falls back rather than reporting a
                // confident zero.
                if (selfAt !== -1 && hasEntityRoute(spec.name)) {
                    const direct = runEntityRoute(spec.name, args[selfAt], args)
                    if (direct.handled) {
                        ok(player, `Ran §f/${spec.name}§a§7 — ${direct.affected} affected.`)
                        noteExecuted(player, buildLine(spec, args, tag, cleanup, selfAt))
                        return
                    }
                }

                const line = buildLine(spec, args, tag, cleanup, selfAt)
                const result = selfAt === -1
                    ? runAsServer(player, line)
                    : runOnEach(player, line, args[selfAt])
                if (!result.ok) return err(player, result.reason)
                ok(player, `Ran §f/${result.command}§a§7 — ${result.output} affected.`)
                noteExecuted(player, result.command)
            } finally {
                // The tag must not outlive the command, or a later selector
                // would pick these entities up again. Entities the command
                // killed are gone and throw here, which is fine.
                //
                // Each entry carries the tag it was actually given: buildLine
                // hands every selector PARAMETER its own, so removing one
                // shared tag would strip the first set and leave the second
                // wearing theirs for good.
                for (const { entity, tag: applied } of cleanup) {
                    try { entity.removeTag(applied) } catch { /* died or unloaded */ }
                }
            }
        }
    })
}

export { COMMANDS }
