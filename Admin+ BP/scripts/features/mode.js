import { CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { record } from "../core/logs.js"
import {
    DEV_TAG, canUseCode, hasOperator, inDeveloperMode, setDeveloperMode
} from "../core/devgate.js"

// /mode <default|developer> — the door onto < Code >.
//
// Developer mode used to be reachable only by typing `/tag @s add Dev`, which
// is a thing you have to be told once and remember forever. This is the same
// switch with a name on it, and an enum so the game completes it for you.
//
// IT GRANTS NOTHING NEW. Any operator could already give themselves that tag —
// `/tag` is a vanilla command and op is what it answers to. So `/mode` asks for
// operator and then writes the tag; the gate is still "operator, deliberately",
// which is what it always was.
//
// It is a SET, not a toggle. `/mode developer` twice leaves you in developer
// mode and says so, rather than quietly dropping you back to default — a
// command that names a state should land on that state every time. `/mode
// default` is the way out, and it is the reason a toggle would be worse: there
// is already an explicit word for off.

const modeEnum = defineEnum("mode", ["default", "developer"])

command({
    name: "mode",
    description: "Switch yourself in or out of developer mode — /mode <default|developer>",
    // No permission node on purpose: this answers to OPERATOR, not to a rank.
    // A node would imply an owner could hand developer mode to somebody who is
    // not op, and the gate deliberately does not work that way.
    mandatory: [{ name: modeEnum, type: CustomCommandParamType.Enum }],
    run: (player, [chosen]) => {
        const wanted = String(chosen ?? "").toLowerCase()

        if (wanted === "developer") {
            if (!hasOperator(player)) {
                return err(player, "Developer mode needs operator status. Ask whoever runs this world.")
            }
            if (canUseCode(player)) {
                return info(player, "§7You're already in developer mode. §f/mode default§7 leaves it.")
            }
            if (!setDeveloperMode(player, true)) {
                return err(player, "Couldn't switch you into developer mode.")
            }
            record(player, "dev.mode", player, "developer")
            ok(player, "§7Developer mode on. §8< Code > is open in /admin.")
            return
        }

        if (!inDeveloperMode(player)) {
            return info(player, "§7You're already on default.")
        }
        if (!setDeveloperMode(player, false)) {
            return err(player, "Couldn't switch you back to default.")
        }
        record(player, "dev.mode", player, "default")
        ok(player, "§7Back to default. §8< Code > is closed again.")
    }
})

export { DEV_TAG }
