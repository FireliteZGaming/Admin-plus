// Automation: the language.
//
// Server ▸ Automation holds automations, like those in Apple Shortcuts: when
// something happens, check a condition, then do something. The user asked for
// it on 2026-11-12, after King bacon6016 showed how much a world can do with a
// few lines of text, and wanted it "script like": `if({Rank} == "...") {`.
// The design is in Obsidian ▸ Admin+ ▸ Automation.
//
// This file reads the text and runs it against an `env` it is handed. It
// touches no game object, so every rule in it is tested without the game.
// features/automation.js connects it to the world.

export const LIMITS = Object.freeze({
    actionsPerRun: 20,
    minEverySeconds: 10,
    maxEverySeconds: 86400,
    maxWaitSeconds: 600,
    maxGiveSeconds: 365 * 86400,
    maxText: 512,
    maxSource: 32767,
    maxAutomations: 50,
    waitingRuns: 20
})

export const TRIGGER_WORDS = Object.freeze(["join", "first join", "leave", "chat", "death", "respawn"])
export const TOKENS = Object.freeze(["NAME", "NICKNAME", "RANK", "MSG", "ONLINE"])

/** What the person who saves an automation must be allowed to do for each line. */
export const PERMISSION_FOR = Object.freeze({
    say: "admin.broadcast",
    warp: "admin.tp",
    giveRank: "ranks.grant",
    takeRank: "ranks.grant",
    cancel: "admin.mute",
    replace: "admin.mute"
})

const ACTIONS = ["say", "tell", "title", "actionbar", "sound", "warp", "give", "take", "cancel", "replace", "wait", "stop"]
const WORDS = [...ACTIONS, "when", "every", "if", "else", "and", "or", "not", "contains", "starts", "ends", "with",
    "has", "rank", "is", "staff", "chance", "for", "join", "first", "leave", "chat", "death", "respawn"]
const UNITS = {
    second: ["seconds", 1], seconds: ["seconds", 1],
    minute: ["minutes", 60], minutes: ["minutes", 60],
    hour: ["hours", 3600], hours: ["hours", 3600],
    day: ["days", 86400], days: ["days", 86400],
    week: ["weeks", 604800], weeks: ["weeks", 604800]
}
const PLAYER_ACTIONS = ["tell", "title", "actionbar", "sound", "warp", "giveRank", "takeRank"]
const WORD_OF = { tell: "tell", tellStaff: "tell staff", title: "title", actionbar: "actionbar", sound: "sound",
    warp: "warp", giveRank: "give rank", takeRank: "take rank", say: "say", cancel: "cancel", replace: "replace" }

/** A mistake in the text, with the line it is on. */
export class AutomationError extends Error {
    constructor(line, message) {
        super(`Line ${line}: ${message}`)
        this.line = line
    }
}

// ------------------------------------------------------------------ words

function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const kept = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
            previous = kept
        }
    }
    return row[b.length]
}

/** The closest word from `choices`, if one is near enough to be a typo. */
function suggest(word, choices) {
    let best, bestDistance = 3
    for (const choice of choices) {
        const d = distance(String(word).toLowerCase(), String(choice).toLowerCase())
        if (d < bestDistance) { bestDistance = d; best = choice }
    }
    return best
}

const QUOTES = ["\"", "“", "”"]

