import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { record } from "../core/logs.js"
import { runAsServer, commandName } from "../core/execute.js"

// /cmd <command> — run a vanilla command without being an operator.
//
// The reason this exists, in one sentence: taking somebody's op away used to
// take real capability with it, so "your rank gives you the same power" was a
// promise the pack could not keep. Now it can.
//
// Named /cmd rather than /exec since 1.20.0. "exec" is a programmer's word for
// it, and the thing on the other side is a COMMAND — the list it checks is a
// list of commands, the setting is called commands.allowed, and the node is
// admin.commands. One word for one idea.
//
// The node is deliberately NOT handed out by any shipped ladder. Giving it away
// is a decision an owner should make on purpose, for one person, in the rank
// editor — not something that arrives with a preset.

command({
    name: "cmd",
    description: "Run a vanilla command without operator — /cmd <command>",
    perm: "admin.commands",
    mandatory: [{ name: "command", type: CustomCommandParamType.String }],
    run: (player, [line]) => {
        const result = runAsServer(player, line)
        if (!result.ok) return err(player, result.reason)

        ok(player, `Ran §f/${result.command}§a.`)
        // Logged and announced, which is the whole difference between this and
        // operator. An operator running /give leaves no trace anywhere.
        record(player, "admin.cmd", undefined, result.command)
    }
})

export { commandName }
