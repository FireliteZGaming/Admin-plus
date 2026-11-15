import { world, system } from "@minecraft/server"
import { menu, modal, confirm, subtitle } from "../core/ui.js"
import { canUseCode, hasOperator, DEV_TAG } from "../core/devgate.js"
import { hubTitle, hubEntry, multilineTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { refreshNameTag } from "../core/ranks.js"
import { DEFAULTS, setting, overrides, replaceOverrides, settingProblem, render, renderTag } from "../core/settings.js"
import { typedText } from "../core/settingFields.js"
import { readScript, writeScript } from "../core/jsconfig.js"
import { allPresets, getPreset, detectPreset, applyPreset, savePresetFromCurrent } from "../core/configPresets.js"
import { record } from "../core/logs.js"
import { factoryReset } from "./reset.js"

// /admin ▸ < Code >
//
// The config as a text file you edit. Not a menu that leads to a text file —
// the file itself, opened the moment you press the button.
//
// It was always supposed to be this. It became a hub of four buttons only
// because a form text field was believed to be single-line, so the block was
// unrolled into one control per key to stay usable. That belief was wrong: the
// resource pack draws a real multi-line box (see `MULTILINE` in core/theme.js),
// so the section can finally be the thing it was named after.
//
// The other three buttons moved rather than died — the field editor, the config
// presets and Factory reset all live under /admin ▸ Settings now, which is where
// somebody looking for a setting would have looked first anyway.
//
// Gated by BOTH a "Dev" tag and operator status, deliberately: the tag alone is
// something any staff member with /tag could give themselves, and op alone is
// often handed out loosely on a realm. Requiring both means someone has to mean
// it. This section never appears otherwise — not greyed out, not present.


export async function codeScreen(player, back) {
    if (!canUseCode(player)) { err(player, "That section needs the Dev tag and operator status."); return back() }
    // Beta writes the settings as JavaScript (2.12.7); Default keeps key = value.
    return scriptScreen(player, back)
}

/** Custom is worth noticing, so it is the only one that is not grey. */
function presetColour() {
    return detectPreset().id === "custom" ? "§e" : "§f"
}

// ------------------------------------------------------------ the whole config
//
// /admin ▸ Settings ▸ All values. The same config as < Code >, one typed control
// per key: grouped, labelled, already filled in, toggles for the booleans.
//
// This screen was BUILT as a workaround. The belief was that a form text field
// could only ever be one line, which made the config block a letterbox you
// scrolled sideways through, so it was unrolled into ~39 separate controls to
// stay usable. The belief was wrong — the resource pack draws a real multi-line
// box — and < Code > is now the text file it was always meant to be.
//
// It is kept anyway, because it turns out not to have been only a workaround:
// typed controls validate, group and explain in a way raw text cannot, and not
// everybody wants to edit a config by typing into it. Two doors, one store —
// so the two screens had better agree about everything, and they do.

/** Pretty names for the key prefixes. Anything unlisted is capitalised. */
export const GROUPS = {
    bracket: "Brackets",
    format: "Formatting",
    presence: "Join and leave",
    vanish: "Vanish",
    invsee: "Inventory viewing",
    logs: "Logs",
    audit: "Staff action announcements",
    cleanup: "Lag clear",
    automod: "Automod",
    filter: "Chat screening",
    ban: "Bans",
    troll: "Pranks",
    warnings: "Warnings",
    items: "Admin items",
    creator: "Creator",
    feature: "Features on and off",
    spawn: "Spawn protection",
    teleport: "Teleporting",
    tpa: "TPA",
    rtp: "Random teleport",
    namecolour: "Name colour effects",
    omni: "Omnitool",
    automation: "Automation",
    badge: "Badges",
    ranks: "Ranks",
    staff: "Staff"
}

export function groupOf(key) {
    const prefix = String(key).split(".")[0]
    return GROUPS[prefix] ?? (prefix ? prefix[0].toUpperCase() + prefix.slice(1) : "Other")
}

/**
 * Config keys in group order — every format.* together, and so on.
 *
 * DEFAULTS is written in the order the values were added, which interleaves a
 * couple of groups; on a 39-field screen that reads as the same heading turning
 * up twice. Groups appear in the order their first key does, so the shape of
 * the screen still follows the file.
 */
export function groupedKeys() {
    const groups = new Map()
    for (const key of Object.keys(DEFAULTS)) {
        const group = groupOf(key)
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group).push(key)
    }
    return [...groups.entries()]
}

