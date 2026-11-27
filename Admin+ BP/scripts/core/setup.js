// Setup (3.1.6): the thinking behind the first-run setup, with no game object
// in sight. features/setup.js has the screens and does the work.
//
// The user, 2026-11-26: "when you first join, it should give you the 'getting
// started' ... setting up your world/realm/server", then ranks ("create your
// own roles or use the basic setup, or ... not having ranks set up at all"),
// automod ("max is all features at high, automod high is all features at
// medium, automod medium is some of the features"), essentials ("Essential
// Teleportation like tpa, or Modded private chats ... land claims, maybe
// homes"), "and then whatever is next". The Set up button in /admin shows
// only while nothing has been changed: "If you have it probably means you know
// what you are doing, specifically if you created a rank."
//
// A world, a Realm and a dedicated server can't be told apart from a script:
// Microsoft's Script API has no property for it (checked 2026-11-26), so the
// screens say "server" and name all three once.

/** The broad word for the place being set up. */
export const PLACE = "server"

/**
 * The ranks step. "keep" is offered only when the world already has ranks of
 * its own. "none" keeps the rank list and takes the tags away, so nobody looks
 * ranked and operators run things; it can be undone with the Rank tags switch.
 */
export const RANK_CHOICES = [
    { id: "keep", label: "Keep my ranks", says: "Change nothing about ranks" },
    { id: "basic", label: "Basic ranks", says: "Owner, Co-Owner, Manager, Admin, Mod and Member" },
    { id: "own", label: "Make my own ranks", says: "Start from Owner and Member, then add yours" },
    { id: "none", label: "No ranks", says: "No tags in chat or above heads. Operators can do everything; everyone else gets the basics" }
]

/**
 * The automod step, the user's scale. Max is every check on High, High is
 * every check on Medium, Medium is some of them: Bot Guard on its tested
 * Medium, and Chat Moderation on Low with swearing allowed. Anti-cheat joins
 * these when it's built (ore alerts and fast breaking are on hold until then).
 * Bot Guard's action at the limit is left alone: it flags unless a server
 * chooses kick or ban itself.
 */
export const AUTOMOD_LEVELS = [
    {
        id: "off", label: "Off", says: "nothing is watched",
        settings: { "automod.bots": "false", "automod.chatWatch": "off" }
    },
    {
        id: "medium", label: "Medium", says: "Bot Guard, and Chat Moderation on Low. Swearing is fine",
        settings: {
            "automod.bots": "true", "automod.botLevel": "medium", "automod.chatWatch": "low",
            "automod.chatHarassment": "true", "automod.chatHate": "true", "automod.chatSexual": "true",
            "automod.chatProfanity": "false", "automod.spam": "true"
        }
    },
    {
        id: "high", label: "High", says: "every check, each on Medium. Swearing is counted",
        settings: {
            "automod.bots": "true", "automod.botLevel": "medium", "automod.chatWatch": "medium",
            "automod.chatHarassment": "true", "automod.chatHate": "true", "automod.chatSexual": "true",
            "automod.chatProfanity": "true", "automod.spam": "true"
        }
    },
    {
        id: "max", label: "Max", says: "every check, each on High. The strictest",
        settings: {
            "automod.bots": "true", "automod.botLevel": "high", "automod.chatWatch": "high",
            "automod.chatHarassment": "true", "automod.chatHate": "true", "automod.chatSexual": "true",
            "automod.chatProfanity": "true", "automod.spam": "true"
        }
    }
]

/** The everyday commands players get. */
export const ESSENTIALS = [
    { key: "feature.tpa", label: "Teleport requests", says: "/tpa" },
    { key: "feature.homes", label: "Homes", says: "/home" },
    { key: "feature.warps", label: "Warps", says: "/warp" },
    { key: "feature.spawn", label: "Spawn", says: "/spawn" },
    { key: "feature.back", label: "Go back", says: "/back" },
    { key: "feature.rtp", label: "Random teleport", says: "/rtp" },
    { key: "feature.pm", label: "Private messages and chats", says: "/pm, /prchat" },
    { key: "feature.claims", label: "Land claims", says: "/claim" }
]

/** The last step: how chat looks and how the world runs. Badges need rank tags. */
export const WORLD_SWITCHES = [
    { key: "feature.badges", label: "Badges", says: "a picture before rank tags", needsTags: true },
    { key: "presence.announce", label: "Join and leave lines" },
    { key: "presence.greet", label: "Welcome new players", says: "one line about /info" },
    { key: "spawn.protect", label: "Protect spawn", says: "only staff build near it" },
    { key: "cleanup.auto", label: "Lag clear by itself", says: "after a countdown" },
    { key: "logs.chat", label: "Keep a chat log", says: "staff can read chat back" }
]

