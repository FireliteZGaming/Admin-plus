import { fold, squash, features, featuresOf, channelScale, MAX_CHARS, MAX_FEATURES, FEATURE_VERSION } from "../Admin+ BP/scripts/core/toxfeatures.js"
import { decodeInto, decodedLength, prepareModel, loadModel, loadJob, scoreMessage, chance } from "../Admin+ BP/scripts/core/toxicity.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— folding: what the model reads —")
// Character models survive spacing and leetspeak; Unicode tricks have to be
// undone by hand (research notes, section 3). Each line is a trick seen in
// the wild or in the papers.
{
    check("spaced letters keep their gaps, the squashed copy joins them", [fold("F U C K you"), squash(fold("F U C K you"))], ["f u c k you", "fuckyou"])
    check("dots split like spaces", fold("f.u.c.k"), "f u c k")
    check("long runs shorten to two", fold("fuuuuuuck"), "fuuck")
    check("but a real double letter stays", fold("good noob"), "good noob")
    check("the squashed copy cuts every run to one", squash("fuuck"), "fuck")
    check("leet inside a word", fold("sh1t k1ll urs3lf"), "shit kill urself")
    check("but digits on their own stay digits", fold("gg 2 at 100 64"), "gg 2 at 100 64")
    check("$ inside a word is an s", fold("a$$hole"), "asshole")
    check("punctuation around a word goes, @ included", fold("@Steve you suck!!! (lol)"), "steve you suck lol")
    check("apostrophes join, so you're and youre meet", [fold("you're"), fold("you’re"), fold("youre")], ["youre", "youre", "youre"])
    check("fullwidth letters", fold("ｆｕｃｋ"), "fuck")
    check("maths bold letters", fold("\u{1d41f}\u{1d42e}\u{1d41c}\u{1d424}"), "fuck")
    check("small capitals", fold("ʏᴏᴜ ᴀʀᴇ"), "you are")
    check("Cyrillic lookalikes", fold("сука"), "cyka")
    check("zero-width characters vanish", fold("f​u​ck"), "fuck")
    check("zalgo marks vanish", fold("zalgó̂̃ text"), "zalgo text")
    check("flag letters spell words", fold("\u{1f1eb}\u{1f1fa}\u{1f1e8}\u{1f1f0}"), "fuck")
    check("a line separator is a space, not a broken line", fold("line sep"), "line sep")
    check("nothing in, nothing out", [fold(""), fold(undefined), fold("?!...")], ["", "", ""])
    // 3.1.3: the game hides "§" and the character after it, so the model must
    // too, or a code inside a word splits it where players see one word.
    check("colour codes vanish, even inside a word", [fold("§cid§ci§cot"), fold("§lbold§r text"), fold("§kmagic")], ["idiot", "bold text", "magic"])
    check("a lone § at the end is only a gap", fold("hi §"), "hi")
    // Without the regex's u flag, "§." would take only the emoji's first half
    // and leave the second behind.
    check("a code before an emoji takes the whole emoji, no broken half", fold("gg §😀 wp"), "gg wp")
    check("long text is cut to MAX_CHARS", fold("ab ".repeat(400)).length <= MAX_CHARS, true)
}

console.log("\n— pieces and hashes —")
{
    // " ab " gives 3 + 2 + 1 letter runs of 2, 3 and 4; one word; nothing
    // squashed of 3 or more; one shape piece.
    check("counts for one short word", featuresOf("ab").counts, [6, 1, 0, 1])
    const r = featuresOf("you are an idiot")
    check("counts add up to the pieces written", r.counts.reduce((a, b) => a + b, 0), r.hashes.length)
    check("the same text gives the same pieces", featuresOf("you are an idiot").hashes, r.hashes)
    // **Pinned on purpose.** Every trained model depends on these numbers. If
    // this fails, the hashing changed: bump FEATURE_VERSION and retrain, or
    // the shipped weights read the wrong rows and score noise.
    // 2 (3.1.3) only takes colour codes out first, so a line without any
    // hashes exactly as in 1.
    check("hashes are pinned to FEATURE_VERSION 2", [FEATURE_VERSION, r.hashes.slice(0, 3)], [2, [620609790, 1162442210, 6026022]])
    check("tricks land on the same pieces", featuresOf("F U C K").hashes, featuresOf("f u c k").hashes)
    const big = featuresOf("x".repeat(5000) + " " + "ab ".repeat(2000))
    check("the worst case fits MAX_FEATURES", big.hashes.length <= MAX_FEATURES, true)
    check("text channels scale by one over the square root", [channelScale(0, 4), channelScale(2, 16)], [0.5, 0.25])
    check("the shape piece counts 1, an empty channel 0", [channelScale(3, 1), channelScale(1, 0)], [1, 0])
}