/**
 * What kind of value a key holds, inferred from its SHIPPED default.
 *
 * Inferred rather than declared: the default never changes at runtime, so this
 * is stable, and it means the 39 entries in DEFAULTS did not all have to grow a
 * field to teach this screen something their default already says. A blank
 * default is text — "" is a legitimate empty list, not the number zero. So is
 * one made of spaces (2.12.7): Number(" ") is 0 too, so the gap between two
 * rank tags read as a number, and every save of it said "Not a number".
 */
export function kindOf(key) {
    const value = DEFAULTS[key]?.value
    if (value === "true" || value === "false") return "bool"
    if (value !== undefined && value.trim() !== "" && Number.isFinite(Number(value))) return "number"
    return "text"
}

function isNumeric(text) {
    return text !== "" && Number.isFinite(Number(text))
}

/**
 * What a key should become, given whatever the form said about it.
 *
 * A MISSING ANSWER IS NOT AN ANSWER. The All values form is sixty fields long
 * and `modal()` pairs answers to fields by index, so a response that ever comes
 * back short leaves every key past the cut undefined. Coercing that was
 * silently destructive both ways: a toggle became "false", turning off settings
 * nobody touched, and a text field became "", which DIFFERS from its default
 * and so got STORED — blanking a chat format would wipe that chat line.
 *
 * The answer has to be the key's CURRENT value rather than a skip, because the
 * caller replaces the whole override table: a key left out of it reverts to the
 * shipped default, which is the same bug wearing a different hat.
 */
export function submittedValue(key, raw) {
    const kind = kindOf(key)
    if (raw === undefined) return { text: setting(key), rejected: false, shown: "" }

    const text = kind === "bool"
        ? (raw ? "true" : "false")
        : kind === "number" ? String(raw).trim() : typedText(key, raw)

    // A number that will not parse costs you that one number and nothing else.
    if (kind === "number" && !isNumeric(text)) {
        return { text: setting(key), rejected: true, shown: text }
    }
    return { text, rejected: false, shown: text }
}

export async function allValuesScreen(player, back) {
    const again = () => allValuesScreen(player, back)
    const groups = groupedKeys()
    const differs = key => setting(key) !== DEFAULTS[key].value
    const total = groups.reduce((n, [, keys]) => n + keys.filter(differs).length, 0)

    return menu(player, {
        title: hubTitle("settings", "Every setting"),
        body: [
            subtitle("Every setting the other screens change, as one plain list."),
            "",
            total
                ? `§f${total}§7 ${total === 1 ? "setting differs" : "settings differ"} from the default.`
                : "§8Every setting is at its default."
        ].join("\n"),
        buttons: groups.map(([group, keys]) => {
            const diff = keys.filter(differs).length
            return {
                text: hubEntry("settings", group,
                    diff ? `${diff} of ${keys.length} changed` : `${keys.length} setting${keys.length === 1 ? "" : "s"}`),
                run: () => groupScreen(player, group, keys, again)
            }
        }),
        back
    })
}

/**
 * One group at a time, and never the whole config at once.
 *
 * This screen used to be a single SIXTY-FIELD form, which is how a toggle could
 * be switched on, submitted, and come back off: answers pair to fields by index,
 * so a response arriving short leaves the whole tail reading as nothing. The
 * largest group here is fourteen.
 *
 * It reads better too. Finding a setting among twenty group names beats
 * scrolling sixty fields looking for a label you half remember.
 */
