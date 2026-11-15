import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry, COLOUR_CODE_TIP } from "../core/theme.js"
import { LOOKS, look, setLook } from "../core/prefs.js"
import { ok, err, info } from "../core/util.js"
import { displayName, stripCodes, getNameColours, setNameColours } from "../core/identity.js"
import { has, refreshNameTag } from "../core/ranks.js"
import { paint, rampFrom, NAME_COLOUR_CODE, NAME_COLOURS_MAX } from "../core/nametag.js"

// /menu ▸ Personalization (2.12.0, the user's idea, 2026-11-13: "a
// personalization area, sort of how discord does it"). For now it holds the
// name colours: up to four colours typed into boxes, which the name shifts
// through above the head and in chat, or one for a still colour.
//
// Who: Personalization is open to everyone ("everyone by default"), but the
// colour shift is "rank specific, so it would have to be turned on for the
// rank, it is tagged under personalization and 'Name Color'" (the user,
// 2026-11-13): the Name effect switch, personalize.nameeffect, in a rank's
// Permissions ▸ Member ▸ Personalization, off until it's switched on. It was
// called Name colour until 2.12.3 ("let's change it to 'Name Effect'"), when
// a rank's own Name colour left Basics in Beta: a rank only switches this on,
// and each player picks their own effect here. Display
// names stay with staff for now, and protection beyond the exact-copy rule is
// left to automod in 4.0.0.
//
// 2.12.4: the screen opens on Settings, the player's own switches, starting
// with Name effects. It starts off and the editor stays hidden until they turn
// it on: "If it's off you won't be able to see a way to change it until you
// turn it on ... the rank settings give you the permission to do so." The
// switch lives in core/prefs.js LOOKS, apart from My settings.
//
// A Beta feature (core/channel.js): on Default the button isn't there and
// nobody's own colours show.

/** May this player open Personalization? Anyone, in the Beta look. */
export function canPersonalize(player) {
    return !!player
}

/** May they use name effects at all? Only with their rank's Name effect switch. */
export function canChooseColours(player) {
    return has(player, "personalize.nameeffect")
}

/**
 * Are their name effects on? Their rank allows it AND they turned it on
 * themselves in Personalization ▸ Settings (2.12.4). The rank gives
 * permission; the player decides.
 */
export function nameEffectsOn(player) {
    return canChooseColours(player) && look(player, "name.effects")
}

const NOT_ON_RANK = "Name effects aren't switched on for your rank. Staff can switch them on in Ranks ▸ your rank ▸ Permissions ▸ Member ▸ Personalization."
const TURN_ON_FIRST = "Your name effects are off. Turn them on in Personalization ▸ Settings first."

/** The colour codes, each shown in its own colour, the way the rank editor shows them. */
const COLOUR_ROW = "§0§§0 §1§§1 §2§§2 §3§§3 §4§§4 §5§§5 §6§§6 §7§§7 §8§§8 §9§§9 §a§§a §b§§b §c§§c §d§§d §e§§e §f§§f"
/** Bedrock's extra colours: gold coin, quartz, iron, netherite, redstone, copper and the rest. */
const EXTRA_ROW = "§g§§g §h§§h §i§§i §j§§j §m§§m §n§§n §p§§p §q§§q §s§§s §t§§t §u§§u §v§§v"

/** A typed colour: the letter on its own, or with the sign in front. "" when it isn't one. */
export function colourCodeFrom(text) {
    const value = String(text ?? "").trim().replace(/^§/, "")
    return NAME_COLOUR_CODE.test(value) ? value.toLowerCase() : ""
}

/** Their own name in these colours, standing still, for a screen or a message. */
function preview(player, codes) {
    const name = stripCodes(displayName(player))
    const ramp = rampFrom(codes)
    return ramp ? `${paint(name, ramp, 0)}§r` : `§f${name}§r`
}

function describe(codes) {
    // "off" belongs to the Settings switch; here it means none picked yet.
    if (!codes.length) return "no colours yet"
    if (codes.length === 1) return "one still colour"
    return `shifting through ${codes.length} colours`
}

/** What Settings holds, on its row: their switch, or why they have none. */
function settingsLine(player) {
    if (!canChooseColours(player)) return "Name effects · not switched on for your rank"
    return `Name effects · ${look(player, "name.effects") ? "on" : "off"}`
}

