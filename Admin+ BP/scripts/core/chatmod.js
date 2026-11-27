// Chat Moderation's rules (3.1.4): the thinking only, no game objects, so the
// tests can drive every level and ladder. features/chatmod.js acts on them.
//
// The user's layout, 2026-11-26: "Chat Moderation", with "the simple Low
// Medium High", a switch for confirming with the player first, then the
// categories, "common categories but not too many" (Twitch's four, which it
// calls Hostility, Discrimination, Sex-based terms and Profanity) and Spam as
// a fifth ("spam should be a fifth switch of course").
//
// Only Profanity and Spam act on a player by themselves. They are COUNTED
// (how much swearing, how many messages), which is the line automod has
// always drawn: it punishes what it counts and leaves what it guesses to
// staff. Harassment, Hate speech and Sexual content are the model's guesses,
// so a caught line is asked about or held, and staff decide.

/**
 * The five switches, in the page's order. `output` is the model's output for
 * the category and `list` the word list's category, either of which catches
 * a line; Profanity uses the word list alone (the model lost to it on
 * swearing) and Spam counts messages.
 */
export const CATEGORIES = [
    { id: "harassment", key: "automod.chatHarassment", label: "Harassment", output: "hostility", list: "aggression",
        detail: "Insults, threats, death wishes, telling someone to hurt themselves" },
    { id: "hate", key: "automod.chatHate", label: "Hate speech", output: "discrimination", list: "discrimination",
        detail: "Slurs, and attacks on a group" },
    { id: "sexual", key: "automod.chatSexual", label: "Sexual content", output: "sexual", list: "sexual",
        detail: "Sexual messages, and asking players for pictures" },
    { id: "profanity", key: "automod.chatProfanity", label: "Profanity", list: "profanity",
        detail: "Swearing too much: a warning, then a mute" },
    { id: "spam", key: "automod.spam", label: "Spam",
        detail: "Too many messages too fast: a warning, then mutes" }
]

/** The categories whose caught lines are asked about or held: the model's guesses. */
export const HELD_CATEGORIES = CATEGORIES.filter(c => c.output)

/**
 * What each level means beyond the model's lines (core/toxicity.js LEVELS).
 * The user: Profanity gets "the light warn if used too much, then muted,
 * never really kicked unless spamming it, that would be on medium, low would
 * never actually kick".
 *   swearWarnAt     swearing lines within SWEAR_WINDOW before a warning
 *   swearAfterWarn  more swearing lines within the window after it: a mute
 *   swearMute       minutes muted for swearing (never a kick)
 *   spamKicks       a player who keeps spamming after the longest mute is kicked
 */
export const LEVEL_RULES = {
    low: { swearWarnAt: 8, swearAfterWarn: 4, swearMute: 2, spamKicks: false },
    medium: { swearWarnAt: 5, swearAfterWarn: 3, swearMute: 5, spamKicks: true },
    high: { swearWarnAt: 3, swearAfterWarn: 2, swearMute: 10, spamKicks: true }
}

/** How far back swearing counts. */
export const SWEAR_WINDOW = 2 * 60000
/** How long a swearing warning is remembered with no swearing since. */
export const WARNING_LASTS = 10 * 60000

/**
 * One more swearing line. `state` is { times, warnedAt } or undefined for a
 * player with none; returns { state, action } where action is "none", "warn"
 * or "mute". A warning or a mute starts the count afresh.
 */
export function noteSwearing(state, now, rules) {
    let warnedAt = state?.warnedAt
    let times = (state?.times ?? []).filter(t => now - t < SWEAR_WINDOW)
    // A warning fades once they've gone a while without swearing.
    if (warnedAt !== undefined && now - Math.max(warnedAt, times.at(-1) ?? warnedAt) > WARNING_LASTS) warnedAt = undefined
    times = [...times, now]
    if (warnedAt === undefined) {
        if (times.length >= rules.swearWarnAt) return { state: { times: [], warnedAt: now }, action: "warn" }
        return { state: { times, warnedAt }, action: "none" }
    }
    if (times.length >= rules.swearAfterWarn) return { state: { times: [], warnedAt: undefined }, action: "mute" }
    return { state: { times, warnedAt }, action: "none" }
}

/**
 * What spam strike `strike` earns, from the ladder in seconds (0 is a
 * warning). Past the ladder's end it repeats the longest mute, or, at a level
 * that kicks, it kicks.
 * @returns {{kind: "warn"|"mute"|"kick", seconds: number}}
 */
export function spamAction(strike, ladder, rules) {
    const steps = ladder.length ? ladder : [0]
    if (strike > steps.length && rules.spamKicks) return { kind: "kick", seconds: 0 }
    const seconds = steps[Math.min(Math.max(strike, 1), steps.length) - 1] ?? 0
    return seconds > 0 ? { kind: "mute", seconds } : { kind: "warn", seconds: 0 }
}

/**
 * Which switched-on categories a line is caught for: the model's at the
 * level first, then any the word list adds. `verdictAtLevel` is
 * core/toxicity.js verdict()[level], `listMatches` the word list's
 * categories (core/chatfilter.js wordListCategories), and `on` says whether
 * a category's switch is on.
 * @returns {{category: object, by: "model"|"list", score?: number, line?: number, term?: string}[]}
 */
export function caughtFor(verdictAtLevel, listMatches, on) {
    const model = [], list = []
    for (const category of HELD_CATEGORIES) {
        if (!on(category)) continue
        const hit = (verdictAtLevel ?? []).find(h => h.name === category.output)
        const listed = (listMatches ?? []).find(l => l.category === category.list)
        if (hit) model.push({ category, by: "model", score: hit.score, line: hit.line })
        else if (listed) list.push({ category, by: "list", term: listed.term })
    }
    return [...model.sort((a, b) => b.score - a.score), ...list]
}

/** The category a model output belongs to. */
export function categoryOfOutput(output) {
    return HELD_CATEGORIES.find(c => c.output === output)
}
