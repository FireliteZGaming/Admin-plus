// What the chat toxicity model reads: a folded copy of the message, cut into
// hashed pieces.
//
// **One copy of this code, on purpose.** tools/toxicity/featurize.mjs imports
// THIS file to turn the training data into features, so what a model learned
// from and what it reads in game are the same function, not two that are meant
// to agree. Change anything here and every model must be retrained: bump
// FEATURE_VERSION, and the loader refuses weights made for another version.
//
// Pure: no game objects, so Node runs it as it is.
//
// **Why it folds the way it does** (research notes, Obsidian ▸ Admin+ ▸
// Research ▸ Bedrock chat toxicity and harassment, section 3): character
// models survive spacing and leetspeak tricks that break word models, but
// Unicode tricks (lookalike letters, invisible characters, "fancy text") have
// to be undone by hand, because a model never learns them away. Digits become
// letters only inside a word that has letters, so "gg 2" and coordinates stay
// as they are.

/**
 * Bump when anything below changes what a message turns into.
 * 2 (3.1.3): Minecraft colour codes come out first. The game hides "§" and
 * the character after it, so "§c" inside a word showed the plain word to
 * players while the model read the pieces around it.
 */
export const FEATURE_VERSION = 2

/**
 * Longest folded text the model reads. Chat is short: half of the 6,979
 * archived lines are 9 characters or fewer, and 99% are under 80.
 */
export const MAX_CHARS = 256

/** The four kinds of piece, each scaled on its own (see channelScale). */
export const CHANNELS = ["letters", "words", "squashed", "shape"]

/**
 * Most pieces one message can make: letter runs of 2 to 5 over the padded
 * text, words and word pairs, squashed runs of 3 to 5, one shape piece.
 */
export const MAX_FEATURES = 4 * (MAX_CHARS + 2) + 2 * MAX_CHARS + 3 * MAX_CHARS + 1

// ---------------------------------------------------------------- folding

/** A Minecraft colour or format code: "§" and the one character the game hides with it. */
const CODES = /§./gu

/** Invisible characters, direction marks, fillers and tag characters. */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|\udb40[\udc00-\udc7f]/g

