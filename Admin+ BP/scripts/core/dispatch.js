import { CustomCommandParamType } from "@minecraft/server"
import { commandSpecs } from "./registry.js"
import { has } from "./ranks.js"
import { resolveSelector, SELECTOR_HINT } from "./selector.js"

// Running one of THIS PACK's commands from a line of text.
//
// The console could only ever run vanilla commands, because that is all
// `runAsServer` does — it hands a string to the dimension. A pack command is
// not a string the dimension knows: it is a handler the engine calls with
// arguments it parsed for us, and from a text box nobody has parsed anything.
//
// So this is the parser. It is short because it does not invent one: the
// registry already records every command's typed parameter list, and
// core/selector.js already turns selector TEXT into entities — which is the
// only genuinely hard conversion and the one that took two days to get right.
// Everything else is a number, a boolean, or a word.
//
// Nothing here loosens a permission. Each command's own `perm` is checked
// exactly as the engine checks it, so the console can reach what the person at
// the keyboard could already have typed — it just saves them typing `/a:`.

/** Split a line into a command name and its arguments, honouring quotes. */
export function tokenise(line) {
    const out = []
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g
    let m
    while ((m = re.exec(String(line ?? ""))) !== null) {
        out.push(m[1] ?? m[2] ?? m[3])
    }
    return out
}

const P = CustomCommandParamType
const SELECTORS = new Set([P.PlayerSelector, P.EntitySelector])

/**
 * Turn one text argument into what the handler expects.
 *
 * Returns `{ok, value}` or `{ok: false, reason}`. A selector that matches
 * nobody is an ERROR rather than an empty list: handlers written against the
 * engine have never had to consider a selector that resolved to nothing,
 * because the engine refuses the command before calling them.
 */
export function coerce(text, param, player) {
    const type = param?.type
    if (SELECTORS.has(type)) {
        const found = resolveSelector(text, player, type === P.PlayerSelector)
        if (!found.ok) return { ok: false, reason: found.reason }
        if (found.unsupported?.length) {
            return { ok: false, reason: `can't apply ${found.unsupported.join(", ")}` }
        }
        if (!found.entities.length) {
            return { ok: false, reason: `nothing matched "${text}". ${SELECTOR_HINT}` }
        }
        return { ok: true, value: found.entities }
    }
    if (type === P.Integer || type === P.Float) {
        const n = Number(text)
        if (!Number.isFinite(n)) return { ok: false, reason: `"${text}" is not a number` }
        return { ok: true, value: type === P.Integer ? Math.trunc(n) : n }
    }
    if (type === P.Boolean) {
        const word = String(text).toLowerCase()
        if (word === "true" || word === "yes" || word === "on") return { ok: true, value: true }
        if (word === "false" || word === "no" || word === "off") return { ok: true, value: false }
        return { ok: false, reason: `"${text}" is not true or false` }
    }
    // Location is three numbers, and the engine hands it over as one Vector3.
    if (type === P.Location) return { ok: false, reason: "coordinates can't be typed here yet" }
    return { ok: true, value: text }
}

/** The pack command by that name, if there is one. */
export function specFor(name) {
    const wanted = String(name ?? "").toLowerCase().replace(/^a:/, "")
    return commandSpecs().find(spec => spec.name === wanted)
}

/**
 * Run a pack command written as text.
 *
 * Returns `{ok: false, reason}`, or `{ok: true, command}` having called the
 * handler. `undefined` means this was not a pack command at all, which is the
 * caller's cue to try the vanilla route — the two are told apart HERE rather
 * than by the caller guessing from the name.
 */
export function runPackCommand(player, line) {
    const parts = tokenise(line)
    if (!parts.length) return undefined
    const spec = specFor(parts[0])
    if (!spec) return undefined

    if (spec.perm && !has(player, spec.perm)) {
        return { ok: false, reason: `you don't have permission to use /${spec.name}` }
    }

    const params = [...(spec.mandatory ?? []), ...(spec.optional ?? [])]
    const given = parts.slice(1)
    const need = (spec.mandatory ?? []).length
    if (given.length < need) {
        // The namespace comes off. An Enum parameter is linked to its values BY
        // NAME and that name has to be namespaced, so the parameter is called
        // `a:effect` — which is an implementation detail of the registration,
        // not something to show somebody who just typed the command wrong.
        const names = (spec.mandatory ?? [])
            .map(p => `<${String(p.name).replace(/^[a-z0-9_]+:/i, "")}>`).join(" ")
        return { ok: false, reason: `/${spec.name} needs ${names}` }
    }

    const args = []
    for (let i = 0; i < params.length; i++) {
        if (i >= given.length) { args.push(undefined); continue }
        // The LAST string parameter swallows the rest of the line, so a reason
        // or a message does not have to be quoted. Without this, /ban Steve
        // griefing again would lose the word "again".
        const last = i === params.length - 1
        const type = params[i]?.type
        const text = (last && type === P.String && given.length > params.length)
            ? given.slice(i).join(" ")
            : given[i]
        const got = coerce(text, params[i], player)
        if (!got.ok) return { ok: false, reason: got.reason }
        args.push(got.value)
    }

    try {
        const result = spec.run(player, args)
        if (result && typeof result.then === "function") {
            result.then(undefined, e => console.error(`[Admin+] console /${spec.name} failed: ${e}`))
        }
    } catch (e) {
        return { ok: false, reason: String(e).replace(/^Error: /, "") }
    }
    return { ok: true, command: `a:${spec.name}` }
}
