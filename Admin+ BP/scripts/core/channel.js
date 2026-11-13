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
// **Default is listed LAST (2.11.1).** 2.10.1 listed Default first on a higher
// memory_tier, and the user's world started on Beta anyway (2026-11-13). The
// game now picks the starting subpack by `memory_performance_tier`, which
// needs manifest version 3 (still experimental), so every Admin+ subpack ties,
// and Microsoft's docs say: "In the case of a tie, the system selects the last
// subpack listed of that tier." So the slider reads Beta ——— Default and new
// worlds start on Default. Both stay on memory_tier 0 so the tie holds on
// every device.
//
// Every Beta feature asks isBeta(). Admin+'s own look (2.11.0) is the first.

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