/** Text to tokens. Comments, spaces and new lines go; line numbers stay. */
export function tokenize(source) {
    const text = String(source ?? "")
    const out = []
    let i = 0, line = 1
    while (i < text.length) {
        const c = text[i]
        if (c === "\n") { line++; i++; continue }
        if (c === " " || c === "\t" || c === "\r") { i++; continue }
        if (c === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++
            continue
        }
        if (QUOTES.includes(c)) {
            const start = line
            let value = ""
            i++
            for (;;) {
                if (i >= text.length || text[i] === "\n") throw new AutomationError(start, "this quote is never closed.")
                const ch = text[i]
                if (ch === "\\" && (text[i + 1] === "\"" || text[i + 1] === "\\")) { value += text[i + 1]; i += 2; continue }
                if (QUOTES.includes(ch)) { i++; break }
                value += ch
                i++
            }
            out.push({ t: "str", v: value, line: start })
            continue
        }
        if (c === "{") {
            const ref = /^\{\s*([A-Za-z]+)\s*\}/.exec(text.slice(i))
            if (ref) {
                const name = ref[1].toUpperCase()
                if (TOKENS.includes(name)) {
                    out.push({ t: "tok", v: name, line })
                    i += ref[0].length
                    continue
                }
                if (!WORDS.includes(ref[1].toLowerCase())) throw unknownToken(ref[1], line)
            }
            out.push({ t: "{", line })
            i++
            continue
        }
        if ("}();".includes(c)) { out.push({ t: c, line }); i++; continue }
        const two = text.slice(i, i + 2)
        if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two, line }); i += 2; continue }
        if ("<>!%=".includes(c)) { out.push({ t: "op", v: c, line }); i++; continue }
        const number = /^\d+(\.\d+)?/.exec(text.slice(i))
        if (number) { out.push({ t: "num", v: Number(number[0]), line }); i += number[0].length; continue }
        const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))
        if (word) { out.push({ t: "word", v: word[0].toLowerCase(), raw: word[0], line }); i += word[0].length; continue }
        throw new AutomationError(line, `I don't understand the character ${c}.`)
    }
    return out
}

function unknownToken(word, line) {
    const near = suggest(word, TOKENS)
    return new AutomationError(line, near
        ? `I don't know {${word}}. Did you mean {${near}}?`
        : `I don't know {${word}}. The words in { } are ${TOKENS.map(t => `{${t}}`).join(" ")}.`)
}

/** The {WORDS} in a piece of text, each checked. Braces around anything else stay as text. */
function tokensInText(text, line) {
    const found = []
    for (const match of String(text).matchAll(/\{\s*([A-Za-z]+)\s*\}/g)) {
        const name = match[1].toUpperCase()
        if (!TOKENS.includes(name)) throw unknownToken(match[1], line)
        found.push(name)
    }
    return found
}

const show = k => !k ? "the end" : k.t === "word" ? `'${k.raw}'` : k.t === "str" ? `"${k.v}"` : k.t === "num" ? String(k.v) : k.t === "tok" ? `{${k.v}}` : k.t === "op" ? k.v : k.t

// ------------------------------------------------------------------ parser

class Parser {
    constructor(tokens) { this.t = tokens; this.i = 0 }
    peek(ahead = 0) { return this.t[this.i + ahead] }
    next() { return this.t[this.i++] }
    lastLine() { return this.t[Math.min(this.i, this.t.length - 1)]?.line ?? 1 }
    lineOf(k) { return k?.line ?? this.lastLine() }
    atWord(w) { const k = this.peek(); return k?.t === "word" && k.v === w }
    take(w) { if (this.atWord(w)) { this.i++; return true } return false }
    takeOp(op) { const k = this.peek(); if (k?.t === "op" && k.v === op) { this.i++; return true } return false }

    program() {
        const blocks = []
        while (this.peek()) {
            const k = this.peek()
            if (this.atWord("when")) blocks.push(this.whenBlock())
            else if (this.atWord("every")) blocks.push(this.everyBlock())
            else throw new AutomationError(k.line, `start with when or every, not ${show(k)}.`)
        }
        return blocks
    }

    whenBlock() {
        const at = this.next().line
        const k = this.peek()
        let trigger
        if (k?.t !== "word") throw new AutomationError(this.lineOf(k), "when what? Use join, first join, leave, chat, death or respawn.")
        if (k.v === "first") {
            this.next()
            if (!this.take("join")) throw new AutomationError(at, "first what? It's when first join.")
            trigger = "first join"
        } else if (["join", "leave", "chat", "death", "respawn"].includes(k.v)) {
            this.next()
            trigger = k.v
        } else {
            const near = suggest(k.raw, TRIGGER_WORDS)
            throw new AutomationError(k.line, near ? `when ${k.raw}? Did you mean when ${near}?` : `when ${k.raw}? Use join, first join, leave, chat, death or respawn.`)
        }
        return { kind: "when", trigger, line: at, body: this.block(`when ${trigger}`) }
    }