async function groupScreen(player, group, keys, back) {
    const fields = keys.map(key => {
        const spec = DEFAULTS[key]
        const label = `§f${spec.label}\n§8${key} · ${spec.help}`
        return kindOf(key) === "bool"
            ? { id: key, type: "toggle", label, default: setting(key) === "true" }
            : { id: key, type: "text", label, default: setting(key), placeholder: spec.value }
    })

    const values = await modal(player, hubTitle("settings", group), fields)
    if (!values) return back()

    // Start from what is already stored and touch only this group's keys.
    // Submitting replaces the whole override table, so building `store` from
    // scratch here would reset every OTHER group to its default.
    const previous = { ...overrides() }
    const store = { ...previous }
    const rejected = []
    let changed = 0

    for (const key of keys) {
        const answer = submittedValue(key, values[key])
        if (answer.rejected) rejected.push(`${key} = ${answer.shown || "(blank)"}`)
        if (answer.text !== setting(key)) changed++
        if (answer.text === DEFAULTS[key].value) delete store[key]
        else store[key] = answer.text
    }

    const dropped = replaceOverrides(store)
    restyleEveryone()
    if (dropped.length) info(player, keptDefaultNote(dropped))

    if (rejected.length) {
        err(player, `Not a number, left as it was:\n§7${rejected.join("\n")}`)
    }
    if (!changed) { info(player, "§7Nothing changed."); return back() }

    record(player, "config.edit", undefined, `${group}: ${changed} value(s) changed`,
        { kind: "config", overrides: previous })
    ok(player, `Saved §f${changed}§a change${changed === 1 ? "" : "s"} in §f${group}§a.`)
    return back()
}

// ------------------------------------------------------------------ presets

/**
 * How a setup is named on screen. Beta shows Vanilla as "Back to defaults"
 * (2.12.7): with Realm, Strict and Quiet gone it is no longer one ready-made
 * setup among others, only the way back to how Admin+ ships.
 */
export function shownSetup(id, preset) {
    if (id === "vanilla") return { ...preset, label: "Back to defaults", description: "Every setting as Admin+ ships it" }
    return preset
}

/** The setup in force, in words: "Defaults" in Beta, else its own name. */
export function currentSetupName(current = detectPreset()) {
    return current.id === "vanilla" ? "Defaults" : current.label
}

export async function configPresetsScreen(player, back) {
    const presets = allPresets()
    const current = detectPreset()
    const again = () => configPresetsScreen(player, back)

    return menu(player, {
        title: hubTitle("presets", "Saved setups"),
        body: [
            `§fCurrently: §r${presetColour()}${currentSetupName(current)}`,
            current.id === "custom"
                ? "§8Custom means the settings match no saved setup."
                : "§8Changing any setting makes this Custom.",
            "",
            "§8A setup only changes the settings it lists. The rest stay as they are."
        ].join("\n"),
        buttons: [
            ...Object.entries(presets).map(([id, raw]) => {
                const preset = shownSetup(id, raw)
                return {
                    text: `${id === current.id ? "§a" : "§f"}${preset.label}${preset.custom ? " §8(saved here)" : ""}§r\n§8${preset.description}`,
                    run: () => applyScreen(player, id, again)
                }
            }),
            { text: "§b+ Save the current settings as a setup", run: () => saveScreen(player, again) }
        ],
        back
    })
}

async function applyScreen(player, id, back) {
    const preset = getPreset(id)
    if (!preset) { err(player, "That setup no longer exists."); return back() }
    if (id === "vanilla") return defaultsScreen(player, back)

    const keys = Object.keys(preset.values ?? {})
    const summary = keys.length
        ? keys.slice(0, 8).map(k => `§8· ${k} = ${preset.values[k]}`).join("\n")
        : "§8· puts every setting back to its default"

    const yes = await confirm(player, hubTitle("presets", preset.label),
        `${preset.description}\n\n${summary}${keys.length > 8 ? `\n§8· …and ${keys.length - 8} more` : ""}`,
        "§eApply")
    if (!yes) return back()

    const touched = applyPreset(id)
    restyleEveryone()
    record(player, "config.preset", undefined, `${preset.label} · ${touched} values`)
    ok(player, `Loaded §f${preset.label}§a. ${touched} setting${touched === 1 ? "" : "s"} changed.`)
    return back()
}

/**
 * Beta's Back to defaults. It says how many settings it will change, counted
 * first: Vanilla's own line always said all 108 had changed.
 */
