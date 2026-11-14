// < Code > in JavaScript (2.12.7, Beta). The user kept < Code > and asked:
// "we actually make that JavaScript too, instead of how it is now".
//
// It is READ like JavaScript and NEVER RUN. Running what a player typed would
// do anything at all with the pack's full power, past every rank rule, so
// this file is a small reader for the one shape the settings take:
//
//   const setup = "defaults"
//   const settings = {
//     feature: { spawn: true },
//     spawn: { radius: 16 },
//   }
//
// What it understands: // and /* */ comments, const, let or var (or none),
// text in "double", 'single' or `back` quotes, numbers, true and false, lists
// in [ ], and objects in { } with or without commas between entries, and
// with a comma after the last one. `settings.spawn.radius = 16` sets one
// setting. Anything else is an error that names its line, and then nothing is
// saved. This file knows nothing about which settings exist; code.js does.

/** How deep objects may nest. The deepest setting is three names long. */
const MAX_DEPTH = 8

/** A key written bare in the document; anything else goes in quotes. */
const BARE = /^[A-Za-z_$][\w$]*$/

// --------------------------------------------------------------- writing

/** One value as the document writes it. */
function literal(value) {
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return JSON.stringify(String(value ?? ""))
}

/** A key as the document writes it. */
const keyText = key => BARE.test(key) ? key : JSON.stringify(key)

/** Settings in order as a tree: "a.b" and "a.c" share an `a`. */
function treeOf(entries) {
    const root = new Map()
    for (const [path, value] of entries) {
        const names = path.split(".")
        let node = root
        for (const name of names.slice(0, -1)) {
            if (!(node.get(name) instanceof Map)) node.set(name, new Map())
            node = node.get(name)
        }
        node.set(names[names.length - 1], value)
    }
    return root
}

function writeTree(node, indent, lines) {
    for (const [name, value] of node) {
        if (value instanceof Map) {
            lines.push(`${indent}${keyText(name)}: {`)
            writeTree(value, `${indent}  `, lines)
            lines.push(`${indent}},`)
        } else {
            lines.push(`${indent}${keyText(name)}: ${literal(value)},`)
        }
    }
}

/**
 * The whole document.
 * @param {{intro: string[], setup: string, setupNote: string, groups: [string, [string, any][]][]}} spec
 *   groups: a heading, then [dotted key, value] pairs whose first name they share.
 */
export function writeScript({ intro, setup, setupNote, groups }) {
    const lines = [...intro.map(line => `// ${line}`), "", `// ${setupNote}`, `const setup = ${literal(setup)}`, "", "const settings = {"]
    groups.forEach(([heading, entries], i) => {
        if (i) lines.push("")
        lines.push(`  // ${heading}`)
        writeTree(treeOf(entries), "  ", lines)
    })
    lines.push("}")
    return lines.join("\n")
}

// --------------------------------------------------------------- reading

const PUNCTUATION = "{}[]:,;=."

/** The document as tokens, each with the line it starts on. */
function tokenize(text) {
    const tokens = []
    let i = 0, line = 1
    const n = text.length
    while (i < n) {
        const c = text[i]
        if (c === "\n") { line++; i++; continue }
        if (c === " " || c === "\t" || c === "\r" || c === "﻿" || c === " ") { i++; continue }
        if (c === "/" && text[i + 1] === "/") {
            while (i < n && text[i] !== "\n") i++
            continue
        }
        if (c === "/" && text[i + 1] === "*") {
            const start = line
            i += 2
            while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; i++ }
            if (i >= n) return { error: `Line ${start}: a /* comment is never closed with */.` }
            i += 2
            continue
        }
        if (c === "\"" || c === "'" || c === "`") {
            const read = readString(text, i, line)
            if (read.error) return read
            tokens.push({ type: "string", value: read.value, line })
            line = read.line
            i = read.end
            continue
        }
        const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 64))
        if (number && (/\d/.test(c) || /[\d.]/.test(text[i + 1] ?? ""))) {
            tokens.push({ type: "number", value: Number(number[0]), line })
            i += number[0].length
            continue
        }
        if (/[A-Za-z_$]/.test(c)) {
            let j = i + 1
            while (j < n && /[\w$]/.test(text[j])) j++
            tokens.push({ type: "word", value: text.slice(i, j), line })
            i = j
            continue
        }
        if (PUNCTUATION.includes(c)) {
            tokens.push({ type: c, line })
            i++
            continue
        }
        return { error: `Line ${line}: Admin+ can't read "${c}" here. Text goes in quotes.` }
    }
    tokens.push({ type: "end", line })
    return { tokens }
}