    everyBlock() {
        const at = this.next().line
        const n = this.peek()
        if (n?.t !== "num") throw new AutomationError(this.lineOf(n), "every how long? For example: every 5 minutes.")
        this.next()
        const seconds = n.v * this.unit(at, ["seconds", "minutes", "hours"])
        if (seconds < LIMITS.minEverySeconds) throw new AutomationError(at, `every needs ${LIMITS.minEverySeconds} seconds or more.`)
        if (seconds > LIMITS.maxEverySeconds) throw new AutomationError(at, "every can be 24 hours at the most.")
        return { kind: "every", trigger: "every", seconds, line: at, body: this.block("every") }
    }

    /** A unit word after a number, as seconds. */
    unit(at, allowed) {
        const k = this.peek()
        const known = k?.t === "word" ? UNITS[k.v] : undefined
        if (known && allowed.includes(known[0])) { this.next(); return known[1] }
        throw new AutomationError(this.lineOf(k) || at, `say how long in ${allowed.join(", ")}.`)
    }

    block(what) {
        const open = this.peek()
        if (open?.t !== "{") throw new AutomationError(this.lineOf(open), `${what} needs a { after it.`)
        this.next()
        const body = []
        for (;;) {
            const k = this.peek()
            if (!k) throw new AutomationError(open.line, "this { has no } to close it.")
            if (k.t === "}") { this.next(); return body }
            if (k.t === ";") { this.next(); continue }
            body.push(this.statement())
        }
    }

    statement() {
        const k = this.peek()
        if (k.t !== "word") throw new AutomationError(k.line, `I didn't expect ${show(k)} here.`)
        const line = k.line
        switch (k.v) {
            case "if": return this.ifStatement()
            case "say": this.next(); return { type: "say", line, text: this.text("say") }
            case "tell":
                this.next()
                if (this.take("staff")) return { type: "tellStaff", line, text: this.text("tell staff") }
                return { type: "tell", line, text: this.text("tell") }
            case "title": {
                this.next()
                const big = this.text("title")
                const small = this.peek()?.t === "str" ? this.text("title") : ""
                return { type: "title", line, text: big, sub: small }
            }
            case "actionbar": this.next(); return { type: "actionbar", line, text: this.text("actionbar") }
            case "sound": {
                this.next()
                const id = this.text("sound")
                if (!/^[a-z0-9_.:]+$/i.test(id)) throw new AutomationError(line, `"${id}" isn't a sound name. Sound names look like random.levelup.`)
                return { type: "sound", line, text: id }
            }
            case "warp": this.next(); return { type: "warp", line, text: this.text("warp") }
            case "give":
            case "take": {
                this.next()
                if (!this.take("rank")) throw new AutomationError(line, `${k.v} what? It's ${k.v} rank "Name".`)
                const name = this.text(`${k.v} rank`)
                let seconds = 0
                if (k.v === "give" && this.take("for")) {
                    const n = this.peek()
                    if (n?.t !== "num") throw new AutomationError(line, "for how long? For example: for 1 day.")
                    this.next()
                    seconds = n.v * this.unit(line, ["minutes", "hours", "days", "weeks"])
                    if (seconds < 60) throw new AutomationError(line, "a timed rank needs 1 minute or more.")
                    if (seconds > LIMITS.maxGiveSeconds) throw new AutomationError(line, "a timed rank can be 365 days at the most.")
                }
                return { type: k.v === "give" ? "giveRank" : "takeRank", line, text: name, seconds }
            }
            case "cancel": this.next(); return { type: "cancel", line }
            case "replace": this.next(); return { type: "replace", line, text: this.text("replace") }
            case "wait": {
                this.next()
                const n = this.peek()
                if (n?.t !== "num") throw new AutomationError(line, "wait how long? For example: wait 5 seconds.")
                this.next()
                const seconds = n.v * this.unit(line, ["seconds", "minutes"])
                if (seconds < 1) throw new AutomationError(line, "wait needs 1 second or more.")
                if (seconds > LIMITS.maxWaitSeconds) throw new AutomationError(line, "wait can be 10 minutes at the most.")
                return { type: "wait", line, seconds }
            }
            case "stop": this.next(); return { type: "stop", line }
            case "else": throw new AutomationError(line, "this else has no if before it.")
            default: {
                const near = suggest(k.raw, [...ACTIONS, "if"])
                throw new AutomationError(line, near ? `I don't know '${k.raw}'. Did you mean ${near}?` : `I don't know '${k.raw}'.`)
            }
        }
    }

