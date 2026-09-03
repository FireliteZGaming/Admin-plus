import { Table } from "./storage.js"
import { CONFIG } from "../config.js"

// Runtime settings — the values the Code screen edits.
//
// config.js is the compiled-in default; this table is the live override, so a
// change made in-game survives a rejoin without touching a script file. Anything
// listed in DEFAULTS is editable at runtime; anything not listed stays a code
// constant on purpose.

const store = new Table("settings", {})

/**
 * Everything the Code screen can reach, with the key's default and a one-line
 * explanation. Tokens available to the format strings are listed per entry.
 */
export const DEFAULTS = {
    "bracket.open": {
        value: "§8[",
        label: "Bracket — open",
        help: "Wraps the rank in {TAG}. Global."
    },
    "bracket.close": {
        value: "§8]",
        label: "Bracket — close",
        help: "Wraps the rank in {TAG}. Global."
    },
    "format.tag": {
        value: "{OPEN}{RANK}{CLOSE}",
        label: "Rank tag",
        help: "Tokens: {OPEN} {CLOSE} {RANK}"
    },
    "format.nameTag": {
        // Tag BESIDE the name, on one line — the way Essentials shows it.
        // Put \\n back in (via < Code >) to stack it above instead.
        value: "{TAG} §f{NAME}",
        label: "Nametag (above head)",
        help: "Tokens: {TAG} {RANK} {NAME}  ·  \\n stacks the tag above the name"
    },
    "format.chat": {
        value: "{TAG} §7{NAME} §8» §r{MSG}",
        label: "Chat line",
        help: "Tokens: {TAG} {RANK} {NAME} {MSG}  ·  needs beta APIs to take effect"
    },
    "format.chatChannel": {
        value: "{CHANNEL} §8|§r {TAG} {NAME}§7: §r{MSG}",
        label: "Chat line (multi-channel readers)",
        help: "Tokens: {CHANNEL} {TAG} {RANK} {NAME} {MSG} · used only for readers who see more than one channel"
    },
    "presence.announce": {
        value: "true",
        label: "Join and leave lines",
        help: "true / false · Admin+ prints them; the vanilla ones are silenced by the resource pack"
    },
    "format.join": {
        value: "§e{NAME} joined the game",
        label: "Join line",
        help: "Token: {NAME} · matches vanilla's wording and colour on purpose"
    },
    "format.leave": {
        value: "§e{NAME} left the game",
        label: "Leave line",
        help: "Token: {NAME} · /vanish prints this, which is what makes it convincing"
    },
    "vanish.hideFromLists": {
        value: "true",
        label: "Vanished players hidden from /online",
        help: "true / false · staff always see them, marked. NOTE: the pause-menu player list is drawn by the client and cannot be filtered per player — this covers Admin+'s own lists only."
    },
    "vanish.nightVision": {
        value: "true", label: "Vanish gives night vision", help: "true / false · handy when watching a dark cave"
    },
    "cleanup.items": {
        value: "true", label: "Lag clear: dropped items", help: "true / false"
    },
    "cleanup.xp": {
        value: "true", label: "Lag clear: XP orbs", help: "true / false"
    },
    "cleanup.projectiles": {
        value: "true", label: "Lag clear: spent projectiles", help: "true / false · arrows, snowballs, thrown potions"
    },
    "cleanup.fallingBlocks": {
        value: "false", label: "Lag clear: falling blocks", help: "true / false · off by default, it can break contraptions mid-fall"
    },
    "cleanup.warn": {
        value: "5", label: "Lag clear: warning seconds", help: "Countdown before clearing · 0 clears at once"
    },
    "cleanup.keep": {
        value: "", label: "Lag clear: protected items", help: "Comma separated, matched loosely · blank uses the built-in valuables list"
    },
    "automod.ores": {
        value: "true", label: "Automod: ore alerts", help: "true / false · grouped, reported when a mining run stops"
    },
    "automod.veinRadius": {
        value: "5", label: "Automod: vein radius (blocks)", help: "How far apart two ore blocks can be and still count as one find"
    },
    "automod.veinIdle": {
        value: "8", label: "Automod: vein close delay (seconds)", help: "Quiet for this long and the vein is reported"
    },
    "automod.oreThresholds": {
        value: "", label: "Automod: watched ores", help: "ore:vein size pairs, e.g. diamond_ore:3, ancient_debris:2 · blank uses the defaults"
    },
    "automod.breaks": {
        value: "true", label: "Automod: break rate", help: "true / false · flags impossible mining speed"
    },
    "automod.breakRate": {
        value: "20", label: "Automod: blocks a second", help: "Keep high — TNT and Efficiency V are legitimate"
    },
    "automod.spam": {
        value: "true", label: "Automod: chat flooding", help: "true / false"
    },
    "automod.spamRate": {
        value: "6", label: "Automod: messages in 10s", help: "Above this is flagged"
    },

    // Feature switches — what exists on this server at all. A feature turned
    // off here takes its commands with it, rather than leaving them to fail.
    "feature.warps": {
        value: "true", label: "Warps", help: "true / false · /warp and /warps"
    },
    "feature.spawn": {
        value: "true", label: "Spawn", help: "true / false · /spawn"
    },
    "feature.tpa": {
        value: "true", label: "Teleport requests", help: "true / false · /tpa and friends"
    },
    "feature.reports": {
        value: "true", label: "Reports", help: "true / false · /report and the panel queue"
    },
    "feature.chat": {
        value: "true", label: "Chat channels", help: "true / false · off means one plain chat for everyone"
    },
    "spawn.protect": {
        value: "false",
        label: "Spawn protection",
        help: "true / false · stops non-staff building near spawn"
    },
    "spawn.radius": {
        value: "16",
        label: "Spawn protection radius (blocks)",
        help: "How far the protection reaches from the spawn point"
    },
    "teleport.warmup": {
        value: "2",
        label: "Teleport warmup (seconds)",
        help: "Seconds of standing still before a teleport fires · 0 for instant · staff skip it"
    },
    "teleport.cancelOnMove": {
        value: "true",
        label: "Moving cancels a teleport",
        help: "true / false · the reason warmup stops people escaping a fight"
    },
    "teleport.cooldown": {
        value: "3",
        label: "Default teleport cooldown (seconds)",
        help: "Used when a rank sets no cooldown of its own · staff are exempt unless that is turned off"
    },
    "tpa.expire": {
        value: "60",
        label: "TPA request expiry (seconds)",
        help: "How long a teleport request waits before it lapses"
    },
    "ranks.permissionEditor": {
        value: "toggle",
        label: "Rank permission editor",
        help: "toggle / dropdown · dropdown gives Default, Allow and Deny per node"
    },
    "staff.exemptCooldowns": {
        value: "true",
        label: "Staff ignore cooldowns",
        help: "true / false · staff ranks wait zero on warps, spawn and TPA"
    },
    "format.noRankTag": {
        value: "",
        label: "Rank tag when they have no rank",
        help: "Leave empty to show nothing."
    },
    "format.command": {
        value: "§o§7[{NAME}: {ACTION}]",
        label: "Staff action line",
        help: "Tokens: {NAME} {ACTION} {TARGET} {DETAIL} · shown in chat to staff above the target. {ACTION} is the whole sentence, e.g. Banned Steve."
    },
    "audit.announce": {
        value: "true",
        label: "Announce staff actions in chat",
        help: "true / false · seen only by staff who outrank the target, never by the target. Sudo is narrower still — only holders of admin.sudo."
    },
    "invsee.iconOffset": {
        value: "0",
        label: "/invsee icon nudge",
        help: "Whole number · only touch this if EVERY icon is the same number of places wrong. Off by N to the right means -N."
    },
    "invsee.chestUI": {
        value: "true",
        label: "/invsee shows a chest grid",
        help: "true / false · the grid draws items from texture paths, which do not change between game versions. false gives a plain list that needs no resource pack at all."
    },
    "format.emote": {
        value: "§d* {NAME} §r§d§o{MSG}",
        label: "Emote line",
        help: "Tokens: {NAME} {MSG} {CHANNEL} · what /emote prints"
    },
    "feature.emote": {
        value: "true",
        label: "Emotes (/emote)",
        help: "true / false · lets players describe an action instead of saying something"
    },
    "format.pmOut": {
        value: "§8[§dyou §8» §d{NAME}§8] §7{MSG}",
        label: "Private message you sent",
        help: "Tokens: {NAME} {MSG} · {NAME} is who you sent it to"
    },
    "format.pmIn": {
        value: "§8[§d{NAME} §8» §dyou§8] §7{MSG}",
        label: "Private message you received",
        help: "Tokens: {NAME} {MSG} · {NAME} is who sent it"
    },
    "format.prchat": {
        value: "§8[§5private§8] §d{NAME}§7: §r{MSG}",
        label: "Private chat session line",
        help: "Tokens: {NAME} {MSG} · what /prchat prints to both people"
    },
    "format.spy": {
        value: "§8[spy · {KIND}] §7{FROM} §8» §7{TO}§8: {MSG}",
        label: "Social spy line",
        help: "Tokens: {FROM} {TO} {MSG} {KIND} · only holders of chat.spy who switched it on see this"
    },
    "feature.pm": {
        value: "true",
        label: "Private messages",
        help: "true / false · /pm, /r and /prchat"
    },
    "format.broadcast": {
        value: "§8[§c§lBroadcast§r§8]§r §e{MSG}",
        label: "Broadcast line",
        help: "Tokens: {MSG} {NAME} {CHANNEL} · {NAME} is whoever sent it"
    }
}