/** Accents and "zalgo" marks stacked on letters. */
const COMBINING = /[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g

/** Every kind of space, tab and line break. */
const SPACES = /[\t\n\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g

/** Lookalikes after lowercasing: small capitals, letterlike symbols, accented letters, Cyrillic and Greek. */
const MAP = (() => {
    const map = {}
    const add = (from, to) => { for (const ch of from) map[ch] = to }
    // Small capitals, as "fancy text" sites type them.
    add("ᴀ", "a"); add("ʙ", "b"); add("ᴄ", "c"); add("ᴅ", "d"); add("ᴇ", "e")
    add("ꜰ", "f"); add("ɢ", "g"); add("ʜ", "h"); add("ɪ", "i"); add("ᴊ", "j")
    add("ᴋ", "k"); add("ʟ", "l"); add("ᴍ", "m"); add("ɴ", "n"); add("ᴏ", "o")
    add("ᴘ", "p"); add("ǫ", "q"); add("ʀ", "r"); add("ꜱ", "s"); add("ᴛ", "t")
    add("ᴜ", "u"); add("ᴠ", "v"); add("ᴡ", "w"); add("ʏ", "y"); add("ᴢ", "z")
    // Letterlike symbols that fill the gaps in the maths alphabets.
    add("ℂℭ", "c"); add("ℊ", "g"); add("ℋℌℍℎ", "h"); add("ℐℑ", "i")
    add("ℒℓ", "l"); add("ℕ", "n"); add("ℙ", "p"); add("ℚ", "q"); add("ℛℜℝ", "r")
    add("ℤℨ", "z"); add("ℬ", "b"); add("ℰℯ", "e"); add("ℱ", "f"); add("ℳ", "m")
    add("ℴ", "o")
    // Accented Latin letters.
    add("àáâãäåāăąǎȁȃ", "a"); add("çćĉċč", "c"); add("ďđ", "d")
    add("èéêëēĕėęěȅȇ", "e"); add("ĝğġģ", "g"); add("ĥħ", "h")
    add("ìíîïĩīĭįıǐȉȋ", "i"); add("ĵ", "j"); add("ķ", "k"); add("ĺļľŀł", "l")
    add("ñńņňŉ", "n"); add("òóôõöøōŏőǒȍȏ", "o"); add("ŕŗř", "r")
    add("śŝşšș", "s"); add("ţťŧț", "t"); add("ùúûüũūŭůűųǔȕȗ", "u"); add("ŵ", "w")
    add("ýÿŷ", "y"); add("źżž", "z"); add("ß", "ss"); add("æ", "ae"); add("œ", "oe")
    add("þ", "th"); add("ð", "d")
    // Cyrillic and Greek letters that render as Latin ones (the word list's
    // set, core/chatfilter.js, plus the rest of the common ones).
    add("а", "a"); add("в", "b"); add("е", "e"); add("к", "k"); add("м", "m")
    add("н", "h"); add("о", "o"); add("р", "p"); add("с", "c"); add("т", "t")
    add("у", "y"); add("х", "x"); add("і", "i"); add("ѕ", "s"); add("ј", "j")
    add("ԁ", "d"); add("һ", "h"); add("ӏ", "l"); add("ԛ", "q"); add("ԝ", "w")
    add("ɡ", "g"); add("ѵ", "v"); add("ё", "e"); add("ї", "i")
    add("α", "a"); add("β", "b"); add("ε", "e"); add("η", "n"); add("ι", "i")
    add("κ", "k"); add("ν", "v"); add("ο", "o"); add("ρ", "p"); add("τ", "t")
    add("υ", "u"); add("χ", "x"); add("ω", "w")
    return map
})()

/** Digits and symbols typed for letters, undone only inside a word with letters. */
const LEET = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "9": "g",
    "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "(": "c"
}
const LEET_CHARS = /[0134579@$!|+(]/g
const HAS_LETTER = /[a-z]/

/** Punctuation around a word ("idiot!", "(lol)", "@Steve"), but not "$" ("a$$"). */
const EDGE_START = /^[\u0000-#%-/:-@[-`{-\u007f]+/
const EDGE_END = /[\u0000-#%-/:-@[-`{-\u007f]+$/
const APOSTROPHES = /['\u2018\u2019`]/g

/** Three or more of one character become two, so "fuuuuck" and "fuuck" meet but "good" stays. */
const RUN3 = /(.)\1{2,}/g
const RUN2 = /(.)\1+/g

/**
 * What splits words: ASCII punctuation, Latin-1 and general punctuation, CJK
 * punctuation. Letters of other scripts, CJK and emoji stay.
 */
const SEPARATOR = /[^a-z0-9\u00c0-\u1fff\u2070-\u2fff\u3040-\uffff]+/

/** The four maths alphabets and friends, decoded to plain letters. */
function decodeFancy(text) {
    let out = ""
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c >= 0xff01 && c <= 0xff5e) { out += String.fromCharCode(c - 0xfee0); continue }   // fullwidth
        if (c >= 0x24b6 && c <= 0x24cf) { out += String.fromCharCode(0x61 + c - 0x24b6); continue } // Ⓐ
        if (c >= 0x24d0 && c <= 0x24e9) { out += String.fromCharCode(0x61 + c - 0x24d0); continue } // ⓐ
        if (c >= 0x249c && c <= 0x24b5) { out += String.fromCharCode(0x61 + c - 0x249c); continue } // ⒜
        if ((c === 0xd835 || c === 0xd83c) && i + 1 < text.length) {
            const lo = text.charCodeAt(i + 1)
            const cp = ((c - 0xd800) << 10) + (lo - 0xdc00) + 0x10000
            let ch
            if (cp >= 0x1d400 && cp <= 0x1d6a3) ch = String.fromCharCode(0x61 + (cp - 0x1d400) % 52 % 26)
            else if (cp >= 0x1d7ce && cp <= 0x1d7ff) ch = String.fromCharCode(0x30 + (cp - 0x1d7ce) % 10)
            else if (cp >= 0x1f130 && cp <= 0x1f149) ch = String.fromCharCode(0x61 + cp - 0x1f130) // 🄰
            else if (cp >= 0x1f150 && cp <= 0x1f169) ch = String.fromCharCode(0x61 + cp - 0x1f150) // 🅐
            else if (cp >= 0x1f170 && cp <= 0x1f189) ch = String.fromCharCode(0x61 + cp - 0x1f170) // 🅰
            else if (cp >= 0x1f1e6 && cp <= 0x1f1ff) ch = String.fromCharCode(0x61 + cp - 0x1f1e6) // 🇦
            if (ch !== undefined) { out += ch; i++; continue }
        }
        out += text[i]
    }
    return out
}

/**
 * The message as the model reads it: lowercase plain letters, words split on
 * punctuation and single-spaced, lookalikes and leetspeak undone, long runs
 * shortened. At most MAX_CHARS long.
 */
export function fold(text) {
    let s = String(text ?? "")
    if (s.length > 4 * MAX_CHARS) s = s.slice(0, 4 * MAX_CHARS)
    s = decodeFancy(s.replace(CODES, "")).toLowerCase()
        .replace(INVISIBLE, "")
        .replace(COMBINING, "")
        .replace(SPACES, " ")

    let mapped = ""
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        const to = MAP[ch]
        mapped += to === undefined ? ch : to
    }

    const words = []
    for (const raw of mapped.split(" ")) {
        if (!raw) continue
        let word = raw.replace(EDGE_START, "").replace(EDGE_END, "").replace(APOSTROPHES, "")
        if (!word) continue
        if (HAS_LETTER.test(word)) word = word.replace(LEET_CHARS, c => LEET[c])
        word = word.replace(RUN3, "$1$1")
        for (const part of word.split(SEPARATOR)) if (part) words.push(part)
    }

    const out = words.join(" ")
    return out.length > MAX_CHARS ? out.slice(0, MAX_CHARS).trimEnd() : out
}

/** The folded text with every gap removed and every run cut to one: "f u c k" and "fuuuck" both read "fuck". */
export function squash(folded) {
    return String(folded ?? "").split(" ").join("").replace(RUN2, "$1")
}

// ---------------------------------------------------------------- hashing

const PRIME = 0x01000193
const SEED_LETTERS = 0x811c9dc5 | 0
const SEED_WORD = 0x2f6b3a51 | 0
const SEED_PAIR = 0x6c8e9cf5 | 0
const SEED_SQUASH = 0x1b873593 | 0
const SEED_SHAPE = 0x5bd1e995 | 0

/** MurmurHash3's finaliser: every input bit reaches every output bit. */
function mix(h) {
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return h >>> 0
}

/** FNV-1a over a string, continued from `h`. */
function feed(h, text) {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), PRIME)
    return h
}

/** Every run of minN to maxN characters in `text`, hashed into out[at...]. */
function runs(text, seed, minN, maxN, out, at) {
    const length = text.length
    for (let i = 0; i < length; i++) {
        let h = seed
        const end = Math.min(length, i + maxN)
        for (let j = i; j < end; j++) {
            h = Math.imul(h ^ text.charCodeAt(j), PRIME)
            if (j - i + 1 >= minN) out[at++] = mix(h)
        }
    }
    return at
}

/** Which length a message is, as one shape piece: 1, 2, 3, 4 to 6, 7 to 12, or more words. */
function lengthBucket(wordCount) {
    if (wordCount <= 3) return wordCount
    if (wordCount <= 6) return 4
    if (wordCount <= 12) return 5
    return 6
}

/**
 * Hash a folded message's pieces into `out` (a Uint32Array of at least
 * MAX_FEATURES), grouped by channel, and put each channel's count in
 * `counts` (four numbers). Returns how many were written.
 *
 * A hash's low bits pick the weight row and its top bit the sign, so one
 * table serves every size: a model with 2^16 rows reads `h & 0xffff`.
 */
export function features(folded, out, counts) {
    const text = String(folded ?? "")
    let at = 0

    // 1. Runs of 2 to 5 letters over the text with a space at each end, so a
    //    word's first and last letters are pieces of their own.
    at = runs(" " + text + " ", SEED_LETTERS, 2, 5, out, at)
    counts[0] = at

    // 2. Whole words and neighbouring pairs.
    const words = text ? text.split(" ") : []
    for (let i = 0; i < words.length; i++) {
        out[at++] = mix(feed(SEED_WORD, words[i]))
        if (i + 1 < words.length) out[at++] = mix(feed(feed(feed(SEED_PAIR, words[i]), " "), words[i + 1]))
    }
    counts[1] = at - counts[0]

    // 3. Runs of 3 to 5 over the squashed text, which reads "s c r e w" and
    //    "st.upid" as the words they spell.
    const before = at
    at = runs(squash(text), SEED_SQUASH, 3, 5, out, at)
    counts[2] = at - before

    // 4. One piece for the length, because a one-word line and a paragraph
    //    are not equally likely to be rude.
    out[at++] = mix(Math.imul(SEED_SHAPE ^ lengthBucket(words.length), PRIME))
    counts[3] = 1
    return at
}

/**
 * How much each piece in a channel counts: one over the square root of the
 * channel's size for the text channels, so a long message's pieces add up to
 * about as much as a short one's, and 1 for the shape piece. The trainer uses
 * the same rule (tools/toxicity/train.py, channel_scale).
 */
export function channelScale(channel, count) {
    if (count <= 0) return 0
    return channel === 3 ? 1 : 1 / Math.sqrt(count)
}

/** For tools and tests: a message's pieces as plain arrays. */
export function featuresOf(text) {
    const folded = fold(text)
    const out = new Uint32Array(MAX_FEATURES)
    const counts = [0, 0, 0, 0]
    const n = features(folded, out, counts)
    return { folded, hashes: Array.from(out.subarray(0, n)), counts }
}