    /** Words in quotes after `what`. */
    text(what) {
        const k = this.peek()
        if (k?.t === "str") {
            this.next()
            if (k.v.length > LIMITS.maxText) throw new AutomationError(k.line, `that text is longer than ${LIMITS.maxText} characters.`)
            tokensInText(k.v, k.line)
            return k.v
        }
        if (k?.t === "word") throw new AutomationError(k.line, `put the words after ${what} in quotes: ${what} "${k.raw}".`)
        throw new AutomationError(this.lineOf(k), `${what} needs words in quotes after it.`)
    }

    ifStatement() {
        const line = this.next().line
        const cond = this.orExpr()
        const then = this.block("if")
        let otherwise = null
        if (this.take("else")) otherwise = this.atWord("if") ? [this.ifStatement()] : this.block("else")
        return { type: "if", line, cond, then, otherwise }
    }

    orExpr() {
        let left = this.andExpr()
        while (this.take("or") || this.takeOp("||")) left = { op: "or", left, right: this.andExpr() }
        return left
    }

    andExpr() {
        let left = this.notExpr()
        while (this.take("and") || this.takeOp("&&")) left = { op: "and", left, right: this.notExpr() }
        return left
    }

    notExpr() {
        if (this.take("not") || this.takeOp("!")) return { op: "not", value: this.notExpr() }
        return this.primary()
    }

    primary() {
        const k = this.peek()
        if (!k) throw new AutomationError(this.lastLine(), "the check ends too soon.")
        if (k.t === "(") {
            this.next()
            const inner = this.orExpr()
            const close = this.peek()
            if (close?.t !== ")") throw new AutomationError(this.lineOf(close), "this ( has no ) to close it.")
            this.next()
            return inner
        }
        if (this.atWord("has")) {
            this.next()
            if (!this.take("rank")) throw new AutomationError(k.line, "has what? It's has rank \"Name\".")
            return { op: "hasRank", name: this.text("has rank"), line: k.line }
        }
        if (this.atWord("is") && this.peek(1)?.t === "word" && this.peek(1).v === "staff") {
            this.next(); this.next()
            return { op: "isStaff", line: k.line }
        }
        if (this.atWord("chance")) {
            this.next()
            const n = this.peek()
            if (n?.t !== "num") throw new AutomationError(k.line, "chance needs a number, like chance 10%.")
            this.next()
            this.takeOp("%")
            if (n.v <= 0 || n.v > 100) throw new AutomationError(k.line, "chance is between 1 and 100.")
            return { op: "chance", percent: n.v, line: k.line }
        }
        const left = this.value()
        const cmp = this.compareOp()
        const right = this.value()
        return { op: "compare", cmp, left, right, line: k.line }
    }

    value() {
        const k = this.peek()
        if (k?.t === "tok") { this.next(); return { kind: "tok", name: k.v, line: k.line } }
        if (k?.t === "str") { this.next(); tokensInText(k.v, k.line); return { kind: "str", value: k.v, line: k.line } }
        if (k?.t === "num") { this.next(); return { kind: "num", value: k.v, line: k.line } }
        if (k?.t === "word") throw new AutomationError(k.line, `put ${k.raw} in quotes: "${k.raw}".`)
        throw new AutomationError(this.lineOf(k), "a check needs something to compare, like {RANK} == \"Owner\".")
    }

    compareOp() {
        const k = this.peek()
        if (k?.t === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(k.v)) { this.next(); return k.v }
        if (k?.t === "op" && k.v === "=") throw new AutomationError(k.line, "use == to compare.")
        if (k?.t === "word") {
            if (k.v === "contains") { this.next(); return "contains" }
            if (k.v === "starts" || k.v === "ends") {
                this.next()
                if (!this.take("with")) throw new AutomationError(k.line, `it's ${k.v} with.`)
                return k.v
            }
            if (k.v === "is") { this.next(); return this.take("not") ? "!=" : "==" }
        }
        throw new AutomationError(this.lineOf(k), "compare with ==, !=, >, <, contains, starts with or ends with.")
    }
}

// ------------------------------------------------------------------ checks

function checkTokens(names, line, trigger) {
    for (const name of names) {
        if (name === "MSG" && trigger !== "chat") throw new AutomationError(line, "{MSG} only works in when chat.")
        if (trigger === "every" && ["NAME", "NICKNAME", "RANK"].includes(name)) {
            throw new AutomationError(line, `{${name}} needs a player, and every runs for nobody in particular.`)
        }
    }
}

