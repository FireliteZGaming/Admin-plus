import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { menu, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err } from "../core/util.js"
import { has } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { OP_BLOCKS, opBlockNames, giveOpBlock } from "../core/opblocks.js"

// /opblock <block> [count]  — and /admin ▸ Operator blocks
//
// Barriers, deny and allow zones, world borders. Vanilla keeps them behind the
// Operator Utilities creative tab, so wanting a builder to place a barrier has
// always meant opping them — and an operator can do everything, including
// opping other people. This is the same problem ranks exist to solve, applied
// to blocks instead of commands.

const blockEnum = defineEnum("opblock", opBlockNames())

command({
    name: "opblock",
    description: "Get an operator utility block — /opblock <block> [count]",
    perm: "admin.opblocks",
    mandatory: [{ name: blockEnum, type: CustomCommandParamType.Enum }],
    optional: [{ name: "count", type: CustomCommandParamType.Integer }],
    run: (player, [id, count]) => {
        const result = giveOpBlock(player, id, count ?? 1)
        if (!result.ok) return err(player, result.reason)
        ok(player, `${result.given}x §f${result.block.label}§a.`)
        record(player, "admin.opblock", undefined, `${result.given}x ${result.block.label}`)
    }
})

/** The panel screen: each block, and what it is actually for. */
export async function opBlocksScreen(player, back) {
    if (!has(player, "admin.opblocks")) {
        err(player, "You can't take operator blocks.")
        return back()
    }

    return menu(player, {
        title: hubTitle("settings", "Operator blocks"),
        body: [
            subtitle("Tap one to put a stack in your inventory."),
            "",
            "§8These normally need operator status to get hold of. Your rank",
            "§8covers them instead, so nobody has to be opped to place a barrier."
        ].join("\n"),
        buttons: OP_BLOCKS.map(block => ({
            text: `§b${block.label}§r\n§8${block.what}`,
            run: () => {
                const result = giveOpBlock(player, block.id, 16)
                if (!result.ok) { err(player, result.reason); return opBlocksScreen(player, back) }
                ok(player, `${result.given}x §f${block.label}§a.`)
                record(player, "admin.opblock", undefined, `${result.given}x ${block.label}`)
                return opBlocksScreen(player, back)
            }
        })),
        back
    })
}