async function defaultsScreen(player, back) {
    const differ = Object.keys(DEFAULTS).filter(key => setting(key) !== DEFAULTS[key].value)
    if (!differ.length) { info(player, "Every setting is already at its default."); return back() }

    const yes = await confirm(player, hubTitle("presets", "Back to defaults"), [
        `Put ${differ.length === 1 ? "the 1 changed setting" : `all ${differ.length} changed settings`} back to how Admin+ ships them?`,
        "",
        "§8Your saved setups stay. Ranks, warps and everything else stay too."
    ].join("\n"), "§ePut them back")
    if (!yes) return back()

    const previous = overrides()
    applyPreset("vanilla")
    restyleEveryone()
    record(player, "config.preset", undefined, `Back to defaults · ${differ.length} values`, { kind: "config", overrides: previous })
    ok(player, `Every setting is back to its default. §f${differ.length}§a had been changed.`)
    return back()
}

async function saveScreen(player, back) {
    const values = await modal(player, hubTitle("presets", "Save setup"), [
        { id: "id", type: "text", label: "ID §8· lowercase, no spaces", placeholder: "myrealm" },
        { id: "label", type: "text", label: "Name §8· how it shows in the list", placeholder: "My Realm" },
        { id: "description", type: "text", label: "Description §8· optional", placeholder: "" }
    ])
    if (!values) return back()

    const preset = savePresetFromCurrent(values.id, values.label, values.description)
    if (!preset) {
        err(player, "Use lowercase letters or numbers for the ID, and not the ID of a built-in setup.")
        return back()
    }
    record(player, "config.presetSave", undefined, preset.label)
    ok(player, `Saved §f${preset.label}§a with ${Object.keys(preset.values).length} settings.`)
    info(player, "§7It stores only the settings that differ from the defaults.")
    return back()
}

/**
 * What a rank tag and chat line look like with the current values.
 *
 * It sat on the old < Code > hub. That hub is gone, so it moved to the Settings
 * screen — which is the better home anyway: the formatting keys are the ones
 * you cannot picture from their value alone, and this is the only place that
 * shows you the answer before you commit to it.
 */
export function previewLine() {
    // Drawn the way chat draws it (2.12.7). The old copy replaced four tokens
    // by hand, so {BADGE} and {NICKNAME}, both in the shipped chat line, showed
    // as written.
    return render("format.chat", { TAG: renderTag({ display: "§cAdmin" }), RANK: "§cAdmin", NAME: "Steve", NICKNAME: "Steve", MSG: "hello" })
}

// ------------------------------------------------------------- the big block
//
// "key = value", one per line, with # comments — a config file, not JSON. On a
// controller or a phone keyboard, unbalanced braces and quotes are a trap, and
// this format has neither. It reads and writes like any .txt: scroll it, change
// the lines you came to change, paste a whole config in, or copy one out.

/**
 * The config as text.
 *
 * SHORTENED after the 2.0.0 playtest, which reported the box typing slowly —
 * noticeably laggy per keystroke. Every key used to carry its own two-line
 * comment, and that was 72% of the document: 7467 characters to hold 2065
 * characters of actual config. The box is a JSON-UI control re-evaluating a
 * binding as you type, so the cheapest lever available is to give it less to
 * hold. One heading per GROUP keeps the document navigable; the per-key prose
 * is gone, because Settings ▸ All values already shows each key's label and
 * help beside the field, which is the better place to read it anyway.
 *
 * This cannot be verified from here — whether the lag was length or the control
 * itself is a question only the next playtest answers.
 */
export function toBlock() {
    const current = detectPreset()
    const lines = [
        "# Admin+ settings. One per line: key = value. Lines starting with # are ignored.",
        "# preset: type a saved setup's name to load it. Custom means the",
        "# settings match no saved setup.",
        `preset = ${current.id}`
    ]
    for (const [group, keys] of groupedKeys()) {
        lines.push("")
        lines.push(`# ${group}`)
        for (const key of keys) lines.push(`${key} = ${setting(key)}`)
    }
    return lines.join("\n")
}

/**
 * Parse the block. Returns { values, unknown }, or { error } — and nothing is
 * stored unless the whole document reads cleanly.
 */