function checkCondition(cond, trigger) {
    switch (cond.op) {
        case "or": case "and": checkCondition(cond.left, trigger); checkCondition(cond.right, trigger); return
        case "not": checkCondition(cond.value, trigger); return
        case "hasRank":
        case "isStaff":
            if (trigger === "every") throw new AutomationError(cond.line, `${cond.op === "isStaff" ? "is staff" : "has rank"} needs a player, and every runs for nobody in particular.`)
            return
        case "compare":
            for (const side of [cond.left, cond.right]) {
                const names = side.kind === "tok" ? [side.name] : side.kind === "str" ? tokensInText(side.value, side.line) : []
                checkTokens(names, cond.line, trigger)
            }
    }
}

function checkStatements(list, trigger, state) {
    for (const s of list) {
        if (s.type === "if") {
            checkCondition(s.cond, trigger)
            checkStatements(s.then, trigger, state)
            if (s.otherwise) checkStatements(s.otherwise, trigger, state)
            continue
        }
        if (s.type === "wait") {
            state.waited = true
            state.waits += s.seconds
            if (state.waits > LIMITS.maxWaitSeconds) throw new AutomationError(s.line, "the waits here add up to more than 10 minutes.")
            continue
        }
        if (s.type === "cancel" || s.type === "replace") {
            if (trigger !== "chat") throw new AutomationError(s.line, `${s.type} only works in when chat.`)
            if (state.waited) throw new AutomationError(s.line, `${s.type} can't come after wait, because the message is already sent by then.`)
        }
        if (trigger === "every" && PLAYER_ACTIONS.includes(s.type)) {
            throw new AutomationError(s.line, `${WORD_OF[s.type]} needs a player, and every runs for nobody in particular. Use say or tell staff.`)
        }
        if (trigger === "leave" && ["tell", "title", "actionbar", "sound", "warp"].includes(s.type)) {
            throw new AutomationError(s.line, `${WORD_OF[s.type]} can't reach a player who is leaving. Use say.`)
        }
        if (trigger === "death" && s.type === "warp") {
            throw new AutomationError(s.line, "warp doesn't work on a player who just died. Use it in when respawn.")
        }
        for (const text of [s.text, s.sub]) if (text) checkTokens(tokensInText(text, s.line), s.line, trigger)
    }
}

/**
 * Read an automation. Returns `{ ok: true, blocks, empty }` or
 * `{ ok: false, error }` with the first mistake and its line.
 */
export function parse(source) {
    const text = String(source ?? "")
    if (text.length > LIMITS.maxSource) return { ok: false, error: `Line 1: this is longer than ${LIMITS.maxSource} characters.`, line: 1 }
    try {
        const tokens = tokenize(text)
        if (!tokens.length) return { ok: true, empty: true, blocks: [] }
        const blocks = new Parser(tokens).program()
        for (const block of blocks) checkStatements(block.body, block.trigger, { waited: false, waits: 0 })
        return { ok: true, empty: false, blocks }
    } catch (e) {
        if (e instanceof AutomationError) return { ok: false, error: e.message, line: e.line }
        throw e
    }
}

/** Every line that does something, in order, wherever it sits. */
export function statementsOf(blocks) {
    const out = []
    const walk = list => {
        for (const s of list) {
            if (s.type === "if") { walk(s.then); if (s.otherwise) walk(s.otherwise) }
            else out.push(s)
        }
    }
    for (const block of blocks) walk(block.body)
    return out
}

/** "when join", "every 5 minutes": what starts each block, for lists. */
export function triggerLabel(block) {
    if (block.kind === "when") return `when ${block.trigger}`
    const s = block.seconds
    if (s % 3600 === 0) return `every ${s / 3600} hour${s === 3600 ? "" : "s"}`
    if (s % 60 === 0) return `every ${s / 60} minute${s === 60 ? "" : "s"}`
    return `every ${s} seconds`
}

// ------------------------------------------------------------------ running

const plain = s => String(s ?? "").replace(/§./g, "").trim().toLowerCase()

