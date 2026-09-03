import { ActionFormData } from "@minecraft/server-ui"
import { ItemTypes, BlockTypes } from "@minecraft/server"
import { setting } from "./settings.js"
import { typeIdToDataId, typeIdToID } from "./typeIds.js"
import { textureFor } from "./itemTextures.js"

// A chest-shaped form: a real 9-column grid of item icons, not a list of
// buttons with words on them.
//
// HOW THIS WORKS, because it looks like black magic otherwise. Bedrock gives
// scripts no container UI. What it does give is an ActionFormData whose title
// and button icons are strings the resource pack can see. So:
//
//   * The TITLE starts with a sentinel — "§s§h§o§p§c§h§e§s§t§r" — that the
//     JSON-UI in Admin+ RP/ui matches on. Recognising it, the pack throws away
//     the list layout and draws a chest grid instead. The real title follows a
//     second sentinel, "§m§c§e§r", so the UI can split one from the other.
//   * Each button's ICON identifies the picture, and there are two ways to do
//     it. A TEXTURE PATH ("textures/items/diamond_sword") the pack draws as a
//     plain image — stable across game versions, and what we use for items,
//     from the generated itemTextures.js. Or a NUMBER, the item's index in the
//     game's registry shifted up by 65536 (plus 32768 to shimmer), which the
//     pack feeds to the item renderer — the only way to draw a BLOCK, whose
//     icon is a 3D model render, but tied to the exact game build.
//   * The button's TEXT carries "stack#07" and "dur#42" prefixes, which the UI
//     reads to draw the stack count and the durability bar, then hides.
//
// The sentinels are deliberately the SAME strings the community module uses
// (see the credit below). That is a compatibility decision, not laziness: if
// another pack that speaks this protocol loads its UI above ours, our chest
// forms still render correctly under theirs, and theirs under ours. Diverging
// would guarantee that exactly one of the two packs looked broken.
//
// Technique credit: the ChestFormData protocol is a Bedrock community module
// maintained by Herobrine64 and LeGend077, and is used by most addons that show
// an inventory. The JSON-UI in our resource pack and this file are our own; the
// wire format is theirs, and has to match exactly to be worth anything.

const SIZES = new Map([
    ["small", ["§c§h§e§s§t§s§m§a§l§l§r", 27]],
    ["large", ["§s§h§o§p§c§h§e§s§t§r", 54]]
])

const TITLE_SPLIT = "§m§c§e§r"

/**
 * The nudge applied to every item id of 256 or above.
 *
 * ZERO by default, and that default is the measured answer rather than a guess.
 * The theory behind a non-zero offset is that custom items registered by other
 * packs shift the vanilla atlas indices; the community module computes it from
 * ItemTypes.getAll(). Tried that here and it was demonstrably wrong: on a world
 * where it counted 25, an acacia boat (411) drew as pink dye (436) — off by
 * exactly the count. Zero is what actually lines up.
 *
 * It stays a knob because the icon table is version-sensitive and no amount of
 * reasoning beats looking at the screen. If icons are uniformly N places out,
 * set invsee.iconOffset to -N in < Code > and they snap back; nobody should
 * need a code change to fix a picture.
 */
function iconOffset() {
    const raw = Number(setting("invsee.iconOffset"))
    return Number.isFinite(raw) ? Math.trunc(raw) : 0
}

/**
 * How many custom items this world has, for diagnostics only.
 *
 * Deliberately NOT wired into the arithmetic — see above. Kept because it is
 * the number to reach for first if the offset ever needs explaining.
 */
export function measureCustomItems() {
    try {
        return ItemTypes.getAll().filter(type => {
            const id = String(type?.id ?? "")
            if (!id || id.startsWith("minecraft:")) return false
            if (id.endsWith("spawn_egg")) return false
            try { if (BlockTypes.get(id)) return false } catch { /* not a block */ }
            return true
        }).length
    } catch {
        return 0
    }
}

export class ChestForm {
    #title
    #slots

    constructor(size = "large") {
        const [sentinel, count] = SIZES.get(size) ?? SIZES.get("large")
        this.#title = sentinel
        this.size = count
        this.#slots = new Array(count).fill(null).map(() => ["", undefined])
    }

    title(text) {
        this.#title += `${TITLE_SPLIT}${text}`
        return this
    }

    /**
     * Put an item in a slot.
     * @param {number} slot 0-based, reading left to right, top to bottom
     * @param {string} name shown in bold at the top of the tooltip
     * @param {string[]} lines the rest of the tooltip
     * @param {string} typeId e.g. "minecraft:diamond_sword"
     * @param {number} amount stack size, drawn in the corner
     * @param {boolean} enchanted draw the shimmer
     * @param {number} durability 0-99, drawn as the damage bar
     */
    button(slot, name, lines, typeId, amount = 1, enchanted = false, durability = 0) {
        if (slot < 0 || slot >= this.size) return this

        const stack = String(Math.min(Math.max(amount, 1) || 1, 99)).padStart(2, "0")
        const dur = String(Math.min(Math.max(durability, 0), 99)).padStart(2, "0")
        const body = lines?.length ? `\n§r${lines.join("\n§r")}` : ""

        // A TEXTURE PATH first, wherever we have one. The resource pack draws
        // any icon string beginning with "textures" as a plain image, and a path
        // cannot drift: "textures/items/diamond_sword" means the same thing on
        // every build. The numeric id does not — it is a position in the game's
        // item registry, and a table built for one version draws its neighbours
        // on another. That is what turned an acacia boat into pink dye.
        //
        // The numeric route still covers what paths cannot: BLOCKS, whose icon
        // is a 3D render of the model rather than a flat picture, and the
        // handful of items drawn from a dyed model. Both are ids under 256 or
        // absent from the map, and neither was ever affected by the drift.
        const path = textureFor(typeId)
        let icon
        if (path) {
            icon = path
        } else {
            const id = typeIdToDataId.get(typeId) ?? typeIdToID.get(typeId)
            icon = id === undefined
                ? typeId
                : ((id + (id < 256 ? 0 : iconOffset())) * 65536) + (enchanted ? 32768 : 0)
        }

        this.#slots[slot] = [`stack#${stack}dur#${dur}§r${name ?? ""}§r${body}`, icon]
        return this
    }

    /** An empty, unclickable-looking slot. Used to pad the armour row. */
    blank(slot) {
        if (slot >= 0 && slot < this.size) this.#slots[slot] = ["", undefined]
        return this
    }

    /**
     * Exactly what would be sent to the form, without showing it.
     *
     * Here so the wire format can be asserted in a test. The sentinels and the
     * icon arithmetic are invisible at a glance and a "tidy-up" that changes
     * either turns the chest into a list of gibberish, which is the sort of
     * thing you want a test to catch rather than a playtest.
     */
    preview() {
        return { title: this.#title, buttons: this.#slots.map(([text, icon]) => ({ text, icon })) }
    }

    show(player) {
        const form = new ActionFormData().title(this.#title)
        for (const [text, icon] of this.#slots) {
            form.button(text, icon === undefined ? undefined : String(icon))
        }
        return form.show(player)
    }
}

/** Is the numeric-icon table actually loaded? */
export function chestUIAvailable() {
    return typeIdToID.size > 0 || typeIdToDataId.size > 0
}