export function fromBlock(text) {
    const values = {}
    const unknown = []
    const lines = String(text ?? "").split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || line.startsWith("#")) continue
        const at = line.indexOf("=")
        if (at < 0) return { error: `Line ${i + 1} has no "=" in it: ${line.slice(0, 30)}` }
        const key = line.slice(0, at).trim()
        if (!key) return { error: `Line ${i + 1} has nothing before the "="` }
        values[key] = line.slice(at + 1).trim()
        if (key === "preset") continue               // handled before the rest
        if (!(key in DEFAULTS)) unknown.push(key)
    }
    return { values, unknown }
}

/**
 * Does this document contain no config at all?
 *
 * Submitting the block REPLACES the override table with whatever came back, so
 * an empty field discards every changed value — a factory reset with no
 * confirmation, from a screen that is not Factory reset. Cheap to do by
 * accident now that the box is a real multi-line editor you can select-all and
 * type over, and not yet ruled out as something the new control might do on its
 * own, since nothing has run it in game.
 *
 * "No recognised keys at all" is the test, deliberately, rather than "fewer keys
 * than before": deleting a line is how you say "put this one back to default",
 * and that has to keep working. Only a document with nothing left in it is
 * treated as the accident it almost certainly is.
 */
export function blockHasNoConfig(text) {
    const parsed = fromBlock(text)
    if (parsed.error) return false                    // a parse error is its own message
    return !Object.keys(parsed.values).some(key => key !== "preset" && key in DEFAULTS)
}

async function blockScreen(player, back) {
    const changed = Object.keys(overrides()).length
    const values = await modal(player, multilineTitle("code", "< Code >"), [
        {
            id: "block",
            type: "text",
            label: [
                `§8All ${Object.keys(DEFAULTS).length} settings. Setup: ${detectPreset().label}${changed ? `, ${changed} changed from default` : ""}.`,
                "§8Edit the lines you want. Submit to save, or close to change nothing.",
                "§8Server ▸ Advanced ▸ Every setting changes the same things one at a time."
            ].join("\n"),
            placeholder: "key = value",
            default: toBlock()
        }
    ])
    if (!values) return back()

    const parsed = fromBlock(values.block)
    if (parsed.error) {
        err(player, `${parsed.error}\n§8Nothing was saved.`)
        return back()
    }

    if (blockHasNoConfig(values.block)) {
        // **Say what probably happened, not just what did.** Reported from a
        // world: somebody changed one token, got "no config in it", and had no
        // way to know the box had not been a real editor. The commonest cause
        // is by far the likeliest thing to be wrong — this screen is only a
        // multi-line editor because the RESOURCE pack overrides the form, so
        // without it the document arrives as one line and comes back mangled.
        err(player, "The box came back empty, so nothing was saved.")
        info(player, [
            "§7Was the box one line instead of a tall editor? Then the Admin+",
            "§7§oresource§r§7 pack is not on in this world. It is what turns this",
            "§7screen into an editor. Turn it on, or use §fServer ▸ Advanced ▸ Every setting§7,",
            "§7which changes the same settings one at a time and needs no pack.",
            "§8To put every setting back on purpose: Server ▸ Advanced ▸ Saved setups ▸ Vanilla."
        ].join("\n"))
        return back()
    }

    // A changed preset line is applied FIRST, so explicit values typed below it
    // win over the preset they sit under — which is what someone editing a block
    // top to bottom would expect.
    const asked = String(parsed.values.preset ?? "").trim().toLowerCase()
    delete parsed.values.preset
    const loading = !!asked && asked !== "custom" && asked !== detectPreset().id
    if (loading && !getPreset(asked)) {
        err(player, `No saved setup called "§f${asked}§c". Saved: §f${Object.keys(allPresets()).join(", ")}`)
        return back()
    }

    if (parsed.unknown.length) {
        const yes = await confirm(player, hubTitle("code", "Unknown keys"),
            `Admin+ doesn't use these:\n§7${parsed.unknown.join(", ")}\n\nSave anyway? They won't do anything.`,
            "§eSave")
        if (!yes) return back()
    }

    // Read before a setup loads (2.12.7): the setup used to load before the
    // question above, so No still loaded it, and Logs' undo went back only to
    // the setup.
    const previous = overrides()
    const before = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, setting(key)]))
    if (loading) {
        applyPreset(asked)
        info(player, `Loaded the §f${getPreset(asked).label}§7 setup.`)
    }

    // Same rule as the field editor: a value the language cannot read keeps the
    // value it had. The two screens write the same store, so they had better
    // disagree about nothing.
    const rejected = []
    const store = {}
    for (const [key, value] of Object.entries(parsed.values)) {
        if (key === "preset") continue
        let text = value
        if (DEFAULTS[key] && kindOf(key) === "number" && !isNumeric(text)) {
            rejected.push(`${key} = ${text || "(blank)"}`)
            text = before[key]
        }
        // A line can't carry spaces at its ends, so a value that is the same
        // apart from them is unchanged: the gap between rank tags stays a space.
        if (DEFAULTS[key] && kindOf(key) === "text" && text === before[key].trim()) text = before[key]
        // Every line is written with the value it had, so with a setup just
        // loaded an unchanged line would undo it (it did, before 2.12.7): an
        // unchanged line takes the setup's value instead.
        if (loading && DEFAULTS[key] && text === before[key]) text = setting(key)
        if (DEFAULTS[key] && DEFAULTS[key].value === text) continue
        store[key] = text
    }
    if (rejected.length) {
        err(player, `Not a number, left as it was:\n§7${rejected.join("\n")}`)
    }
    const dropped = replaceOverrides(store)
    restyleEveryone()
    if (dropped.length) info(player, keptDefaultNote(dropped))
    record(player, "config.edit", undefined,
        `${Object.keys(store).length} value(s) differ from default`, { kind: "config", overrides: previous })

    const count = Object.keys(store).length
    ok(player, count
        ? `Saved. §f${count}§a ${count === 1 ? "setting differs" : "settings differ"} from the default.`
        : "Saved. Every setting is back to its default.")
    return back()
}