/** Put the {WORDS} in. */
export function fill(text, env) {
    return String(text ?? "").replace(/\{\s*([A-Za-z]+)\s*\}/g, (whole, name) =>
        TOKENS.includes(name.toUpperCase()) ? String(env.token(name.toUpperCase()) ?? "") : whole)
}

function valueOf(v, env) {
    if (v.kind === "tok") return String(env.token(v.name) ?? "")
    if (v.kind === "num") return String(v.value)
    return fill(v.value, env)
}

export function compare(cmp, a, b) {
    const x = plain(a), y = plain(b)
    const nx = Number(x), ny = Number(y)
    const numeric = x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)
    switch (cmp) {
        case "==": return numeric ? nx === ny : x === y
        case "!=": return numeric ? nx !== ny : x !== y
        case ">": return numeric && nx > ny
        case "<": return numeric && nx < ny
        case ">=": return numeric && nx >= ny
        case "<=": return numeric && nx <= ny
        case "contains": return x.includes(y)
        case "starts": return x.startsWith(y)
        case "ends": return x.endsWith(y)
    }
    return false
}

function test(cond, env) {
    switch (cond.op) {
        case "or": return test(cond.left, env) || test(cond.right, env)
        case "and": return test(cond.left, env) && test(cond.right, env)
        case "not": return !test(cond.value, env)
        case "hasRank": return !!env.hasRank(fill(cond.name, env))
        case "isStaff": return !!env.isStaff()
        case "chance": return env.random() * 100 < cond.percent
        case "compare": return compare(cond.cmp, valueOf(cond.left, env), valueOf(cond.right, env))
    }
    return false
}

/**
 * Run one block. `env` is what the world provides:
 *   token(NAME) → text            hasRank(name) → bool     isStaff() → bool
 *   random() → 0..1               act(statement, text) → nothing, or a problem
 *   later(fn, ticks)              alive() → still on?      finished(result)
 * The returned result is filled in as far as the run got before any wait,
 * which is all a chat message can wait for: cancel and replace never follow
 * a wait (parse refuses it).
 */
export function runBlock(block, env) {
    const result = { cancel: false, replace: undefined, done: 0, error: undefined, waiting: false }
    const state = { stack: [{ list: block.body, i: 0 }], done: 0 }
    step(state, env, result)
    return result
}

function step(state, env, result) {
    while (state.stack.length) {
        const frame = state.stack[state.stack.length - 1]
        if (frame.i >= frame.list.length) { state.stack.pop(); continue }
        const s = frame.list[frame.i++]
        if (s.type === "if") {
            const branch = test(s.cond, env) ? s.then : s.otherwise
            if (branch) state.stack.push({ list: branch, i: 0 })
            continue
        }
        if (s.type === "stop") { state.stack.length = 0; break }
        if (s.type === "wait") {
            result.waiting = true
            env.later(() => {
                result.waiting = false
                if (env.alive()) step(state, env, result)
            }, Math.max(1, Math.round(s.seconds * 20)))
            return
        }
        if (++state.done > LIMITS.actionsPerRun) {
            result.error = `Line ${s.line}: it stopped after ${LIMITS.actionsPerRun} things in one run.`
            state.stack.length = 0
            break
        }
        if (s.type === "cancel") { result.cancel = true; continue }
        if (s.type === "replace") { result.replace = fill(s.text, env); continue }
        const problem = env.act(s, s.text === undefined ? undefined : fill(s.text, env), s.sub ? fill(s.sub, env) : "")
        if (problem && !result.error) result.error = `Line ${s.line}: ${problem}`
    }
    result.done = state.done
    env.finished?.(result)
}

/** What a line would do, in words, for "Try it on me". */
export function describe(s, text, sub) {
    switch (s.type) {
        case "say": return `would say to everyone: ${text}`
        case "tell": return `would tell you: ${text}`
        case "tellStaff": return `would tell staff: ${text}`
        case "title": return `would show you the title: ${text}${sub ? ` / ${sub}` : ""}`
        case "actionbar": return `would show above your hotbar: ${text}`
        case "sound": return `would play the sound ${text}`
        case "warp": return `would send you to the warp ${text}`
        case "giveRank": return `would give you the rank ${text}${s.seconds ? ` for ${Math.round(s.seconds / 3600) || 1} hour(s)` : ""}`
        case "takeRank": return `would take the rank ${text} from you`
    }
    return `would ${s.type}`
}
