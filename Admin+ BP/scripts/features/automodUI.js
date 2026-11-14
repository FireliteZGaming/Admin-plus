import { menu, modal, subtitle, INCOMPLETE } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, info, err } from "../core/util.js"
import { setting, setSetting, flag, overrides } from "../core/settings.js"
import { num, txt, fieldFor, applyField } from "../core/settingFields.js"
import { isBeta } from "../core/channel.js"
import { has } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { automodScreen } from "./automod.js"
import { CHAT_AUTOMOD_ON_HOLD } from "../core/hold.js"
import { heldScreen, heldWaiting } from "./heldUI.js"

// /admin ▸ Server ▸ Automod
//
// Its own door since 2.8.3, as the user laid Server out on 2026-11-12:
// Settings, Automod, Advanced. It gathers what was spread over Server ▸ Chat
// and Advanced: the three checks, chat screening, and held messages.

// Chat flooding is left out while chat automod is on hold (core/hold.js).
const CHECK_KEYS = CHAT_AUTOMOD_ON_HOLD
    ? ["automod.ores", "automod.breaks"]
    : ["automod.ores", "automod.breaks", "automod.spam"]
const CHECK_NAMES = CHAT_AUTOMOD_ON_HOLD ? "Ore alerts, fast breaking" : "Ore alerts, fast breaking, chat flooding"

