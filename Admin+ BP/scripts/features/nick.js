import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { displayName, getNickname, setNickname, NICK_MAX } from "../core/identity.js"
import { canActOn, refreshNameTag } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { nicknameScreen } from "./actions.js"

// /nick <player> [name]   — set a display name, or clear it by leaving name off
// /nick                   — the form, for your own
//
// The panel has had this since ranks existed; this is the same act with a
// keyboard instead of four taps, which is what staff actually do mid-session.
// Both routes call setNickname and record name.set, so the audit line reads the
// same whichever was used.

command({
    name: "nick",
    description: "Set a display name — /nick <player> [name], or omit the name to clear it",
    perm: "admin.nickname",
    optional: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "name", type: CustomCommandParamType.String }
    ],
    run: (player, [selected, wanted]) => {
        const targets = selected ?? []

        // Bare /nick opens the same form the panel opens, on yourself.
        if (!targets.length) return nicknameScreen(player, player, undefined)
        if (targets.length > 1) return err(player, "One player at a time.")

        const target = targets[0]
        if (target.id !== player.id && !canActOn(player, target)) {
            return err(player, `${displayName(target)} outranks you.`)
        }

        const text = String(wanted ?? "")
        if (text.trim().length > NICK_MAX) {
            return err(player, `Display names cap at ${NICK_MAX} characters.`)
        }

        const previous = getNickname(target)
        const applied = setNickname(target, text)
        refreshNameTag(target)
        record(player, applied ? "name.set" : "name.clear", target,
            applied ? applied : "back to account name", { kind: "nickname", previous })

        if (!applied) {
            ok(player, `Cleared §f${target.name}§a's display name.`)
            if (target.id !== player.id) target.sendMessage("§7Your display name was cleared.")
            return
        }
        ok(player, `§f${target.name}§a is now §r${applied}§a.`)
        if (target.id !== player.id) target.sendMessage(`§7You are now shown as §r${applied}§7.`)
    }
})
