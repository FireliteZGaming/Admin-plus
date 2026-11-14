import { setting, setSetting, resetSetting, flag, settingProblem, DEFAULTS } from "./settings.js"
import { COLOUR_CODE_TIP } from "./theme.js"

// One way to show a setting in a form and save the answer (2.12.7), shared by
// Server ▸ Settings and Automod so a switch, a slider or a text box behaves the
// same everywhere. Before, the text formats, word lists and fine-tuning numbers
// could only be changed through Server ▸ Advanced ▸ Every setting or < Code >;
// in Beta they now sit on the page they belong to.
//
// The rules every screen already followed, kept in one place:
//   1. An unanswered field keeps what it had (see submittedValue in code.js).
//   2. A slider that wasn't moved writes nothing, even if the stored value sat
//      outside its range and was shown clamped.
//   3. A value settingProblem refuses (a chat line with no {MSG}) is not saved,
//      and the screen says why.
//   4. A value equal to the default is stored as no value, as < Code > does.

/** A switch. */
export const sw = (key, label, detail) => ({ key, kind: "toggle", label, detail })
/** A number on a slider. The shipped default must sit inside min and max. */
export const num = (key, label, detail, min, max, step = 1) => ({ key, kind: "slider", label, detail, min, max, step })
/** Text, such as a chat line's format or a word list. `codes` adds the colour-code tip. */
export const txt = (key, label, detail, codes = false) => ({ key, kind: "text", label, detail, codes })
/** A whole number typed into a box, for the rare one with no sensible range. */
export const numBox = (key, label, detail) => ({ key, kind: "number", label, detail })

/** A number kept inside its slider's range, for showing on the slider. */
export function shownNumber(field) {
    const stored = Number(setting(field.key))
    const fallback = Number(DEFAULTS[field.key]?.value ?? field.min)
    const value = Number.isFinite(stored) ? stored : fallback
    return Math.min(field.max, Math.max(field.min, value))
}

/** What an empty box shows: what the setting starts as. */
function startsAs(key) {
    const value = String(DEFAULTS[key]?.value ?? "")
    if (!value) return "Empty"
    return value.trim() ? `Default: ${value}` : "Default: a space"
}

/** The form control for a field, with the label already written. */
export function fieldFor(field, label) {
    if (field.kind === "toggle") return { id: field.key, type: "toggle", label, default: flag(field.key) }
    if (field.kind === "slider") return { id: field.key, type: "slider", label, min: field.min, max: field.max, step: field.step, default: shownNumber(field) }
    return {
        id: field.key, type: "text", label, default: setting(field.key), placeholder: startsAs(field.key),
        tooltip: field.codes ? COLOUR_CODE_TIP : undefined
    }
}

/**
 * A typed answer as it should be stored. Spaces around it are trimmed, as
 * Every setting always did, except where spaces ARE the value: the gap
 * between two rank tags starts as one space (format.tagJoin).
 */
export function typedText(key, raw) {
    const text = String(raw ?? "")
    const shipped = String(DEFAULTS[key]?.value ?? "")
    return shipped !== shipped.trim() ? text : text.trim()
}

const isNumber = text => text !== "" && Number.isFinite(Number(text))

/**
 * Save one answer. `said` is how the field is named in the message; a switch
 * with no name says only on or off.
 * Returns { words } when it changed, { refused } when it couldn't be saved,
 * or {} when nothing moved.
 */
export function applyField(field, raw, said) {
    if (raw === undefined) return {}
    if (field.kind === "toggle") {
        if (!!raw === flag(field.key)) return {}
        setSetting(field.key, raw ? "true" : "false")
        return { words: `${said ? `${said} ` : ""}${raw ? "§aon" : "§8off"}` }
    }
    if (field.kind === "slider") {
        if (Number(raw) === shownNumber(field)) return {}
        setSetting(field.key, String(raw))
        return { words: `${said}: §f${raw}` }
    }
    const value = field.kind === "number" ? String(raw).trim() : typedText(field.key, raw)
    if (value === setting(field.key)) return {}
    if (field.kind === "number" && !isNumber(value)) return { refused: `${said}: "${value}" isn't a number, so it was left as it was.` }
    const problem = settingProblem(field.key, value)
    if (problem) return { refused: `${said}: kept as it was, because it ${problem}.` }
    if (value === DEFAULTS[field.key]?.value) resetSetting(field.key)
    else setSetting(field.key, value)
    return { words: field.kind === "number" ? `${said}: §f${value}` : `${said} changed` }
}