export async function automodHubScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back() }
    const again = () => automodHubScreen(player, back)
    const waiting = heldWaiting()
    const checksOn = CHECK_KEYS.filter(key => flag(key)).length
    return menu(player, {
        title: hubTitle("settings", "Automod"),
        body: CHAT_AUTOMOD_ON_HOLD
            ? subtitle("Checks alert staff to ore veins and fast breaking.\nChat automod is on hold: chat isn't screened, and nobody\nis muted for spam.")
            : subtitle("Checks alert staff to what they find. Chat screening holds\nflagged messages until staff look at them."),
        buttons: [
            { text: hubEntry("settings", "Checks", `${CHECK_NAMES} · ${checksOn} of ${CHECK_KEYS.length} on`), run: () => automodScreen(player, again) },
            // Greyed out and inactive while on hold, as the user asked: pressing
            // it opens nothing and only says why.
            CHAT_AUTOMOD_ON_HOLD
                ? { text: "§7Chat screening\n§8On hold", run: () => { info(player, "Chat screening is on hold for now."); return again() } }
                : { text: hubEntry("settings", "Chat screening", flag("filter.enabled") ? "§aon§8 · what to hold, and what it costs the sender" : "§coff§8 · holds flagged messages for staff"), run: () => screeningScreen(player, again) },
            waiting
                ? { text: hubEntry("settings", `Held messages (${waiting})`, "Messages the screen stopped: allow or delete them"), run: () => heldScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

/** The four kinds of message the screen looks for, and how hard it looks. */
const KINDS = [
    { key: "filter.discrimination", label: "Discrimination", note: "Starts with no words. Add your own in Server ▸ Advanced ▸ Every setting", betaNote: "Starts with no words. Add your own below" },
    { key: "filter.sexual", label: "Sexual content" },
    { key: "filter.aggression", label: "Hostility and threats" },
    { key: "filter.profanity", label: "Ordinary swearing" }
]

/**
 * Beta (2.12.7): the word lists and how many held messages are kept, on this
 * page. They were in Server ▸ Advanced ▸ Every setting alone. `said` names
 * each in the line that says what changed.
 */
export const WORD_FIELDS = [
    { ...txt("filter.terms.discrimination", "Discrimination words", "Starts empty on purpose: which slurs to block depends on your community and language. Nothing is caught until you add words."), said: "discrimination words" },
    { ...txt("filter.terms.sexual", "Sexual content words", "Added to the built-in list"), said: "sexual content words" },
    { ...txt("filter.terms.aggression", "Hostility words", "Added to the built-in list"), said: "hostility words" },
    { ...txt("filter.terms.profanity", "Swearing words", "Added to the built-in list"), said: "swearing words" },
    { ...txt("filter.allow", "Never flag these words", "Harmless words that hold a flagged one, like class or grass. Only used by \"Anywhere\", which looks inside words."), said: "words never flagged" }
]
export const HOLD_FIELD = { ...num("filter.holdCap", "Held messages kept", "The oldest go first", 10, 200, 10), said: "held messages kept" }

const labelOf = field => [field.label, field.detail ? `§8${field.detail}` : ""].filter(Boolean).join("\n")
const LEVELS = ["Off", "Whole words only", "Also catches tricks like sh1t", "Anywhere, even inside words (more mistakes)"]
const ACTIONS = [["hold", "Hold it for staff"], ["warn", "Hold it and warn them"], ["mute", "Hold it and mute them"]]

const levelOf = key => Math.min(3, Math.max(0, Math.floor(Number(setting(key))) || 0))
const muteMinutes = () => Math.min(60, Math.max(1, Math.round(Number(setting("filter.muteSeconds")) / 60) || 5))

// The hub can't open this while chat automod is on hold (core/hold.js). It is
// exported so it stays tested and works the day the hold lifts.
export async function screeningScreen(player, back) {
    const beta = isBeta()
    const actionAt = Math.max(0, ACTIONS.findIndex(([id]) => id === String(setting("filter.action")).trim().toLowerCase()))
    const enabled = {
        id: "enabled", type: "toggle",
        label: "Screen chat before it posts\n§8A held message reaches nobody until staff allow it. The sender sees it as sent.",
        default: flag("filter.enabled")
    }
    const kinds = KINDS.map(kind => {
        const note = beta && kind.betaNote ? kind.betaNote : kind.note
        return { id: kind.key, type: "dropdown", label: note ? `${kind.label}\n§8${note}` : kind.label, options: LEVELS, default: levelOf(kind.key) }
    })
    const costs = [
        { id: "action", type: "dropdown", label: "What a held message costs the sender", options: ACTIONS.map(([, label]) => label), default: actionAt },
        { id: "mute", type: "slider", label: "Mute length in minutes\n§8Only for \"Hold it and mute them\"", min: 1, max: 60, step: 1, default: muteMinutes() },
        { id: "bypass", type: "toggle", label: "Staff skip the screen", default: flag("filter.staffBypass") }
    ]
    // Beta is one page in sections, with the word lists in it (2.12.7).
    const fields = beta
        ? [
            { type: "label", label: "§lWhat it looks for§r" }, enabled, ...kinds,
            { type: "divider" }, { type: "label", label: "§lWords§r\n§8Separated by commas." }, ...WORD_FIELDS.map(field => fieldFor(field, labelOf(field))),
            { type: "divider" }, { type: "label", label: "§lWhat it costs§r" }, ...costs,
            { type: "divider" }, { type: "label", label: "§lHeld messages§r" }, fieldFor(HOLD_FIELD, labelOf(HOLD_FIELD))
        ]
        : [enabled, ...kinds, ...costs]
    const values = await modal(player, hubTitle("settings", "Chat screening"), fields, beta ? { strict: true, submit: "Save" } : {})
    if (!values) return back()
    if (values === INCOMPLETE) {
        err(player, "Not every setting came back from the game, so nothing was saved. Try again.")
        return back()
    }

    const previous = overrides()
    const changed = []
    const set = (key, next, words) => {
        if (String(setting(key)) === next) return
        setSetting(key, next)
        changed.push(words)
    }
    if (values.enabled !== undefined) set("filter.enabled", values.enabled ? "true" : "false", `screening ${values.enabled ? "on" : "off"}`)
    for (const kind of KINDS) {
        if (values[kind.key] === undefined || values[kind.key] === levelOf(kind.key)) continue
        set(kind.key, String(values[kind.key]), `${kind.label.toLowerCase()}: ${LEVELS[values[kind.key]].toLowerCase()}`)
    }
    if (values.action !== undefined && values.action !== actionAt) set("filter.action", ACTIONS[values.action][0], ACTIONS[values.action][1].toLowerCase())
    if (values.mute !== undefined && values.mute !== muteMinutes()) set("filter.muteSeconds", String(values.mute * 60), `mute ${values.mute} min`)
    if (values.bypass !== undefined) set("filter.staffBypass", values.bypass ? "true" : "false", `staff ${values.bypass ? "skip" : "go through"} the screen`)
    const refused = []
    if (beta) {
        for (const field of [...WORD_FIELDS, HOLD_FIELD]) {
            const answer = applyField(field, values[field.key], field.said)
            if (answer.words) changed.push(answer.words)
            if (answer.refused) refused.push(answer.refused)
        }
    }
    if (refused.length) err(player, refused.join("\n"))

    if (!changed.length) { if (!refused.length) info(player, "Nothing changed."); return back() }
    record(player, "config.edit", undefined, `Chat screening: ${changed.join(", ").replace(/§./g, "")}`, { kind: "config", overrides: previous })
    ok(player, `Chat screening: §f${changed.join("§a, §f")}§a.`)
    return back()
}