/** Current value of a setting: live override, else the shipped default. */
export function setting(key) {
    const stored = store.get(key)
    if (stored !== undefined && stored !== null) return stored
    return DEFAULTS[key]?.value ?? ""
}

/** Write a setting. Passing undefined/empty-on-purpose still stores it. */
export function setSetting(key, value) {
    store.set(key, String(value ?? ""))
    return setting(key)
}

/** Drop an override so the shipped default applies again. */
export function resetSetting(key) { store.delete(key) }

/** Every override currently in force, for the raw editor. */
export function overrides() { return { ...store.data } }

/** Replace the whole override table at once (the raw JSON editor). */
export function replaceOverrides(obj) { store.replace(obj) }


/**
 * Render the rank tag — "§8[§cAdmin§8]" by default — from the live settings.
 * @param {{display: string}|undefined} rank
 */
export function renderTag(rank) {
    if (!rank) return setting("format.noRankTag")
    return setting("format.tag")
        .replaceAll("{OPEN}", setting("bracket.open"))
        .replaceAll("{CLOSE}", setting("bracket.close"))
        .replaceAll("{RANK}", rank.display)
}

/** Apply a format string. `\n` in a stored value becomes a real line break. */
export function render(key, tokens) {
    let out = setting(key).replaceAll("\\n", "\n")
    for (const [token, value] of Object.entries(tokens)) {
        out = out.replaceAll(`{${token}}`, value ?? "")
    }
    return out
}

/** Read a setting as a boolean. Anything but "false"/"0"/"off"/"no" is true. */
export function flag(key) {
    const raw = String(setting(key) ?? "").trim().toLowerCase()
    return !["false", "0", "off", "no", ""].includes(raw)
}

/** Whether nametag rendering is on at all (still a compile-time switch). */
export function nameTagsEnabled() { return CONFIG.ranks.showOnNameTag }
