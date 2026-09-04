import { world, CustomCommandParamType } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { isStaff, isOwner } from "../core/ranks.js"
import { record } from "../core/logs.js"
import {
    isEnabled, setEnabled, addName, removeName, listNames, count,
    doorCheck, inMaintenance, setMaintenance, maintenanceReason
} from "../core/allowlist.js"
import { kick } from "../core/moderation.js"

// /guestlist on|off|add|remove|list [player]
//
// The opposite of the ban list, and useful for the opposite reason: a ban list
// is reactive and answers "who did we throw out", while this answers "who is
// invited". The evening a Realm link travels further than you meant, the ban
// list is no help at all.
//
// NOT called /allowlist or /whitelist: both are vanilla command names on
// dedicated servers, and a name the game already owns would leave ours
// reachable only as /a:allowlist. Same trap /me and /msg hit.
//
// Names, not player ids, because the whole point is inviting somebody who has
// never been here — and an id only exists once they have.

const actionEnum = defineEnum("guestaction", ["on", "off", "add", "remove", "list"])
const modeEnum = defineEnum("maintenancemode", ["on", "off"])

command({
    name: "guestlist",
    description: "Only invited players may join — /guestlist <on|off|add|remove|list> [player]",
    perm: "admin.allowlist",
    mandatory: [{ name: actionEnum, type: CustomCommandParamType.Enum }],
    optional: [{ name: "player", type: CustomCommandParamType.String }],
    run: (player, [action, name]) => {
        const what = String(action).toLowerCase()
        const who = String(name ?? "").trim()

        if (what === "list") {
            const held = listNames()
            if (!held.length) return info(player, "§7Nobody is on the guest list yet.")
            return info(player, [
                `§7Guest list §8(${held.length}) · ${isEnabled() ? "§aon" : "§coff"}`,
                ...held.map(entry => `§8· §f${entry.name} §8— added by ${entry.by}`)
            ].join("\n"))
        }

        if (what === "on" || what === "off") {
            const turningOn = what === "on"
            if (turningOn && !count()) {
                return err(player, "Add somebody first, or turning it on would empty the world.")
            }
            setEnabled(turningOn)
            record(player, turningOn ? "admin.guestOn" : "admin.guestOff", undefined,
                `${count()} on the list`)
            ok(player, turningOn
                ? `Guest list §aon§a. §f${count()}§a invited; everyone else is turned away.`
                : "Guest list §coff§a. Anyone can join again.")
            if (turningOn) removeUninvited(player)
            return
        }

        if (!who) return err(player, `Type a player name. For example: /guestlist ${what} Steve`)

        if (what === "add") {
            if (!addName(who, player)) return info(player, `§f${who}§7 is already on the list.`)
            record(player, "admin.guestAdd", undefined, who)
            return ok(player, `Added §f${who}§a. §7${count()} on the list.`)
        }

        if (!removeName(who)) return info(player, `§f${who}§7 was not on the list.`)
        record(player, "admin.guestRemove", undefined, who)
        ok(player, `Removed §f${who}§a.`)
        if (isEnabled()) removeUninvited(player)
    }
})

command({
    name: "maintenance",
    description: "Close the world to everyone but staff — /maintenance <on|off> [reason]",
    perm: "admin.allowlist",
    mandatory: [{ name: modeEnum, type: CustomCommandParamType.Enum }],
    optional: [{ name: "reason", type: CustomCommandParamType.String }],
    run: (player, [mode, reason]) => {
        const on = String(mode).toLowerCase() === "on"
        setMaintenance(on, reason)
        record(player, on ? "admin.maintenanceOn" : "admin.maintenanceOff", undefined,
            on ? maintenanceReason() : "reopened")

        if (!on) return ok(player, "Maintenance §coff§a. The world is open again.")

        ok(player, `Maintenance §aon§a. Everyone but staff is turned away.`)
        info(player, `§8They will be told: §f${maintenanceReason()}`)
        removeUninvited(player)
    }
})

/** Turn away anyone already here who the door no longer admits. */
async function removeUninvited(actor) {
    for (const other of world.getAllPlayers()) {
        if (other.id === actor.id) continue
        const door = doorCheck(other, { staff: isStaff(other), owner: isOwner(other) })
        if (door.ok) continue
        await kick(other, door.reason)
        info(actor, `§7Turned away §f${other.name}§7 — ${door.reason}`)
    }
}

/**
 * The gate itself. Staff and owners are never turned away: locking the person
 * who administers the world out of it, because they forgot to add their own
 * name to a list they just switched on, is the obvious way for this to go
 * wrong and the one thing it must not do.
 */
export function installAllowlist() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        const door = doorCheck(player, { staff: isStaff(player), owner: isOwner(player) })
        if (door.ok) return
        // kick() is async now — it awaits the CommandResult so it can report
        // whether anybody actually moved, rather than assuming.
        kick(player, door.reason).then(removed => {
            console.log(`[Admin+] turned away ${player.name}: ${door.reason}`
                + (removed ? "" : " — BUT THEY WERE NOT REMOVED"))
        })
    })
}
