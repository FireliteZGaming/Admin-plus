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
