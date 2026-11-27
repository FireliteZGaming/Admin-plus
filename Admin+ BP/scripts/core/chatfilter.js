import { setting, flag } from "./settings.js"

// Chat screening, in the shape of Twitch's AutoMod — minus the half we cannot
// have, and honest about which half that is.
//
// **What Twitch does that we cannot.** Their AutoMod is a machine-learning
// classifier: it SCORES a message for how likely it is to be harmful, which is
// why it reads context and why "I hate this block" survives while the same
// words aimed at a person do not. Scripts here have no network at all —
// `@minecraft/server-net` is dedicated-server only, so a realm or a local world
// can reach nothing — and a classifier is not something a behaviour pack can
// carry. So this matches TERMS. It cannot read intent and never claims to.
//
// **What we take instead, and it is the good part.** A flagged message is HELD
// for a moderator rather than punished, and the sender is not told. That is the
// design worth copying:
//
//   * a false positive costs a moderator one tap, where a false positive on an
//     auto-mute costs an innocent player ten minutes and costs the server its
//     reputation;
//   * the sender sees their own message echoed back as if it posted, so a troll
//     gets no feedback loop to iterate against;
//   * and it keeps faith with this pack's existing rule — automod punishes what
//     it COUNTS (flooding) and only ever alerts on what it GUESSES. A term
//     filter is a guess, so it holds.
//
// **The thing that will misfire, stated plainly.** Substring matching finds
// banned words inside innocent ones — the Scunthorpe problem — and the
// normalisation below makes it worse, because folding `4→a` and stripping
// punctuation is exactly what turns a clean word dirty. That is why levels 1
// and 2 match WHOLE WORDS and only level 3 looks inside, and why there is an
// allow list. Set 3 knowing what it is.

/** The four categories, each with its own sensitivity and its own terms. */
export const CATEGORIES = [
    {
        id: "discrimination",
        label: "Discrimination",
        level: "filter.discrimination",
        terms: "filter.terms.discrimination"
    },
    {
        id: "sexual",
        label: "Sexual content",
        level: "filter.sexual",
        terms: "filter.terms.sexual"
    },
    {
        id: "aggression",
        label: "Hostility",
        level: "filter.aggression",
        terms: "filter.terms.aggression"
    },
    {
        id: "profanity",
        label: "Profanity",
        level: "filter.profanity",
        terms: "filter.terms.profanity"
    }
]

/**
 * Shipped starting points, deliberately small.
 *
 * **Discrimination ships EMPTY, on purpose.** A slur list is specific to a
 * community and to a language, and baking one in would be this pack deciding
 * what a realm in another country finds unacceptable. The owner fills it in,
 * and the help text on the setting says so. Empty means that category catches
 * nothing until somebody configures it — which is honest, where a token list
 * pretending to cover the subject would not be.
 *
 * The other three carry enough to be useful out of the box.
 */
const SEEDS = {
    discrimination: [],
    sexual: ["porn", "nudes", "sexting", "nsfw"],
    aggression: ["kys", "kill yourself", "kill urself", "neck yourself", "go die"],
    profanity: ["fuck", "shit", "bitch", "cunt", "wanker", "bastard"]
}

/** Zero-width and direction characters, which exist to hide things. */
const INVISIBLE = /[​-‏⁠᠎﻿]/g

/** Cyrillic and Greek letters that render as Latin ones. */
const HOMOGLYPHS = {
    "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o",
    "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ѕ": "s",
    "ј": "j", "α": "a", "ο": "o", "ρ": "p", "ѵ": "v"
}

/** Digits and symbols typed in place of letters. */
const LEET = {
    "4": "a", "@": "a", "^": "a", "8": "b", "(": "c", "3": "e", "6": "g",
    "9": "g", "1": "i", "!": "i", "|": "i", "0": "o", "5": "s", "$": "s",
    "7": "t", "+": "t", "2": "z"
}

/**
 * Fold a message down to something comparable.
 *
 * Both sides go through this — the message AND the term — so the two always
 * agree about what a word looks like. A filter that normalised only the haystack
 * would stop matching its own list the moment somebody wrote `sh1t`.
 *
 * @param {number} level 1 = case and lookalikes · 2 = + leet and stutter ·
 *                       3 = + every separator removed, so words run together
 */