// --------------------------------------------------------- the JavaScript
//
// Beta's < Code > (2.12.7, the user: "we actually make that JavaScript too").
// core/jsconfig.js reads the document; it is never run, because code run here
// could do anything, past every rank rule. The rules are the block's:
//   1. Nothing is saved unless the whole document reads.
//   2. A deleted line puts its setting back to its default.
//   3. A value of the wrong kind, or a chat line missing who or what, keeps
//      the value it had, and the screen says which line.
//   4. A document with no settings in it saves nothing (the empty-box guard).
//   5. Names Admin+ doesn't use are saved only after a yes.

const SCRIPT_INTRO = [
    "Admin+ settings, written as JavaScript. Admin+ reads it and never runs it.",
    "Text goes in \"quotes\". Switches are true or false. Numbers are plain, like 16.",
    "Delete a line to put that setting back to its default."
]
const SETUP_NOTE = "A saved setup's name loads it first. \"defaults\" puts every setting back."

/** A setting's value as the document writes it: a switch, a number or text. */
function scriptValue(key) {
    const value = setting(key)
    const kind = kindOf(key)
    if (kind === "bool" && (value === "true" || value === "false")) return value === "true"
    if (kind === "number" && isNumeric(value.trim())) return Number(value)
    return value
}

/** Every setting as one JavaScript document. */
export function toScript() {
    const current = detectPreset()
    return writeScript({
        intro: SCRIPT_INTRO,
        setup: current.id === "vanilla" ? "defaults" : current.id,
        setupNote: SETUP_NOTE,
        groups: groupedKeys().map(([heading, keys]) => [heading, keys.map(key => [key, scriptValue(key)])])
    })
}

/** A name that can be stored: plain names joined by dots, none of them special to JavaScript. */
const SAFE_NAME = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/
const SPECIAL = new Set(["__proto__", "prototype", "constructor"])
const storable = key => SAFE_NAME.test(key) && !key.split(".").some(name => SPECIAL.has(name))

/** What one value becomes for a setting of this kind, or undefined when it can't be. */
function asSetting(kind, value) {
    if (kind === "bool") {
        if (typeof value === "boolean") return value ? "true" : "false"
        const word = typeof value === "string" ? value.trim().toLowerCase() : ""
        return word === "true" || word === "false" ? word : undefined
    }
    if (kind === "number") {
        if (typeof value === "number" && Number.isFinite(value)) return String(value)
        return typeof value === "string" && isNumeric(value.trim()) ? value.trim() : undefined
    }
    if (Array.isArray(value)) return value.map(String).join(", ")
    return typeof value === "string" ? value : String(value)
}

