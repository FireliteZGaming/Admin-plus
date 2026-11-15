import { ItemTypes } from "@minecraft/server"

// The pack settings slider: the gear beside Admin+ BP in a world's Behavior
// Packs. It began as Default and Beta (2.10.1, the user: "a little slider ...
// so Beta type stuff is in Beta, such as the UI").
//
// **Since 2.12.10 it picks the MENUS, and every Beta feature is everyone's.**
// The user, 2026-11-14: Beta "should become the default look yes, but we
// have to add a switch that can switch it to normal".
//   Admin+ menus      Admin+'s own look (core/look.js): the dark frame, tiles,
//                     template cards and the Logs timeline. The default.
//   Minecraft menus   the game's own menus, with every feature still on.
//
// The slider is the behaviour pack's SUBPACKS. Each subpack adds one hidden
// marker item, and that is how a script tells them apart: scripts can't read
// the subpack, but they can ask whether an item type exists. The folders keep
// their old names (beta = Admin+ menus, default = Minecraft menus), so every
// world keeps the menus it already had.
//
// **Admin+ menus is listed LAST.** The game picks a new world's subpack by
// `memory_performance_tier`, which needs manifest version 3 (still
// experimental), so Admin+'s subpacks tie, and on a tie "the system selects
// the last subpack listed of that tier". Both stay on memory_tier 0.
//
// **A script can read one slider per pack, no more.** Subpacks give a pack one
// slider, and nothing in a script can read the resource pack's. Mojang's pack
// settings screen allows many toggles and sliders, but for a behaviour pack it
// is still experimental and needs manifest version 3 (Microsoft's docs,
// checked 2026-11-14). So a Beta channel for what comes after 3.0.0 returns
// there once it is finished, or as a switch in Server > Advanced. Until then
// isBeta() is false and nothing asks it.

const ADMIN_MENUS_MARKER = "adminplus:channel_beta"

function hasItemType(id) {
    try {
        if (typeof ItemTypes.get === "function") return !!ItemTypes.get(id)
        return ItemTypes.getAll().some(type => type?.id === id)
    } catch { return false }
}

/** True when the pack settings slider is on Admin+ menus. */
export function adminMenus() { return hasItemType(ADMIN_MENUS_MARKER) }

/** "Admin+ menus" or "Minecraft menus", for screens. */
export function menusName() { return adminMenus() ? "Admin+ menus" : "Minecraft menus" }

/** Beta features: none since 2.12.10, when Beta became everyone's (see above). */
export function isBeta() { return false }