console.log("\n— weights: base64 by hand, because Bedrock has no atob —")
{
    const bytes = Int8Array.from([0, 1, 127, -1, -128, 5, 64, -64, 33, 9])
    const text = Buffer.from(bytes.buffer).toString("base64")
    check("decoded length", decodedLength(text), bytes.length)
    const out = new Int8Array(bytes.length)
    decodeInto(text, out)
    check("bytes come back, signs included", Array.from(out), Array.from(bytes))
}

/** A model of 2^16 rows and two outputs, all zero except the rows given. */
function modelWith(rows = {}, { scales = [0.5, 0.25], bias = [-1, 2], featureVersion = FEATURE_VERSION } = {}) {
    const w = new Int8Array((1 << 16) * 2)
    for (const [row, values] of Object.entries(rows)) { w[row * 2] = values[0]; w[row * 2 + 1] = values[1] }
    return { featureVersion, bits: 16, outputs: ["a", "b"], scales, bias, levels: {}, data: Buffer.from(w.buffer).toString("base64") }
}

console.log("\n— loading a model —")
{
    let refused = ""
    try { prepareModel(modelWith({}, { featureVersion: 99 })) } catch (e) { refused = String(e.message) }
    check("a model for other features is refused", refused.includes("v99"), true)
    const short = { ...modelWith(), data: "AAAA" }
    refused = ""
    try { prepareModel(short) } catch (e) { refused = String(e.message) }
    check("weights of the wrong size are refused", refused.includes("wrong size"), true)

    const spec = modelWith({ 1: [7, -7], 40000: [-127, 127] })
    const whole = loadModel(spec)
    const sliced = prepareModel(spec)
    check("not ready before loading, so nothing is scored", [sliced.ready, scoreMessage(sliced, "hi")], [false, undefined])
    let steps = 0
    for (const _ of loadJob(sliced, 1000)) steps++
    check("a load spread over ticks takes many steps", steps > 10, true)
    check("and ends with the same weights", [sliced.ready, Array.from(sliced.weights.subarray(0, 4)), sliced.weights[80000], sliced.weights[80001]],
        [true, Array.from(whole.weights.subarray(0, 4)), -127, 127])
}

console.log("\n— scoring —")
{
    const empty = loadModel(modelWith())
    check("all-zero weights score the bias", Array.from(scoreMessage(empty, "anything at all")), [-1, 2])

    // Give the whole-word piece for "hello" a weight and nothing else: the
    // score moves by exactly that weight, its sign, its output's scale and
    // the words channel's scale (one word: 1).
    const { hashes, counts } = featuresOf("hello")
    const word = hashes[counts[0]]
    const row = word & 0xffff
    const sign = word >>> 31 ? -1 : 1
    const model = loadModel(modelWith({ [row]: [100, -50] }))
    const s = scoreMessage(model, "hello")
    check("one weighted piece moves the score by weight x scale", [s[0] - -1, s[1] - 2], [sign * 100 * 0.5, sign * -50 * 0.25])
    check("folding tricks score the same", Array.from(scoreMessage(model, "H E L L O".split(" ").join(""))), Array.from(s))
    check("log-odds read as a chance", [chance(0), Math.round(chance(4) * 1000) / 1000], [0.5, 0.982])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