const KIND_WORDS = { bool: "a switch, so it takes true or false", number: "a number, like 16", text: "text in quotes" }

/**
 * Read the document. Returns { error } or { values, wrong, unknown, setup,
 * empty }: `values` maps each setting written to the text it would store,
 * `wrong` lists the lines whose value was the wrong kind (they keep what they
 * had), and `empty` means no setting Admin+ uses was written at all.
 */
export function fromScript(text) {
    const read = readScript(text)
    if (read.error) return { error: read.error }
    const values = new Map()
    const wrong = new Map()
    const unknown = []
    for (const { key, value, line } of read.entries) {
        if (!storable(key)) return { error: `Line ${line}: ${key} can't be the name of a setting.` }
        if (!(key in DEFAULTS)) {
            if (!unknown.includes(key)) unknown.push(key)
            values.set(key, asSetting("text", value))
            continue
        }
        const kind = kindOf(key)
        const stored = asSetting(kind, value)
        if (stored === undefined) { wrong.set(key, `Line ${line}: ${key} is ${KIND_WORDS[kind]}.`); values.delete(key); continue }
        wrong.delete(key)
        values.set(key, stored)
    }
    const empty = ![...values.keys(), ...wrong.keys()].some(key => key in DEFAULTS)
    return { values, wrong, unknown, setup: read.setup, empty }
}

/** "defaults" is Beta's name for Vanilla; anything else is a setup's own id. */
const setupId = name => {
    const id = String(name ?? "").trim().toLowerCase()
    return id === "defaults" ? "vanilla" : id
}

/**
 * What every setting becomes. A setup named in the document loads first, and
 * then only the lines that were changed apply on top of it: every line is
 * written with the value it had, so an unchanged line would undo the setup.
 * Without a new setup, a setting missing from the document goes back to its
 * default, which is how a deleted line says so.
 */
export function scriptResult(parsed, setup) {
    const before = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, setting(key)]))
    const loading = setup
        ? Object.fromEntries(Object.keys(DEFAULTS).map(key => [key,
            Object.keys(setup.values ?? {}).length ? (key in setup.values ? String(setup.values[key]) : before[key]) : DEFAULTS[key].value]))
        : undefined
    const store = {}
    const kept = []
    for (const key of Object.keys(DEFAULTS)) {
        let value
        if (parsed.wrong.has(key)) value = before[key]
        else if (parsed.values.has(key)) value = loading && parsed.values.get(key) === before[key] ? loading[key] : parsed.values.get(key)
        else value = loading ? loading[key] : DEFAULTS[key].value
        // A chat line that lost who is talking or what they said keeps its
        // old value, rather than the default the block falls back to.
        const problem = settingProblem(key, value)
        if (problem) { kept.push(`${key} ${problem}`); value = before[key] }
        if (value !== DEFAULTS[key].value) store[key] = value
    }
    for (const key of parsed.unknown) store[key] = parsed.values.get(key)
    return { store, kept }
}