/** A quoted text value starting at `start`. */
function readString(text, start, line) {
    const quote = text[start]
    const opened = line
    let out = ""
    let i = start + 1
    for (;;) {
        if (i >= text.length) return { error: `Line ${opened}: a text value has no closing ${quote}.` }
        const ch = text[i]
        if (ch === quote) return { value: out, end: i + 1, line }
        if (ch === "\n") {
            if (quote !== "`") return { error: `Line ${opened}: a text value has no closing ${quote} on its line.` }
            line++
        }
        if (quote === "`" && ch === "$" && text[i + 1] === "{") {
            return { error: `Line ${line}: Admin+ doesn't fill in \${...} in text. Write the text out instead.` }
        }
        if (ch !== "\\") { out += ch; i++; continue }
        const e = text[i + 1]
        if (e === undefined) return { error: `Line ${opened}: a text value has no closing ${quote}.` }
        const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }
        if (e in simple) { out += simple[e]; i += 2; continue }
        if (e === "\n") { line++; i += 2; continue }               // a line continued
        if (e === "x" || e === "u") {
            const braced = e === "u" && text[i + 2] === "{"
            const hex = braced
                ? /^\{([0-9a-fA-F]{1,6})\}/.exec(text.slice(i + 2))
                : new RegExp(`^[0-9a-fA-F]{${e === "x" ? 2 : 4}}`).exec(text.slice(i + 2))
            if (!hex) return { error: `Line ${line}: \\${e} needs a character code after it.` }
            const code = parseInt(braced ? hex[1] : hex[0], 16)
            if (code > 0x10FFFF) return { error: `Line ${line}: \\${e} needs a character code after it.` }
            out += String.fromCodePoint(code)
            i += 2 + hex[0].length
            continue
        }
        out += e                                                    // \" \' \\ and the rest
        i += 2
    }
}

class Reader {
    constructor(tokens) { this.tokens = tokens; this.at = 0 }
    peek(ahead = 0) { return this.tokens[Math.min(this.at + ahead, this.tokens.length - 1)] }
    next() { return this.tokens[Math.min(this.at++, this.tokens.length - 1)] }
    is(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value) }
}

/** Thrown inside the reader and caught at the top: always a sentence with a line. */
class Unreadable extends Error {}
const fail = message => { throw new Unreadable(message) }

/** Words a value can be: everything else in a value's place is an error. */
const NAMED_VALUES = { true: true, false: false }

function readValue(reader, depth) {
    if (depth > MAX_DEPTH) fail(`Line ${reader.peek().line}: settings don't nest this deep.`)
    const token = reader.next()
    switch (token.type) {
        case "string":
        case "number":
            return token.value
        case "word":
            if (token.value in NAMED_VALUES) return NAMED_VALUES[token.value]
            if (token.value === "null" || token.value === "undefined") {
                return fail(`Line ${token.line}: ${token.value} isn't a value Admin+ can read. To put a setting back to its default, delete its line.`)
            }
            return fail(`Line ${token.line}: ${token.value} isn't a value Admin+ can read. Text goes in quotes, like "${token.value}".`)
        case "{": return readObject(reader, token, depth + 1)
        case "[": return readList(reader, token, depth + 1)
        case "end": return fail(`Line ${token.line}: the document ends where a value should be.`)
        default:
            return fail(`Line ${token.line}: expected a value here, such as "text", true, false or 16.`)
    }
}