export function normalise(text, level = 2) {
    // Colour codes first (3.1.3): the game hides "§" and the character after
    // it, so "§c" inside a word must not split it (core/toxfeatures.js too).
    let out = String(text ?? "").replace(/§./gu, "").toLowerCase().replace(INVISIBLE, "")
    out = [...out].map(c => HOMOGLYPHS[c] ?? c).join("")

    if (level >= 2) {
        out = [...out].map(c => LEET[c] ?? c).join("")
        // Runs collapse to ONE, so `fuuuuck` and `fuck` land on the same string.
        // The term list is folded the same way, which is what keeps them equal.
        out = out.replace(/(.)\1+/g, "$1")
    }

    // Level 3 removes the gaps entirely, which is what catches `f.u.c.k` and
    // `f u c k` — and also what makes it find words inside other words.
    return level >= 3
        ? out.replace(/[^a-z0-9]+/g, "")
        : out.replace(/[^a-z0-9]+/g, " ").trim()
}

/** A comma or newline separated setting, as a list. */
export function listOf(key) {
    return String(setting(key) ?? "")
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(Boolean)
}

function levelOf(category) {
    const n = Math.floor(Number(setting(category.level)))
    return Number.isFinite(n) && n > 0 ? Math.min(n, 3) : 0
}

/**
 * The first term in `terms` that this message uses, or undefined.
 *
 * Levels 1 and 2 compare WHOLE WORDS, which is the difference between catching
 * "ass" and catching "classic". Level 3 looks anywhere, and the allow list is
 * the only thing standing between it and every word that contains another.
 */
export function findTerm(text, terms, level, allow = []) {
    if (!level) return undefined
    const hay = normalise(text, level)
    if (!hay) return undefined

    if (level >= 3) {
        // **Allowed words are REMOVED, not consulted.**
        //
        // The first version asked "does an allowed word in this message contain
        // the hit" and skipped if so — which excused every occurrence in the
        // line, not the one that was inside it. "class, you ass" came back
        // clean, so typing one innocent word bought you the real one for free.
        //
        // Cutting them out first leaves only what nobody vouched for:
        // "classyouass" minus "class" is "youass", which still contains it.
        // Longest first, so "classic" goes before "class" can chew a hole in it.
        let hunt = hay
        for (const word of allow.map(a => normalise(a, level)).filter(Boolean)
            .sort((a, b) => b.length - a.length)) {
            hunt = hunt.split(word).join(" ")
        }
        for (const term of terms) {
            const needle = normalise(term, level)
            if (needle && hunt.includes(needle)) return term
        }
        return undefined
    }

    const words = new Set(hay.split(" ").filter(Boolean))
    const allowed = new Set(allow.map(a => normalise(a, level)))
    for (const term of terms) {
        const needle = normalise(term, level)
        if (!needle || allowed.has(needle)) continue
        // A multi-word term ("kill yourself") has to be looked for in the line.
        if (needle.includes(" ") ? hay.includes(needle) : words.has(needle)) return term
    }
    return undefined
}

/** Every term a category screens for: what ships, plus what the owner added. */
export function termsFor(category) {
    return [...(SEEDS[category.id] ?? []), ...listOf(category.terms)]
}

/**
 * Should this message be held? Returns what tripped it, or undefined.
 *
 * Categories are asked in order, so the answer names the most serious thing the
 * message did rather than the last.
 */
export function screen(text) {
    if (!flag("filter.enabled")) return undefined
    return wordListMatch(text)
}

/**
 * What the word list would hold with this server's settings, whether
 * screening is switched on or not. For /automod ▸ Chat ▸ Test a message
 * (3.1.0), which sets the model beside the list on the same line.
 */
export function wordListMatch(text) {
    const allow = listOf("filter.allow")
    for (const category of CATEGORIES) {
        const level = levelOf(category)
        if (!level) continue
        const term = findTerm(text, termsFor(category), level, allow)
        if (term) return { category: category.id, label: category.label, term, level }
    }
    return undefined
}

/**
 * Every word-list category a line uses, at level 2 (whole words, leet and
 * stutter), with this server's own words added. For Chat Moderation (3.1.4),
 * whose switches decide which of them count; the old screening's per-category
 * levels don't apply to it.
 * @returns {{category: string, label: string, term: string}[]}
 */
export function wordListCategories(text) {
    const allow = listOf("filter.allow")
    const out = []
    for (const category of CATEGORIES) {
        const term = findTerm(text, termsFor(category), 2, allow)
        if (term) out.push({ category: category.id, label: category.label, term })
    }
    return out
}

/** For the settings screen: each category with the level it is set to. */
export function sensitivities() {
    return CATEGORIES.map(c => ({ ...c, value: levelOf(c) }))
}