async function scriptScreen(player, back) {
    const changed = Object.keys(overrides()).length
    const values = await modal(player, multilineTitle("code", "< Code >"), [
        {
            id: "script",
            type: "text",
            label: [
                `§8All ${Object.keys(DEFAULTS).length} settings, written as JavaScript. Setup: ${currentSetupName()}${changed ? `, ${changed} changed from default` : ""}.`,
                "§8Admin+ reads it and never runs it. Submit to save, or close to change nothing."
            ].join("\n"),
            placeholder: "const settings = { }",
            default: toScript()
        }
    ])
    if (!values) return back()

    const parsed = fromScript(values.script)
    if (parsed.error) {
        err(player, `${parsed.error}\n§8Nothing was saved.`)
        return back()
    }
    if (parsed.empty) {
        // The commonest cause: without the resource pack the box is one line,
        // and the document comes back as one long comment.
        err(player, "The box came back with no settings in it, so nothing was saved.")
        info(player, [
            "§7Was the box one line instead of a tall editor? Then the Admin+",
            "§7§oresource§r§7 pack is not on in this world. It is what turns this",
            "§7screen into an editor. Turn it on, or change settings on their pages in §fServer ▸ Settings§7.",
            "§8To put every setting back on purpose: Server ▸ Advanced ▸ Saved setups ▸ Back to defaults."
        ].join("\n"))
        return back()
    }

    const asked = parsed.setup ? setupId(parsed.setup.value) : ""
    let setup
    if (asked && asked !== "custom" && asked !== detectPreset().id) {
        setup = getPreset(asked)
        if (!setup) {
            const names = Object.keys(allPresets()).map(id => id === "vanilla" ? "defaults" : id)
            err(player, `Line ${parsed.setup.line}: no saved setup called "§f${parsed.setup.value}§c". Saved: §f${names.join(", ")}§c.\n§8Nothing was saved.`)
            return back()
        }
    }

    if (parsed.unknown.length) {
        const yes = await confirm(player, hubTitle("code", "Unknown settings"),
            `Admin+ doesn't use these:\n§7${parsed.unknown.join(", ")}\n\nSave anyway? They won't do anything.`,
            "§eSave")
        if (!yes) return back()
    }

    const { store, kept } = scriptResult(parsed, setup)
    if (parsed.wrong.size) err(player, `Kept as they were:\n§7${[...parsed.wrong.values()].join("\n")}`)
    if (kept.length) info(player, `§7Kept as they were, because a line must show who is talking and what they said:\n§8${kept.join("\n")}`)

    const previous = overrides()
    replaceOverrides(store)
    restyleEveryone()
    if (setup) info(player, asked === "vanilla" ? "Started from the defaults, then saved your changes." : `Loaded the §f${setup.label}§7 setup.`)
    const count = Object.keys(store).length
    record(player, "config.edit", undefined, `${count} value(s) differ from default`, { kind: "config", overrides: previous })
    ok(player, count
        ? `Saved. §f${count}§a ${count === 1 ? "setting differs" : "settings differ"} from the default.`
        : "Saved. Every setting is back to its default.")
    return back()
}

/**
 * Server ▸ Advanced ▸ Factory reset. OPERATOR ONLY, and asked twice.
 *
 * Since 2.9.3 it wipes Admin+ completely, as if the pack had just been added
 * (the user, 2026-11-12). The work is in features/reset.js. Putting only the
 * settings back is Saved setups ▸ Vanilla. The operator check is here rather
 * than only on the button, because a screen that trusts its caller is one
 * refactor away from trusting the wrong one.
 */
export async function factoryResetScreen(player, back) {
    if (!hasOperator(player)) { err(player, "Only an operator can use Factory reset."); return back() }

    const yes = await confirm(player, hubTitle("settings", "Factory reset"), [
        "Wipe Admin+ completely and start over, as if it was just added to this world?",
        "",
        "§cThis deletes§r ranks and who has them, bans, mutes, warnings, warps, spawn, homes, land claims, chat rooms, reports, logs, floating text, settings and Saved setups.",
        "",
        "§8Staff in staff mode get their things back first. Vanished and frozen players go back to normal. Admin items handed out before stop working, so get new ones from /items.",
        "",
        "§cThis can't be undone."
    ].join("\n"), "§cWipe everything")
    if (!yes) return back()

    const typed = await modal(player, hubTitle("settings", "Factory reset"), [
        { id: "word", type: "text", label: "Type RESET to wipe Admin+.\n§8Anything else cancels.", placeholder: "RESET" }
    ])
    if (!typed || String(typed.word ?? "").trim().toUpperCase() !== "RESET") {
        info(player, "Nothing was wiped.")
        return back()
    }

    const result = factoryReset(player)
    ok(player, `Admin+ was wiped and starts over like new.${result.returned ? ` ${result.returned} staff got their things back.` : ""}`)
    return back()
}

/** Said when a format lost who is talking or what they said, so it was not saved. */
function keptDefaultNote(keys) {
    return [
        "§7Kept the default for these, because a line must show who is talking and what they said:",
        ...keys.map(key => `§8· §f${key}§8 ${settingProblem(key, "")}`)
    ].join("\n")
}

/** Re-stamp nametags so a format change shows immediately. */
function restyleEveryone() {
    system.run(() => {
        for (const p of world.getAllPlayers()) refreshNameTag(p)
    })
}

export { DEV_TAG, canUseCode }
