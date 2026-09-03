import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err } from "../core/util.js"
import { canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { postToChannel } from "./chat.js"
import { activeChannel } from "../core/channels.js"
import { record } from "../core/logs.js"
import { phraseFor } from "../core/audit.js"

// /sudo <player> "message" — put words in someone's mouth, or a command in
// their hands.
//
//   /sudo Nova "hi everyone"     they say it, indistinguishable from typing it
//   /sudo Nova "/kill @s"        they RUN it, at their own permission level
//
// Two things keep this honest rather than dangerous:
//   * rank protection — you cannot sudo anyone at or above your own ladder row,
//     so it can't be pointed upward at staff;
//   * the command form runs as the TARGET, so it grants them nothing. Sudoing a
//     member "/gamemode creative" fails exactly as it would if they typed it.
//
// Every use is written to the content log, and senior staff are told in chat —
// through core/audit.js, which gives sudo a NARROWER audience than any other
// action: holders of admin.sudo only. Anyone else who read "X used sudo on Y"
// could simply go and tell Y, which would end the command's usefulness.

const MAX_LENGTH = 256

command({
    name: "sudo",
    description: 'Make a player say something — /sudo <player> "message"',
    perm: "admin.sudo",
    mandatory: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "message", type: CustomCommandParamType.String }
    ],
    run: (player, [selected, message]) => {
        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")

        const text = String(message ?? "").trim().slice(0, MAX_LENGTH)
        if (!text) return err(player, "Type what they should say.")

        const asCommand = text.startsWith("/")
        const spoke = []
        const blocked = []

        for (const target of targets) {
            if (target.id !== player.id && !canActOn(player, target)) {
                blocked.push(displayName(target))
                continue
            }

            if (asCommand) {
                try {
                    target.runCommand(text.slice(1))
                    spoke.push(displayName(target))
                } catch (e) {
                    // Usually a permission failure, which is the correct outcome:
                    // the target could not have run it either.
                    err(player, `§f${displayName(target)}§c couldn't run that: ${e}`)
                }
            } else {
                postToChannel(target, text, activeChannel(target))
                spoke.push(displayName(target))
            }

            record(player, "player.sudo", target, text)
            console.log(`[Admin+] sudo: ${player.name} -> ${target.name}: ${text}`)
        }

        // Name the ACT, not the illusion. "Steve said it" describes what the
        // room saw; what you did was use sudo on Steve, and the line you get
        // back should say so — it is the same sentence that ends up in the log,
        // and reading the two in different words made them hard to line up.
        if (spoke.length) {
            // Senior staff hear about it through core/audit.js, off the log
            // entry above — this is only the confirmation to whoever ran it.
            // Same sentence they get, from the same function, so the two read
            // alike when someone lines them up.
            ok(player, `§7${phraseFor("player.sudo", spoke.join(", "))}§8: ${text}`)
        }
        if (blocked.length) err(player, `Outranked you, skipped: §f${blocked.join(", ")}`)
    }
})
