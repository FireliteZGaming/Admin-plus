import { world, system } from "@minecraft/server"
import { menu, modal, confirm } from "../core/ui.js"
import { canUseCode, hasOperator, DEV_TAG } from "../core/devgate.js"
import { hubTitle, multilineTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { refreshNameTag } from "../core/ranks.js"
import { DEFAULTS, setting, overrides, replaceOverrides } from "../core/settings.js"
import { allPresets, getPreset, detectPreset, applyPreset, savePresetFromCurrent } from "../core/configPresets.js"
import { record } from "../core/logs.js"

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
// presets and Factory Reset all live under /admin ▸ Settings now, which is where
// somebody looking for a setting would have looked first anyway.
//
// Gated by BOTH a "Dev" tag and operator status, deliberately: the tag alone is
// something any staff member with /tag could give themselves, and op alone is
// often handed out loosely on a realm. Requiring both means someone has to mean
// it. This section never appears otherwise — not greyed out, not present.


export async function codeScreen(player, back) {
    if (!canUseCode(player)) { err(player, "That section needs the Dev tag and operator status."); return back() }
    return blockScreen(player, back)
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
    presence: "Join & leave",
    vanish: "Vanish",
    invsee: "Inventory viewing",
    audit: "Staff action announcements",
    cleanup: "Lag clear",
    automod: "Automod",
    ban: "Bans",
    troll: "Troll commands",
    feature: "Features on and off",
    spawn: "Spawn protection",
    teleport: "Teleporting",
    tpa: "TPA",
    commands: "Vanilla commands without op",
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
 * default is text — "" is a legitimate empty list, not the number zero.
 */
export function kindOf(key) {
    const value = DEFAULTS[key]?.value
    if (value === "true" || value === "false") return "bool"
    if (value !== "" && value !== undefined && Number.isFinite(Number(value))) return "number"
    return "text"
}

function isNumeric(text) {
    return text !== "" && Number.isFinite(Number(text))
}

export async function allValuesScreen(player, back) {
    const keys = []
    const fields = []

    // The group name rides on the first field of each group. Real header and
    // divider elements exist in newer server-ui, but they also shift what
    // formValues contains, and a mis-indexed config screen would write every
    // value into the wrong key. A coloured line on the label costs nothing and
    // cannot desynchronise.
    for (const [group, groupKeys] of groupedKeys()) {
        groupKeys.forEach((key, index) => {
            const spec = DEFAULTS[key]
            const heading = index === 0 ? `§6§l— ${group} —§r\n` : ""
            const label = `${heading}§f${spec.label}\n§8${key} · ${spec.help}`
            keys.push(key)
            fields.push(kindOf(key) === "bool"
                ? { id: key, type: "toggle", label, default: setting(key) === "true" }
                : { id: key, type: "text", label, default: setting(key), placeholder: spec.value })
        })
    }

    const values = await modal(player, hubTitle("settings", "All values"), fields)
    if (!values) return back()

    // Anything that will not parse keeps the value it had. The edit does not
    // half-apply and it does not throw the rest of your changes away either —
    // one bad number costs you that one number.
    const rejected = []
    const store = {}
    for (const key of keys) {
        const kind = kindOf(key)
        let text = kind === "bool"
            ? (values[key] ? "true" : "false")
            : String(values[key] ?? "").trim()

        if (kind === "number" && !isNumeric(text)) {
            rejected.push(`${key} = ${text || "(blank)"}`)
            text = setting(key)
        }
        // Store only what differs from the shipped default, so Factory Reset
        // stays meaningful and the stored table stays small.
        if (text === DEFAULTS[key].value) continue
        store[key] = text
    }

    const previous = overrides()
    replaceOverrides(store)
    restyleEveryone()

    const count = Object.keys(store).length
    if (rejected.length) {
        err(player, `Not a number, left as it was:\n§7${rejected.join("\n")}`)
    }
    record(player, "config.edit", undefined,
        `${count} value(s) differ from default${rejected.length ? ` · ${rejected.length} rejected` : ""}`,
        { kind: "config", overrides: previous })
    ok(player, count
        ? `Saved. §f${count}§a value${count === 1 ? "" : "s"} differ from default.`
        : "Saved — everything is back at its default.")
    return back()
}

// ------------------------------------------------------------------ presets

export async function configPresetsScreen(player, back) {
    const presets = allPresets()
    const current = detectPreset()
    const again = () => configPresetsScreen(player, back)

    return menu(player, {
        title: hubTitle("presets", "Config presets"),
        body: [
            `§fCurrently: §r${presetColour()}${current.label}`,
            current.id === "custom"
                ? "§8Custom means the values match no preset — somebody changed something."
                : "§8Change any value and this becomes Custom on its own.",
            "",
            "§8A preset only sets the keys it names; everything else is left alone."
        ].join("\n"),
        buttons: [
            ...Object.entries(presets).map(([id, preset]) => ({
                text: `${id === current.id ? "§a" : "§f"}${preset.label}${preset.custom ? " §8(saved here)" : ""}§r\n§8${preset.description}`,
                run: () => applyScreen(player, id, again)
            })),
            { text: "§b+ Save current values as a preset", run: () => saveScreen(player, again) }
        ],
        back
    })
}

async function applyScreen(player, id, back) {
    const preset = getPreset(id)
    if (!preset) { err(player, "That preset is gone."); return back() }

    const keys = Object.keys(preset.values ?? {})
    const summary = keys.length
        ? keys.slice(0, 8).map(k => `§8· ${k} = ${preset.values[k]}`).join("\n")
        : "§8· clears every override, back to shipped defaults"

    const yes = await confirm(player, hubTitle("presets", preset.label),
        `${preset.description}\n\n${summary}${keys.length > 8 ? `\n§8· …and ${keys.length - 8} more` : ""}`,
        "§eApply")
    if (!yes) return back()

    const touched = applyPreset(id)
    restyleEveryone()
    record(player, "config.preset", undefined, `${preset.label} · ${touched} values`)
    ok(player, `Applied §f${preset.label}§a — ${touched} value${touched === 1 ? "" : "s"} set.`)
    return back()
}

async function saveScreen(player, back) {
    const values = await modal(player, hubTitle("presets", "Save preset"), [
        { id: "id", type: "text", label: "Preset id §8· lowercase, no spaces", placeholder: "myrealm" },
        { id: "label", type: "text", label: "Name §8· how it shows in the list", placeholder: "My Realm" },
        { id: "description", type: "text", label: "One line about it §8· optional", placeholder: "" }
    ])
    if (!values) return back()

    const preset = savePresetFromCurrent(values.id, values.label, values.description)
    if (!preset) {
        err(player, "That id isn't usable, or it collides with a built-in preset.")
        return back()
    }
    record(player, "config.presetSave", undefined, preset.label)
    ok(player, `Saved §f${preset.label}§a — ${Object.keys(preset.values).length} values captured.`)
    info(player, "§7It only stores what differs from default, so it stays small.")
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
    const tag = setting("format.tag")
        .replaceAll("{OPEN}", setting("bracket.open"))
        .replaceAll("{CLOSE}", setting("bracket.close"))
        .replaceAll("{RANK}", "§cAdmin")
    return setting("format.chat")
        .replaceAll("{TAG}", tag)
        .replaceAll("{RANK}", "§cAdmin")
        .replaceAll("{NAME}", "Steve")
        .replaceAll("{MSG}", "hello")
}

// ------------------------------------------------------------- the big block
//
// "key = value", one per line, with # comments — a config file, not JSON. On a
// controller or a phone keyboard, unbalanced braces and quotes are a trap, and
// this format has neither. It reads and writes like any .txt: scroll it, change
// the lines you came to change, paste a whole config in, or copy one out.

export function toBlock() {
    const current = detectPreset()
    const lines = [
        "# Admin+ config — key = value, one per line. # lines are ignored.",
        "#",
        "# preset names the baseline this config matches. Type another preset's",
        "# name here and submit to apply it. It reads Custom whenever the values",
        "# differ from every preset, which is the honest answer.",
        `preset = ${current.id}`
    ]
    for (const [key, spec] of Object.entries(DEFAULTS)) {
        lines.push("")
        lines.push(`# ${spec.label} — ${spec.help}`)
        lines.push(`${key} = ${setting(key)}`)
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
 * confirmation, from a screen that is not Factory Reset. Cheap to do by
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
                `§8The live config — ${Object.keys(DEFAULTS).length} values, ${detectPreset().label}${changed ? `, ${changed} changed from default` : ""}.`,
                "§8Edit the lines you want. Submit saves; closing changes nothing.",
                "§8Settings ▸ All values does the same job one field at a time."
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
        err(player, "That came back with no config in it — nothing was saved.")
        info(player, "§7To clear every change on purpose: §fSettings ▸ Factory Reset§7.")
        return back()
    }

    // A changed preset line is applied FIRST, so explicit values typed below it
    // win over the preset they sit under — which is what someone editing a block
    // top to bottom would expect.
    const asked = String(parsed.values.preset ?? "").trim().toLowerCase()
    delete parsed.values.preset
    if (asked && asked !== "custom" && asked !== detectPreset().id) {
        if (!getPreset(asked)) {
            err(player, `No preset called "§f${asked}§c". Known: §f${Object.keys(allPresets()).join(", ")}`)
            return back()
        }
        applyPreset(asked)
        info(player, `Applied the §f${getPreset(asked).label}§7 preset.`)
    }

    if (parsed.unknown.length) {
        const yes = await confirm(player, hubTitle("code", "Unknown keys"),
            `Admin+ doesn't use:\n§7${parsed.unknown.join(", ")}\n\nSave anyway? They will sit there unused.`,
            "§eSave")
        if (!yes) return back()
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
            text = setting(key)
        }
        if (DEFAULTS[key] && DEFAULTS[key].value === text) continue
        store[key] = text
    }
    if (rejected.length) {
        err(player, `Not a number, left as it was:\n§7${rejected.join("\n")}`)
    }
    const previous = overrides()
    replaceOverrides(store)
    restyleEveryone()
    record(player, "config.edit", undefined,
        `${Object.keys(store).length} value(s) differ from default`, { kind: "config", overrides: previous })

    const count = Object.keys(store).length
    ok(player, count
        ? `Saved. §f${count}§a value${count === 1 ? "" : "s"} differ from default.`
        : "Saved — everything is back at its default.")
    return back()
}

/**
 * /admin ▸ Settings ▸ Factory Reset. OPERATOR ONLY.
 *
 * It moved here out of < Code > because it is a setting, and it kept a gate on
 * the way: `admin.settings` opens the Settings screen, but throwing away every
 * changed value in one press is not the same size of act as editing one of
 * them. The check is here rather than only on the button, because a screen that
 * trusts its caller is one refactor away from trusting the wrong one.
 */
export async function factoryResetScreen(player, back) {
    if (!hasOperator(player)) { err(player, "Factory Reset is operator-only."); return back() }

    const count = Object.keys(overrides()).length
    if (!count) { ok(player, "Already at factory defaults."); return back() }

    const yes = await confirm(player, hubTitle("settings", "Factory Reset"),
        `Throw away all §f${count}§r changed value${count === 1 ? "" : "s"} and restore the shipped config?\n\n§8Ranks, players and bans are untouched — this is only the config block.`,
        "§cFactory Reset")
    if (!yes) return back()

    const previous = overrides()
    replaceOverrides({})
    restyleEveryone()
    record(player, "config.reset", undefined, `${count} value(s) discarded`, { kind: "config", overrides: previous })
    ok(player, "Config restored to factory defaults.")
    return back()
}

/** Re-stamp nametags so a format change shows immediately. */
function restyleEveryone() {
    system.run(() => {
        for (const p of world.getAllPlayers()) refreshNameTag(p)
    })
}

export { DEV_TAG, canUseCode }
