import { ItemStack } from "@minecraft/server"

// The operator utility blocks, handed out without operator.
//
// Barrier, deny, allow, border and the rest are ordinary blocks that vanilla
// only puts behind the Operator Utilities creative tab and /give, both of which
// need op. That is the whole problem this addon exists for: wanting a builder
// to place barriers should not mean handing them the ability to op other
// people. A rank node gates them instead.
//
// Handed out by the script API rather than by running /give, which would need
// the PLAYER to be an operator and defeat the point. Building an ItemStack and
// putting it in a container is not permission-checked.
//
// WHAT IS DELIBERATELY MISSING, and why it is not an oversight: command blocks,
// structure blocks and jigsaw blocks are not here. Their whole purpose is the
// UI you get when you tap them, and that UI is gated on operator status by the
// game itself. Handing one to a non-op gives them a block they cannot open —
// a feature that looks broken rather than one that works.

/**
 * @typedef {{ id: string, label: string, what: string }} OpBlock
 */

/** @type {OpBlock[]} */
export const OP_BLOCKS = [
    {
        id: "minecraft:barrier",
        label: "Barrier",
        what: "An invisible wall. Nothing walks through it, and only you can see it while holding one."
    },
    {
        id: "minecraft:deny",
        label: "Deny",
        what: "Stops non-staff building anywhere above it in that chunk. The usual way to protect a spawn area."
    },
    {
        id: "minecraft:allow",
        label: "Allow",
        what: "Cuts a hole in a Deny area — building works again above it. Place it inside a protected zone."
    },
    {
        id: "minecraft:border_block",
        label: "Border",
        what: "A visible wall from bedrock to sky. Players cannot cross it in either direction."
    },
    {
        id: "minecraft:light_block",
        label: "Light",
        what: "An invisible light source. Lights a room without a torch in it."
    },
    {
        id: "minecraft:structure_void",
        label: "Structure void",
        what: "Marks empty space when saving a structure, so it does not overwrite what is already there."
    }
]

export function getOpBlock(id) {
    const wanted = String(id ?? "").toLowerCase()
    return OP_BLOCKS.find(b => b.id === wanted || b.id === `minecraft:${wanted}`
        || b.label.toLowerCase() === wanted)
}

/** Short ids for the command's tab-completion vocabulary. */
export function opBlockNames() {
    return OP_BLOCKS.map(b => b.id.replace("minecraft:", ""))
}

/**
 * Put some in a player's inventory.
 * @returns {{ok: true, given: number} | {ok: false, reason: string}}
 */
export function giveOpBlock(player, id, count = 1) {
    const block = getOpBlock(id)
    if (!block) return { ok: false, reason: `No operator block called "${id}".` }

    const amount = Math.max(1, Math.min(64, Math.floor(Number(count) || 1)))
    const container = player?.getComponent?.("minecraft:inventory")?.container
    if (!container) return { ok: false, reason: "Couldn't reach your inventory." }

    // addItem returns UNDEFINED on success and the leftover stack when it did
    // not all fit. An earlier helper in this pack treated any falsy return as
    // failure and reported "inventory full" on every successful take.
    try {
        const leftover = container.addItem(new ItemStack(block.id, amount))
        const spare = leftover?.amount ?? 0
        if (spare >= amount) return { ok: false, reason: "Your inventory is full." }
        return { ok: true, given: amount - spare, block }
    } catch (e) {
        return { ok: false, reason: `The game refused that item: ${e}` }
    }
}
