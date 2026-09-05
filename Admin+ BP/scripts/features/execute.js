import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { record } from "../core/logs.js"
import { runAsServer, commandName } from "../core/execute.js"
import { DEFAULTS } from "../core/settings.js"

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

// ---------------------------------------------------------------- the grammar
//
// FIXED after the 2.0.0 playtest, where /cmd did not work at all.
//
// It took a single String parameter, and a Bedrock String parameter is ONE
// TOKEN — it stops at the first space. So `/cmd kill @e[type=cow]` handed the
// game an unexpected second argument and came back a syntax error, and only a
// bare one-word command could ever have run. That limit is written down in this
// project's own notes; this command was built straight through it.
//
// The shape now: an ENUM of the command names, then the arguments as separate
// optional tokens which are joined back together with spaces.
//
// The enum is not only a fix. It is what gives a custom command tab-completion
// over its own vocabulary, so typing `/cmd ` now offers the command list the
// way a vanilla command does — which is what was asked for. What it cannot do
// is complete the ARGUMENTS of the command you picked: those belong to a
// grammar the game does not expose to custom commands, so past the first word
// you are on your own.

/**
 * The vocabulary to complete over — the SHIPPED list, not the live setting.
 *
 * Commands register during startup, which is the same early-execution window
 * where storage reads throw, so the live value is not reliably readable yet.
 * The live `commands.allowed` remains the authority on what actually RUNS:
 * checkCommand reads it on every call. Narrowing the list still works — it just
 * does not shorten the completion popup until the next reload.
 */
const CATALOGUE = String(DEFAULTS["commands.allowed"]?.value ?? "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)

const cmdEnum = defineEnum("cmd", CATALOGUE)

/** Bedrock allows 8 parameters. One is the command name, so seven are left for
 *  its arguments. A quoted "a b c" still arrives as a single token, which is
 *  the way past seven when somebody needs it. */
const ARG_SLOTS = 7

/**
 * Put the tokens back into one command line.
 *
 * Unfilled optional slots arrive as `undefined`. Empty strings are dropped as
 * well: a trailing "" would turn `/cmd clear` into `"clear "`, which is a
 * different string to log and compare even where the game forgives it.
 */
export function commandLine(name, args = []) {
    return [name, ...args.filter(a => typeof a === "string" && a !== "")]
        .filter(a => typeof a === "string" && a !== "")
        .join(" ")
}

/** Exported so a test can assert what the completion popup will offer, which is
 *  now also the limit on what can be TYPED. */
export { CATALOGUE }

command({
    name: "cmd",
    description: "Run a vanilla command without operator — /cmd <command> [args…]",
    perm: "admin.commands",
    mandatory: [{ name: cmdEnum, type: CustomCommandParamType.Enum }],
    optional: Array.from({ length: ARG_SLOTS }, (_, i) => (
        { name: `arg${i + 1}`, type: CustomCommandParamType.String }
    )),
    run: (player, [name, ...args]) => {
        const result = runAsServer(player, commandLine(name, args))
        if (!result.ok) return err(player, result.reason)

        ok(player, `Ran §f/${result.command}§a.`)
        // Logged and announced, which is the whole difference between this and
        // operator. An operator running /give leaves no trace anywhere.
        record(player, "admin.cmd", undefined, result.command)
    }
})

export { commandName }
