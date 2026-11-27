import { fold, features, channelScale, MAX_FEATURES, FEATURE_VERSION } from "./toxfeatures.js"

// The chat toxicity model: a hashed linear classifier trained on the PC
// (tools/toxicity), shipped as int8 weights, scored here.
//
// Pure: no game objects. The pack hands it a model spec (from a generated
// weights module) and a message; it answers one score per output. Holding,
// levels and who is told live elsewhere, so the tests can drive this with any
// model.
//
// **Cost.** One message is folded, cut into at most MAX_FEATURES hashed
// pieces, and each piece adds one weight per output. A typical chat line
// makes about 40 to 300 pieces; at the measured 6.5 million multiply-adds a
// second that is well under a millisecond.

/** A spec's weights arrive as base64; Bedrock has no atob, so decode by hand. */
const B64 = (() => {
    const t = new Int16Array(128).fill(-1)
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    for (let i = 0; i < abc.length; i++) t[abc.charCodeAt(i)] = i
    return t
})()

/** Bytes a base64 string decodes to. */
export function decodedLength(text) {
    let pad = 0
    if (text.endsWith("==")) pad = 2
    else if (text.endsWith("=")) pad = 1
    return (text.length / 4) * 3 - pad
}

/**
 * Decode base64 into `out` (an Int8Array) from character `from` to `to`
 * (both multiples of 4). Split so a world can load the model over several
 * ticks instead of one long one.
 */
export function decodeInto(text, out, from = 0, to = text.length) {
    let o = (from / 4) * 3
    for (let i = from; i < to; i += 4) {
        const a = B64[text.charCodeAt(i)], b = B64[text.charCodeAt(i + 1)]
        const c = B64[text.charCodeAt(i + 2)], d = B64[text.charCodeAt(i + 3)]
        const n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63)
        out[o++] = (n >> 16) & 255
        if (c >= 0) out[o++] = (n >> 8) & 255
        if (d >= 0) out[o++] = n & 255
    }
}

/**
 * Check a spec and make the model object, without decoding the weights yet.
 * Refuses a model built for other features: the hashes would land in the
 * wrong rows and every score would be noise that LOOKS like a score.
 */
export function prepareModel(spec) {
    if (!spec || spec.featureVersion !== FEATURE_VERSION) {
        throw new Error(`toxicity model is for features v${spec?.featureVersion}, this pack computes v${FEATURE_VERSION}`)
    }
    const outputs = spec.outputs.length
    const rows = 1 << spec.bits
    if (decodedLength(spec.data) !== rows * outputs) throw new Error("toxicity model weights are the wrong size")
    return {
        outputs: spec.outputs,
        bits: spec.bits,
        mask: rows - 1,
        k: outputs,
        scales: Float64Array.from(spec.scales),
        bias: Float64Array.from(spec.bias),
        levels: spec.levels ?? {},
        weights: new Int8Array(rows * outputs),
        spec,
        ready: false
    }
}

/** Decode everything at once (tools and tests; the pack spreads it over ticks). */
export function loadModel(spec) {
    const model = prepareModel(spec)
    decodeInto(spec.data, model.weights)
    model.ready = true
    return model
}

/**
 * A generator that decodes the weights a slice at a time, for system.runJob.
 * `slice` is in base64 characters and is rounded to a multiple of 4.
 */
export function* loadJob(model, slice = 16384) {
    const text = model.spec.data
    const step = Math.max(4, slice - (slice % 4))
    for (let from = 0; from < text.length; from += step) {
        decodeInto(text, model.weights, from, Math.min(text.length, from + step))
        yield
    }
    model.ready = true
}

const pieces = new Uint32Array(MAX_FEATURES)
const counts = [0, 0, 0, 0]

/**
 * Raw scores (log-odds) for a message, one per output, in the model's order.
 * Higher means more likely; a level's threshold is in the same units.
 * Returns undefined while the model is still loading.
 */
export function scoreMessage(model, text, folded = fold(text)) {
    if (!model?.ready) return undefined
    const n = features(folded, pieces, counts)
    const k = model.k, w = model.weights, mask = model.mask
    const acc = new Float64Array(k)
    let at = 0
    for (let channel = 0; channel < 4; channel++) {
        const end = at + counts[channel]
        const scale = channelScale(channel, counts[channel])
        for (; at < end; at++) {
            const h = pieces[at]
            const row = (h & mask) * k
            const v = h >>> 31 ? -scale : scale
            for (let j = 0; j < k; j++) acc[j] += v * w[row + j]
        }
    }
    if (at !== n) throw new Error("toxicity features miscounted")
    for (let j = 0; j < k; j++) acc[j] = acc[j] * model.scales[j] + model.bias[j]
    return acc
}