const truthy = value => !["false", "0", "off", "no", ""].includes(String(value ?? "").trim().toLowerCase())

/** A rank list compared by what it holds, whatever order its keys are in. */
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
    }
    return value
}
export function sameRanks(a, b) { return JSON.stringify(canonical(a ?? {})) === JSON.stringify(canonical(b ?? {})) }

/**
 * Nothing changed yet: no setting moved off its default and the rank list is
 * the one a new world starts with. The Set up button shows only then.
 */
export function untouched({ overrides, ranks, defaultRanks }) {
    return Object.keys(overrides ?? {}).length === 0 && sameRanks(ranks, defaultRanks)
}

/** The automod switches compared as on or off; the levels compared as words. */
const SWITCH_KEYS = new Set(["automod.bots", "automod.chatHarassment", "automod.chatHate", "automod.chatSexual", "automod.chatProfanity", "automod.spam"])

/** Which automod level the settings match now, or "" for a mix of its own. */
export function automodLevelOf(read) {
    if (!truthy(read("automod.bots")) && String(read("automod.chatWatch") ?? "off").toLowerCase() === "off") return "off"
    const matches = level => Object.entries(level.settings).every(([key, value]) => SWITCH_KEYS.has(key)
        ? truthy(read(key)) === truthy(value)
        : String(read(key) ?? "").toLowerCase() === value)
    return AUTOMOD_LEVELS.slice(1).find(matches)?.id ?? ""
}

/** Automod right now, in a few words. */
export function automodNow(read) {
    const bots = truthy(read("automod.bots")) ? `Bot Guard on (${titleCase(read("automod.botLevel") ?? "medium")})` : "Bot Guard off"
    const level = String(read("automod.chatWatch") ?? "off").toLowerCase()
    const chat = level === "off" ? "Chat Moderation off" : `Chat Moderation on ${titleCase(level)}`
    return `${bots}, ${chat}`
}

function titleCase(word) {
    const text = String(word ?? "")
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

/**
 * Every setting the answers change, as { key, to }, leaving out what already
 * has that value. Ranks are handled apart (they are a list, not a setting),
 * but their tags are a setting: basic and own ranks show tags, no ranks hide
 * them, keep leaves them alone.
 */
export function settingChanges(draft, read) {
    const wanted = {}
    if (draft.ranks === "basic" || draft.ranks === "own") wanted["feature.ranktags"] = "true"
    if (draft.ranks === "none") wanted["feature.ranktags"] = "false"
    const level = AUTOMOD_LEVELS.find(l => l.id === draft.automod)
    if (level) Object.assign(wanted, level.settings)
    for (const { key } of ESSENTIALS) if (key in (draft.essentials ?? {})) wanted[key] = draft.essentials[key] ? "true" : "false"
    for (const { key } of WORLD_SWITCHES) if (key in (draft.world ?? {})) wanted[key] = draft.world[key] ? "true" : "false"
    return Object.entries(wanted)
        .filter(([key, to]) => String(read(key) ?? "").toLowerCase() !== to)
        .map(([key, to]) => ({ key, to }))
}

/**
 * What the answers will do, one line per step, for the last screen before
 * Apply. `replacesRanks`: the rank list will be swapped for another.
 */
export function summaryLines(draft, read, { replacesRanks = false } = {}) {
    const ranks = RANK_CHOICES.find(c => c.id === draft.ranks) ?? RANK_CHOICES[0]
    const level = AUTOMOD_LEVELS.find(l => l.id === draft.automod)
    const owner = (draft.ranks === "basic" || draft.ranks === "own") && draft.owner ? ", and you get Owner" : ""
    const lines = [`§fRanks:§7 ${ranks.label}${owner}.`]
    if (draft.ranks === "own") lines.push("§7  Your rank list becomes Owner and Member, then New rank opens.")
    if (replacesRanks) lines.push("§c  This replaces your rank list. §7You can undo it from the rank list.")
    lines.push(`§fAutomod:§7 ${level ? `${level.label}: ${level.says}.` : `kept as it is (${automodNow(read)}).`}`)
    lines.push(`§fEveryday commands:§7 ${switches(ESSENTIALS, draft.essentials)}.`)
    lines.push(`§fChat and world:§7 ${switches(WORLD_SWITCHES, draft.world)}.`)
    return lines
}

function switches(list, answers) {
    const yes = list.filter(s => answers?.[s.key]).map(s => s.label)
    const no = list.filter(s => answers && s.key in answers && !answers[s.key]).map(s => s.label)
    return `${yes.length ? `on: ${yes.join(", ")}` : "nothing on"}${no.length ? `; off: ${no.join(", ")}` : ""}`
}
