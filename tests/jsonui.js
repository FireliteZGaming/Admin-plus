// A small reader for the expressions resource-pack bindings are written in, so
// a test can ask "which panel shows for this title?" instead of comparing two
// strings and hoping they mean what they look like.
//
// It covers what Admin+'s pack uses: ( ) not and or = - + 'strings' $variables
// #bindings and numbers. A string minus a string removes every copy of the
// second, which is how the pack spots a marker in a form title.

function tokenize(src) {
    const tokens = []
    let i = 0
    while (i < src.length) {
        const c = src[i]
        if (/\s/.test(c)) { i++; continue }
        if ("()=+-".includes(c)) { tokens.push({ t: c }); i++; continue }
        if (c === "'") {
            const end = src.indexOf("'", i + 1)
            if (end < 0) throw new Error(`unclosed string in ${src}`)
            tokens.push({ t: "str", v: src.slice(i + 1, end) })
            i = end + 1
            continue
        }
        const word = /^[$#]?[A-Za-z_][A-Za-z0-9_]*|^\d+(\.\d+)?/.exec(src.slice(i))
        if (!word) throw new Error(`can't read "${src.slice(i, i + 12)}" in ${src}`)
        const w = word[0]
        if (w === "not" || w === "and" || w === "or") tokens.push({ t: w })
        else if (w[0] === "$" || w[0] === "#") tokens.push({ t: "name", v: w })
        else tokens.push({ t: "num", v: Number(w) })
        i += w.length
    }
    return tokens
}

/** Evaluate one binding expression. `scope` maps "$variable" and "#binding" to values. */
export function evaluate(src, scope) {
    const tokens = tokenize(src)
    let pos = 0
    const peek = () => tokens[pos]?.t
    const take = t => {
        if (peek() !== t) throw new Error(`expected ${t} at token ${pos} in ${src}`)
        return tokens[pos++]
    }
    const lookup = name => {
        if (!(name in scope)) throw new Error(`${name} is not defined for ${src}`)
        return scope[name]
    }
    function primary() {
        const tok = tokens[pos]
        if (!tok) throw new Error(`ran out of expression in ${src}`)
        if (tok.t === "(") { pos++; const v = or(); take(")"); return v }
        if (tok.t === "str" || tok.t === "num") { pos++; return tok.v }
        if (tok.t === "name") { pos++; return lookup(tok.v) }
        throw new Error(`unexpected ${tok.t} in ${src}`)
    }
    function unary() {
        if (peek() === "not") { pos++; return !unary() }
        return primary()
    }
    function add() {
        let v = unary()
        while (peek() === "+" || peek() === "-") {
            const op = tokens[pos++].t
            const r = unary()
            if (op === "+") v = typeof v === "string" || typeof r === "string" ? `${v}${r}` : v + r
            else v = typeof v === "string" ? v.split(String(r)).join("") : v - r
        }
        return v
    }
    function eq() {
        const v = add()
        if (peek() === "=") { pos++; return v === add() }
        return v
    }
    function and() {
        let v = eq()
        while (peek() === "and") { pos++; const r = eq(); v = !!v && !!r }
        return v
    }
    function or() {
        let v = and()
        while (peek() === "or") { pos++; const r = and(); v = !!v || !!r }
        return v
    }
    const value = or()
    if (pos !== tokens.length) throw new Error(`left over after ${pos} tokens in ${src}`)
    return value
}

/** The expression that decides whether a control is shown. */
export function visibleExpr(control) {
    const binding = (control.bindings ?? []).find(b => b.target_property_name === "#visible")
    return binding?.source_property_name
}

/** A list of `{ "name@base": {...} }` entries as `{ name, base, body, expr }`. */
export function panelsOf(controls) {
    return controls.map(entry => {
        const [key, body] = Object.entries(entry)[0]
        const [name, base] = key.split("@")
        return { name, base, body, expr: visibleExpr(body) }
    })
}

/** Which of the panels show for this title. */
export function shownFor(panels, title, scope = {}) {
    return panels.filter(p => evaluate(p.expr, { ...scope, "#title_text": title })).map(p => p.name)
}