/** A log-odds score as a probability, for showing staff. */
export function chance(logit) {
    return 1 / (1 + Math.exp(-logit))
}

/** A log-odds score as the 0 to 100 that staff read. */
export function percent(logit) {
    return Math.round(100 * chance(logit))
}

// ------------------------------------------------------------------ levels
//
// A model spec carries one line per output and level, in log-odds, set on
// held-out data at a precision target (b16-e2-bpsn: Low 95%, Medium 85%,
// High 70% of held lines really toxic, on PUBLIC data). A level holds a line
// when any output it counts is at or over that output's line there.

/** Strictest first, so Low's lines are the highest. */
export const LEVELS = [
    { id: "low", label: "Low", says: "only clear cases" },
    { id: "medium", label: "Medium", says: "also clear insults" },
    { id: "high", label: "High", says: "anything likely toxic" }
]

/**
 * The only outputs that can hold a line. A list of what may act, so an output
 * added in a later model shows its score and acts on nothing until it's named
 * here. The other two are shown, never acted on:
 *   1. Swearing (profanity) is the word list's job: the model lost to the
 *      list on it (2026-11-26).
 *   2. Toxic is Civil Comments' overall score, and plain swearing raises it:
 *      cursing at lava or a creeper reached High on toxic alone (3.1.1). On
 *      the archive it would hold 97 lines at Medium against hostility's 45,
 *      and tools/toxicity/archive_check.mjs never counted it as a hold.
 */
export const HOLDS = new Set(["discrimination", "sexual", "hostility"])

/** An output's line at a level, or undefined when it has none there. */
export function lineFor(model, output, level) {
    const at = model?.levels?.[output]?.[level]
    return typeof at === "number" && Number.isFinite(at) ? at : undefined
}

/**
 * What each level would do with a scored line: per level id, the outputs at
 * or over their line there, highest score first. Empty means it isn't held.
 */
export function verdict(model, scores) {
    const out = {}
    for (const level of LEVELS) {
        out[level.id] = model.outputs
            .map((name, j) => ({ name, score: scores[j], line: lineFor(model, name, level.id) }))
            .filter(r => HOLDS.has(r.name) && r.line !== undefined && r.score >= r.line)
            .sort((a, b) => b.score - a.score)
    }
    return out
}

/**
 * The output closest to its line at a level, for saying why a line ISN'T
 * held there: undefined when no output that holds has a line at that level.
 */
export function closest(model, scores, level) {
    let best
    model.outputs.forEach((name, j) => {
        const line = lineFor(model, name, level)
        if (!HOLDS.has(name) || line === undefined) return
        const gap = line - scores[j]
        if (!best || gap < best.gap) best = { name, score: scores[j], line, gap }
    })
    return best
}

/**
 * Which words push an output up most. The line is scored again without each
 * word in turn, and the biggest drops come first. A hashed linear model has
 * no clearer "why" than that. It costs one scoring per word, so it is for
 * Test a message, never for every chat line.
 *
 * **Its cost is capped by characters, not words.** A scoring costs about
 * 0.03 ms a character in Bedrock (Node x 109), so `budget` characters of
 * re-scoring keep the whole "why" near 50 ms, under the size of tick that
 * draws a script-spike warning. A long line tries its first words only.
 * @returns {{word: string, without: number, drop: number}[]}
 */
export function pushes(model, text, output, most = 3, maxWords = 30, budget = 1500) {
    const j = model?.outputs?.indexOf(output) ?? -1
    if (j < 0 || !model.ready) return []
    const words = String(text ?? "").split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const whole = scoreMessage(model, words.join(" "))[j]
    const tries = pushTries(text, maxWords, budget)
    const tried = []
    for (let i = 0; i < tries; i++) {
        const without = scoreMessage(model, words.filter((_, k) => k !== i).join(" "))[j]
        if (whole - without > 0) tried.push({ word: words[i], without, drop: whole - without })
    }
    return tried.sort((a, b) => b.drop - a.drop).slice(0, most)
}

/** How many words pushes() tries for this line: every one, up to its caps. */
export function pushTries(text, maxWords = 30, budget = 1500) {
    const words = String(text ?? "").split(/\s+/).filter(Boolean)
    if (!words.length) return 0
    const length = words.join(" ").length
    return Math.min(words.length, maxWords, Math.max(1, Math.floor(budget / Math.max(1, length))))
}