function readObject(reader, opened, depth) {
    const members = new Map()
    for (;;) {
        while (reader.is(",")) reader.next()
        const token = reader.next()
        if (token.type === "}") return members
        if (token.type === "end") fail(`Line ${opened.line}: this { is never closed with }.`)
        if (token.type !== "word" && token.type !== "string") fail(`Line ${token.line}: expected a setting's name here.`)
        const name = String(token.value)
        // JavaScript would keep only the second, losing the first without a
        // word, so it is a mistake to point at instead.
        if (members.has(name)) fail(`Line ${token.line}: ${name} is written twice in the same { }. Keep one of them.`)
        if (!reader.is(":")) fail(`Line ${token.line}: expected : after ${name}.`)
        reader.next()
        members.set(name, { value: readValue(reader, depth), line: token.line })
        // Commas between entries are optional: a new name on its own is fine.
        const after = reader.peek()
        if (after.type === "," || after.type === "}") continue
        if ((after.type === "word" || after.type === "string") && reader.peek(1).type === ":") continue
        if (after.type === "end") fail(`Line ${opened.line}: this { is never closed with }.`)
        fail(`Line ${after.line}: expected a comma or } after ${name}.`)
    }
}

function readList(reader, opened, depth) {
    const items = []
    for (;;) {
        while (reader.is(",")) reader.next()
        if (reader.is("]")) { reader.next(); return items }
        if (reader.is("end")) fail(`Line ${opened.line}: this [ is never closed with ].`)
        const token = reader.peek()
        const value = readValue(reader, depth)
        if (value instanceof Map || Array.isArray(value)) fail(`Line ${token.line}: a list holds text, numbers, true or false.`)
        items.push(value)
        if (!reader.is(",") && !reader.is("]")) fail(`Line ${reader.peek().line}: expected a comma or ] in this list.`)
    }
}

/** `settings.spawn.radius` as ["settings", "spawn", "radius"]. */
function readTarget(reader) {
    const first = reader.next()
    if (first.type !== "word") fail(`Line ${first.line}: expected setup = or settings = here.`)
    const names = [first.value]
    while (reader.is(".")) {
        reader.next()
        const name = reader.next()
        if (name.type !== "word") fail(`Line ${name.line}: expected a name after the dot.`)
        names.push(name.value)
    }
    return { names, line: first.line }
}

/** Objects as dotted keys: { spawn: { radius: 16 } } is "spawn.radius". */
function flatten(value, prefix, line, out) {
    if (value instanceof Map) {
        for (const [name, member] of value) flatten(member.value, prefix ? `${prefix}.${name}` : name, member.line, out)
        return
    }
    if (!prefix) fail(`Line ${line}: settings = needs a { } around the settings.`)
    out.push({ key: prefix, value, line })
}

/**
 * Read a document. Returns { setup, entries } or { error }.
 * `setup` is { value, line } when the document names one; each entry is
 * { key, value, line } with value text, a number, true or false, or a list,
 * in the order written (a later one for the same key wins).
 */
export function readScript(text) {
    const lexed = tokenize(String(text ?? ""))
    if (lexed.error) return { error: lexed.error }
    const reader = new Reader(lexed.tokens)
    const entries = []
    let setup
    try {
        while (!reader.is("end")) {
            if (reader.is(";")) { reader.next(); continue }
            if (reader.is("word") && ["const", "let", "var"].includes(reader.peek().value)) reader.next()
            const target = readTarget(reader)
            const head = target.names[0]
            if (!reader.is("=")) fail(`Line ${reader.peek().line}: expected = after ${target.names.join(".")}.`)
            reader.next()
            const value = readValue(reader, 0)
            if (head === "setup" && target.names.length === 1) {
                if (typeof value !== "string") fail(`Line ${target.line}: setup is a setup's name in quotes, like "defaults".`)
                setup = { value, line: target.line }
            } else if (head === "settings") {
                flatten(value, target.names.slice(1).join("."), target.line, entries)
            } else {
                fail(`Line ${target.line}: Admin+ only reads setup = and settings = here, not ${target.names.join(".")}.`)
            }
            if (reader.is(";")) reader.next()
        }
    } catch (e) {
        if (e instanceof Unreadable) return { error: e.message }
        throw e
    }
    return { setup, entries }
}
