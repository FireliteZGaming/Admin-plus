import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { record } from "../core/logs.js"
import { runAsServer, commandName } from "../core/execute.js"

// /exec <command> — run a vanilla command without being an operator.
//
// The reason this exists, in one sentence: taking somebody's op away used to
// take real capability with it, so "your rank gives you the same power" was a
// promise the pack could not keep. Now it can.
//
// The node is deliberately NOT handed out by any shipped ladder. Giving it away
// is a decision an owner should make on purpose, for one person, in the rank
// editor — not something that arrives with a preset.

command({
    name: "exec",
    description: "Run a vanilla command without operator — /exec <command>",
    perm: "admin.commands",
    mandatory: [{ name: "command", type: CustomCommandParamType.String }],
    run: (player, [line]) => {
        const result = runAsServer(player, line)
        if (!result.ok) return err(player, result.reason)

        ok(player, `Ran §f/${result.command}§a.`)
        // Logged and announced, which is the whole difference between this and
        // operator. An operator running /give leaves no trace anywhere.
        record(player, "admin.exec", undefined, result.command)
    }
})

export { commandName }
