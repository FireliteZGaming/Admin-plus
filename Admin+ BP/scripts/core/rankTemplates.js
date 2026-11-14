import { BASIC_PERMS, STAFF_CORE } from "./ranks.js"
import { SERVER_PRESETS_ON_HOLD } from "./hold.js"

// Templates for a new STAFF rank (2.11.4, the user's design of 2026-11-13).
//
// Ranks ▸ + New rank asks a staff rank to start from one of these, or from
// switches picked one by one. The user: "think about how discord does it, but
// we will be a bit more clear ... Moderator, Administrator, Manager, or
// Owner", shown as four cards side by side in the Beta look, and the Owner
// card has to "state that owner gets a lot of power and is litterly on par
// with an owner". Templates for other rank types come later.
//
// A template COPIES its permissions into the new rank once. Later changes to
// a template never reach ranks made from it; "Also gets permissions from" on a
// rank's Permissions screen is the live link.
//
// What each one gives is a starting point the user will set themselves. Until
// then it is the shipped Server ranks, flattened: each template has
// everything the one before it has. Each includes the basics (warp, spawn,
// TPA, reports, who is online), because a staff rank replaces the starting
// rank as a player's tag and must not lose them.
//
// `points` are the ticks on the card: short, because a card in the game's
// Beta frame is about 85 wide, roughly 13 letters a line. `badge` is the badge
// the new rank wears (core/badges.js).

const MOD = [
    ...BASIC_PERMS, ...STAFF_CORE,
    "admin.warn", "admin.kick", "admin.mute", "admin.freeze", "admin.staffmode", "admin.tpatoggle",
    "admin.reports", "admin.automod", "admin.clearchat", "admin.lagclear", "admin.claims", "admin.alerts",
    "admin.tp", "admin.vanish", "admin.gamemode", "admin.invsee", "admin.logs", "admin.broadcast",
    "admin.settings", "chat.spy"
]
const ADMIN = [
    ...MOD,
    "admin.ban", "admin.nickname", "admin.holograms", "ranks.grant", "warp.manage", "spawn.set", "chat.*"
]
const MANAGER = [...ADMIN, "admin.*", "ranks.*", "presets.apply"]

export const STAFF_TEMPLATES = Object.freeze([
    {
        key: "mod", name: "Mod", colour: "§a", badge: "hammer",
        line: "Keeps the peace day to day.",
        points: ["Warn, mute, kick", "Freeze and vanish", "Reports and logs"],
        perms: MOD
    },
    {
        key: "admin", name: "Admin", colour: "§6", badge: "shield",
        line: "A Mod, plus heavier tools.",
        points: ["Ban players", "Give lower ranks", "Warps and spawn"],
        perms: ADMIN
    },
    {
        key: "manager", name: "Manager", colour: "§5", badge: "star",
        line: "Runs the server for you.",
        // While Server presets are hidden (core/hold.js) the third tick names
        // what Manager has and Admin doesn't: the allowlist and Automation.
        // The permission itself stays in MANAGER, so the rank is ready when
        // presets come back.
        points: ["Every staff tool", "Make and edit ranks", SERVER_PRESETS_ON_HOLD ? "Allowlist, Automation" : "Server presets"],
        perms: MANAGER
    },
    {
        key: "owner", name: "Owner", colour: "§4", badge: "crown",
        line: "On par with the owner.",
        points: ["Every permission", "Any rank, to anyone", "Every setting"],
        // Short enough to stay inside its card (2.11.4 ran out of it in game).
        warn: "Only for someone you fully trust.",
        perms: ["*"]
    }
].map(template => Object.freeze({ ...template, points: Object.freeze([...template.points]), perms: Object.freeze([...new Set(template.perms)]) })))

export function staffTemplate(key) {
    return STAFF_TEMPLATES.find(template => template.key === key)
}