/**
 * Personalization: Settings first, then a way to change each thing that is
 * switched on. 2.12.4, the user: "If it's off you won't be able to see a way
 * to change it until you turn it on."
 */
export async function personalizeScreen(player, back) {
    if (!canPersonalize(player)) { err(player, "Personalization isn't open on this server yet."); return back?.() }
    const again = () => personalizeScreen(player, back)
    const codes = getNameColours(player)
    return menu(player, {
        title: hubTitle("chat", "Personalization"),
        body: subtitle("How you look to everyone else. Only you can change these."),
        buttons: [
            { text: hubEntry("chat", "Settings", settingsLine(player)), run: () => personalizeSettingsScreen(player, again) },
            // Two lines, as every row has: the name, then their name in their colours.
            nameEffectsOn(player)
                ? { text: `§dName effect§r\n${preview(player, codes)} §8· ${describe(codes)}`, run: () => nameColoursScreen(player, again) }
                : null
        ],
        back
    })
}

/**
 * Personalization ▸ Settings: the player's own switches. Name effects is one
 * they may turn on only when their rank allows it; without that, the form
 * says why instead of offering a switch that can't work.
 */
export async function personalizeSettingsScreen(player, back) {
    if (!canPersonalize(player)) { err(player, "Personalization isn't open on this server yet."); return back?.() }
    const allowed = canChooseColours(player)
    const spec = LOOKS["name.effects"]
    const values = await modal(player, hubTitle("chat", "Personalization settings"), [
        allowed
            ? { id: "nameEffects", type: "toggle", label: `${spec.label}\n§8${spec.help} Off hides them, and the way to change them.`, default: look(player, "name.effects") }
            : { type: "label", label: `${spec.label}\n§8${NOT_ON_RANK}` }
    ], { submit: "Save" })
    if (!values) return back?.()
    if (allowed && "nameEffects" in values) {
        const now = !!values.nameEffects
        if (now !== look(player, "name.effects")) {
            setLook(player, "name.effects", now)
            refreshNameTag(player)
            ok(player, now ? "Name effects are on. Pick yours under Name effect." : "Name effects are off. Your name is plain again.")
            return back?.()
        }
    }
    info(player, "§7Nothing changed.")
    return back?.()
}

/**
 * Up to four boxes. Empty boxes are skipped, so two filled boxes make a
 * two-colour name, one makes a still colour, and none turns it off. A box
 * that isn't a colour asks again with everything kept.
 */
export async function nameColoursScreen(player, back, typed) {
    if (!canChooseColours(player)) { err(player, NOT_ON_RANK); return back?.() }
    if (!look(player, "name.effects")) { err(player, TURN_ON_FIRST); return back?.() }
    const shown = typed ?? getNameColours(player)
    const boxes = Array.from({ length: NAME_COLOURS_MAX }, (_, i) => i)
    const values = await modal(player, hubTitle("chat", "Name effect"), [
        {
            type: "label",
            label: [
                `Up to ${NAME_COLOURS_MAX} colours. Your name shifts through them, above your head and in chat.`,
                "§8One colour keeps it still. Leave a box empty to use fewer, or all of them to turn it off.",
                "§8Type a code from these, each shown in its colour:",
                COLOUR_ROW,
                EXTRA_ROW
            ].join("\n")
        },
        ...boxes.map(i => ({
            id: `c${i}`, type: "text", label: `Colour ${i + 1}`,
            placeholder: i === 0 ? "Example: c" : "Leave empty to skip",
            tooltip: COLOUR_CODE_TIP, default: shown[i] ?? ""
        }))
    ], { submit: "Save" })
    if (!values) return back?.()

    const raw = boxes.map(i => String(values[`c${i}`] ?? "").trim())
    const codes = []
    for (const [i, text] of raw.entries()) {
        if (!text) continue
        const code = colourCodeFrom(text)
        if (!code) {
            err(player, `Colour ${i + 1} isn't a colour code. Type one of the codes shown, like c.`)
            return nameColoursScreen(player, back, raw)
        }
        codes.push(code)
    }
    const kept = setNameColours(player, codes)
    refreshNameTag(player)
    if (!kept.length) ok(player, "Your name effect is off.")
    else if (kept.length === 1) ok(player, `Your name is now ${preview(player, kept)}§a.`)
    else ok(player, `Your name now shifts through ${kept.length} colours: ${preview(player, kept)}§a.`)
    return back?.()
}
