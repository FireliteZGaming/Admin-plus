import { ItemTypes } from "@minecraft/server"

// The Default ↔ Beta slider (2.10.1). The user, 2026-11-12: like the RTX packs,
// "a little slider ... where it says (Default ——— Beta) so Beta type stuff is
// in Beta, such as the UI".
//
// The slider is the behavior pack's SUBPACKS, which the game shows as a slider
// in the pack's settings (the gear beside Admin+ BP in a world's Behavior
// Packs). Proven on this PC by the Lifesteal pack, which does the same. Each
// subpack adds one hidden marker item, and that is how a script can tell which
// one is on: scripts can't read the subpack itself, but they can ask whether
// an item type exists.
//
// Default is listed first and on the higher memory tier, so the slider reads
// Default ——— Beta and a new world starts on Default.
//
// Every Beta feature asks isBeta(). Nothing is in Beta yet; Admin+'s own look
// will be first.

const BETA_MARKER = "adminplus:channel_beta"

function hasItemType(id) {
    try {
        if (typeof ItemTypes.get === "function") return !!ItemTypes.get(id)
        return ItemTypes.getAll().some(type => type?.id === id)
    } catch { return false }
}

/** True when the pack settings slider is on Beta. */
export function isBeta() { return hasItemType(BETA_MARKER) }

/** "Default" or "Beta", for screens. */
export function channelName() { return isBeta() ? "Beta" : "Default" }
