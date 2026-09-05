// One colour per hub, so a screen's identity is readable at a glance and you
// always know which branch of the panel you are standing in.
//
// Shared colours are deliberate where the ROLE is shared: any "settings" screen
// is grey wherever it lives, because it means the same thing in every hub.

export const HUB = {
    actions:  "§c",   // red    — things you do TO a player
    ranks:    "§b",   // aqua   — the ladder and who holds what
    presets:  "§e",   // yellow — ready-made shapes, whole-server and ladder
    warps:    "§a",   // green  — going places
    settings: "§8",   // grey   — configuration, in any hub
    code:     "§5",   // purple — the dev escape hatch
    about:    "§7"    // silver — inert information
}

/** A hub-coloured screen title: "Admin+ | Ranks" with Ranks in the hub colour. */
export function hubTitle(hub, text) {
    return `§l§bAdmin§d+§r §8| ${HUB[hub] ?? "§r"}${text}`
}

/**
 * The sentinel that turns a form's text fields multi-line.
 *
 * There is no script API for this. `Admin+ RP/ui/server_form.json` watches every
 * form title, and when it contains this string it draws the form's inputs with
 * `npc_interact.multiline_text_edit_control` — the control vanilla already uses
 * for the NPC dialogue editor — instead of the one-line box. Same shape of trick
 * as the chest grid, and the same sentinel style as its `§m§c§e`: `§` before
 * each letter, so the renderer eats the lot and nothing prints.
 *
 * It goes at the END of a title. A prefix would restyle the words after it.
 *
 * WITHOUT THE RESOURCE PACK this is simply an invisible suffix and the field
 * renders one line, exactly as it did before. Every screen using it must still
 * be usable that way — degrade, never depend.
 */
export const MULTILINE = "§c§o§d§e"

/** A screen title that asks for multi-line text fields. See MULTILINE. */
export function multilineTitle(hub, text) {
    return hubTitle(hub, text) + MULTILINE
}

/** A hub-coloured root button: bold label over a grey one-line description. */
export function hubButton(hub, label, description) {
    const colour = HUB[hub] ?? "§r"
    return description ? `${colour}§l${label}§r\n§8${description}` : `${colour}§l${label}`
}

/** A hub-coloured entry inside a hub (sub-screens, list rows). */
export function hubEntry(hub, label, description) {
    const colour = HUB[hub] ?? "§r"
    return description ? `${colour}${label}§r\n§8${description}` : `${colour}${label}`
}
