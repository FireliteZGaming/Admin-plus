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
        label: "Opening bracket",
        help: "Goes around the rank name in {TAG}, for every rank."
    },
    "bracket.close": {
        value: "§8]",
        label: "Closing bracket",
        help: "Goes around the rank name in {TAG}, for every rank."
    },
    "format.tag": {
        value: "{OPEN}{RANK}{CLOSE}",
        label: "Rank tag",
        help: "Tokens: {OPEN} {CLOSE} {RANK} · how one tag looks. A player with several ranks gets one tag for each."
    },
    "format.tagJoin": {
        value: " ",
        label: "Between rank tags",
        help: "What goes between two tags when a player has more than one. A space by default. \", \" also works, and \"\" puts them side by side."
    },
    "format.tagCount": {
        value: "3",
        label: "How many rank tags show",
        help: "{TAG} shows every rank a player has: staff ranks first, then the order you set. 1 shows only the top one. 0 shows them all."
    },
    "format.nameTag": {
        // Tag BESIDE the name, on one line — the way Essentials shows it.
        // Put \\n back in (via < Code >) to stack it above instead.
        value: "{TAG} §f{NICKNAME}",
        label: "Nametag (above head)",
        help: "Tokens: {TAG} {RANK} {NAME} {NICKNAME} · {NAME} is the gamertag, {NICKNAME} is their display name · \\n puts the tag on its own line above the name"
    },
    "format.chat": {
        value: "{TAG} §7{NICKNAME} §8» §r{MSG}",
        label: "Chat line",
        help: "Tokens: {TAG} {RANK} {NAME} {NICKNAME} {MSG} · {NAME} is the gamertag, {NICKNAME} is their display name · needs Beta APIs on"
    },
    "format.chatChannel": {
        value: "{CHANNEL} §8|§r {TAG} {NICKNAME}§7: §r{MSG}",
        label: "Chat line (players reading several rooms)",
        help: "Tokens: {CHANNEL} {TAG} {RANK} {NAME} {NICKNAME} {MSG} · used for players who can read more than one chat room"
    },
    "presence.announce": {
        value: "true",
        label: "Join and leave lines",
        help: "true / false · Admin+ shows them, and the resource pack hides the game's own"
    },
    "format.join": {
        value: "§e{NICKNAME} joined the game",
        label: "Join line",
        help: "Tokens: {NAME} {NICKNAME} · matches the game's own wording and colour"
    },
    "format.leave": {
        value: "§e{NICKNAME} left the game",
        label: "Leave line",
        help: "Tokens: {NAME} {NICKNAME} · /vanish shows this too, so vanishing looks like leaving"
    },
    "presence.greet": {
        value: "true",
        label: "Tell new players about /info",
        help: "true / false · one line, a few seconds after they join, that only they see"
    },
    "format.greeting": {
        value: "§7Welcome, {NICKNAME}§7. Type §f/info§7 to see what you can do here.",
        label: "Greeting line",
        help: "Tokens: {NAME} {NICKNAME} · only that player sees it · leave it empty to send nothing"
    },
    "vanish.hideFromLists": {
        value: "true",
        label: "Vanished players hidden from /online",
        help: "true / false · staff still see them, marked. The game's own player list in the pause menu can't be changed, so this covers Admin+'s lists only."
    },
    "vanish.nightVision": {
        value: "true", label: "Vanish gives night vision", help: "true / false · helps when watching someone in a dark cave"
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
        value: "false", label: "Lag clear: falling blocks", help: "true / false · off by default, because clearing a falling block can break a machine"
    },
    "cleanup.warn": {
        value: "5", label: "Lag clear: warning seconds", help: "Countdown before clearing · 0 clears at once"
    },
    "cleanup.keep": {
        value: "", label: "Lag clear: protected items", help: "Comma separated, part of a name is enough · empty uses the built-in list of valuables"
    },
    "automod.ores": {
        value: "true", label: "Automod: ore alerts", help: "true / false · finds are grouped and reported when the player stops mining"
    },
    "automod.veinRadius": {
        value: "5", label: "Automod: vein radius (blocks)", help: "How far apart two ore blocks can be and still count as one find"
    },
    "automod.veinIdle": {
        value: "8", label: "Automod: vein close delay (seconds)", help: "After this many seconds with no new find, the vein is reported"
    },
    "automod.oreThresholds": {
        value: "", label: "Automod: watched ores", help: "ore:vein size pairs, for example diamond_ore:3, ancient_debris:2 · empty uses the defaults"
    },
    "automod.breaks": {
        value: "true", label: "Automod: break rate", help: "true / false · flags impossible mining speed"
    },
    "automod.breakRate": {
        value: "20", label: "Automod: blocks a second", help: "Keep this high: TNT and Efficiency V break blocks fast without cheating"
    },
    "automod.spam": {
        value: "true", label: "Automod: chat flooding", help: "true / false · on hold for now, so this does nothing"
    },
    "automod.spamRate": {
        value: "6", label: "Automod: typing fast", help: "messages in 10s · above this, they are told they are typing fast. No strike, and nothing is recorded."
    },
    "automod.spamHard": {
        value: "10", label: "Automod: spamming", help: "messages in 10s · above this is a strike, and each strike is punished harder. Always at least one more than typing fast."
    },
    "automod.spamLadder": {
        value: "0, 60, 300, 600",
        label: "Automod: spam punishment",
        help: "seconds of mute for each strike, in order · 0 is a warning only. The last value repeats for every strike after it."
    },
    "warnings.expire": {
        value: "48",
        label: "Warnings expire after",
        help: "hours · an ordinary warning stops counting after this. Severe ones never expire. 0 keeps every warning forever."
    },
    "automod.spamForget": {
        value: "30", label: "Automod: forget strikes after", help: "minutes · after this long with no strike, strikes go back to zero"
    },

    // Feature switches — what exists on this server at all. A feature turned
    // off here takes its commands with it, rather than leaving them to fail.
    "feature.warps": {
        value: "true", label: "Warps", help: "true / false · /warp and /warps"
    },
    "feature.back": {
        value: "true", label: "Go back",
        help: "true / false · /back takes a player to where they were before a teleport, or where they died"
    },
    "feature.rtp": {
        value: "true", label: "Random teleport", help: "true / false · /rtp"
    },
    "feature.namecolour": {
        value: "true", label: "Name colours",
        help: "true / false · lets a rank colour its players' names, with one colour or a moving effect · set it in Ranks ▸ a rank ▸ Basics"
    },
    "creator.identity": {
        value: "true", label: "Creator's own name",
        help: "true / false · shows the Admin+ creator's chosen name and colours, unless they set a display name · affects one gamertag only"
    },
    "namecolour.speed": {
        value: "3",
        label: "Name effect speed",
        help: "Game ticks between steps (20 a second). Smaller is faster: 1 is very fast, 3 is smooth, 10 is slow."
    },
    "rtp.range": {
        value: "4000",
        label: "Random teleport: how far",
        help: "blocks · the farthest /rtp sends a player from where they stand"
    },
    "rtp.minimum": {
        value: "256",
        label: "Random teleport: how near",
        help: "blocks · the nearest /rtp sends a player, so it never drops them back near spawn"
    },
    "rtp.tries": {
        value: "24",
        label: "Random teleport: attempts",
        help: "How many spots to try before giving up. The limit stops an ocean world from searching forever."
    },
    "feature.claims": {
        value: "false", label: "Land claims",
        help: "true / false · /claim, /unclaim, /trust. Off by default, because it changes who can break blocks. Set how many and how big for each rank in Ranks ▸ a rank ▸ Permissions ▸ Member ▸ Limits."
    },
    // World tools (2.9.0): /wts and the Omnitool. Settings ▸ Omnitool ▸ General.
    "feature.worldtools": {
        value: "true", label: "World tools",
        help: "true / false · /wts and the Omnitool. Who can use the Omnitool is set per rank (Staff tools ▸ Omnitool)."
    },
    "omni.spawn": {
        value: "false", label: "Spawn through the Omnitool",
        help: "true / false · spawn is an area made with the Omnitool. Off deletes it and puts simple spawn (a point and a radius) back exactly as it was."
    },
    "omni.outlineEveryone": {
        value: "false", label: "Everyone sees the outline",
        help: "true / false · off shows the Omnitool's outline only to the person using it"
    },
    "omni.idleMinutes": {
        value: "10", label: "Minutes before an idle selection clears",
        help: "minutes · an Omnitool selection clears when its owner leaves, or doesn't move or use the stick for this long"
    },
    "feature.homes": {
        // OFF, like land claims. Both hand players a new thing to own, and a
        // world should decide to switch that on rather than find it already
        // running after an update.
        value: "false", label: "Homes",
        help: "true / false · /home opens a screen to go to a home or set one. Set how many for each rank in Ranks ▸ a rank ▸ Permissions ▸ Member ▸ Limits."
    },
    "feature.spawn": {
        value: "true", label: "Spawn", help: "true / false · /spawn"
    },
    "feature.tpa": {
        value: "true", label: "Teleport requests", help: "true / false · /tpa, /tpahere, /tpaccept, /tpadeny and /tpacancel"
    },
    "feature.enderchest": {
        // Ships OFF while the screen is still settling. A world that wants it
        // turns it on; nobody inherits a half-finished feature in an update.
        value: "false", label: "Ender chest", help: "true / false · /ec, and /enderchest <player> for staff"
    },
    "logs.chat": {
        value: "true",
        label: "Keep a chat log",
        help: "true / false · records public chat so staff can read it back. Private messages are never recorded."
    },
    // Chat screening. Levels are 0 off · 1 whole words · 2 + leet and stutter
    // (`sh1t`, `fuuuck`) · 3 anywhere in the message, which also finds words
    // inside innocent ones. See core/chatfilter.js.
    "filter.enabled": {
        value: "true",
        label: "Screen chat before it posts",
        help: "true / false · holds a flagged message for staff to check. The setting below decides whether the sender is also warned or muted. On hold for now, so this does nothing."
    },
    "filter.discrimination": {
        value: "2",
        label: "Screen: discrimination",
        help: "0 off · 1 whole words · 2 also catches sh1t and fuuuck · 3 anywhere, with more mistakes. Starts with no words: add your own below."
    },
    "filter.sexual": {
        value: "2", label: "Screen: sexual content", help: "0-3, as above"
    },
    "filter.aggression": {
        value: "2", label: "Screen: hostility and threats", help: "0-3, as above · already catches kys and go die"
    },
    "filter.profanity": {
        value: "0",
        label: "Screen: ordinary swearing",
        help: "0-3 · off by default, because most servers don't want every swear word held"
    },
    "filter.terms.discrimination": {
        value: "",
        label: "Terms: discrimination",
        help: "Comma separated. Starts empty on purpose: which slurs to block depends on your community and language, so Admin+ leaves it to you. Nothing is caught until you add words."
    },
    "filter.terms.sexual": {
        value: "", label: "Terms: sexual content", help: "Comma separated · added to the built-in list"
    },
    "filter.terms.aggression": {
        value: "", label: "Terms: hostility", help: "Comma separated · added to the built-in list"
    },
    "filter.terms.profanity": {
        value: "", label: "Terms: swearing", help: "Comma separated · added to the built-in list"
    },
    "filter.allow": {
        value: "class, classic, assassin, bass, pass, grass, assess, scunthorpe, cocktail, shiitake",
        label: "Never flag these words",
        help: "Comma separated · harmless words that contain a flagged one. Only used at level 3, which looks inside words."
    },
    "filter.staffBypass": {
        value: "true",
        label: "Staff skip the screen",
        help: "true / false · staff messages are not screened. Off screens staff like everyone else."
    },
    "filter.action": {
        value: "hold",
        label: "What a flagged message costs",
        help: "hold / warn / mute · the message is always held for staff to check, so a mistake can be undone. Warn and mute also punish the sender."
    },
    "filter.muteSeconds": {
        value: "300", label: "Filter mute length", help: "seconds · only used when the setting above is 'mute'"
    },
    "filter.holdCap": {
        value: "50",
        label: "Held messages kept",
        help: "How many held messages to keep. The oldest go first."
    },
    "logs.commandBlocks": {
        value: "true",
        label: "Log command blocks placed and broken",
        help: "true / false · logs who placed or broke a command block, and where. The command inside can't be read, because the game doesn't let addons see it."
    },
    "logs.signs": {
        value: "true",
        label: "Log what is written on signs",
        help: "true / false · records what players write on signs, which nothing else logs"
    },
    "logs.chatCap": {
        value: "200",
        label: "Chat lines kept",
        help: "How many chat lines to keep. The oldest go first. Separate from the action log."
    },
    "logs.commands": {
        value: "true",
        label: "Keep a command log",
        help: "true / false · records every command typed, even refused ones. Kept apart from the action log."
    },
    "logs.commandCap": {
        value: "300",
        label: "Command lines kept",
        help: "How many commands to keep. The oldest go first."
    },
    "feature.reports": {
        value: "true", label: "Reports", help: "true / false · /report and the reports list in the panel"
    },
    "feature.chat": {
        value: "true", label: "Chat rooms", help: "true / false · off means one plain chat for everyone"
    },
    // The four switches for a server that runs another mod alongside this one,
    // asked for on 2026-11-11: "if people don't want ranks or chat at all for
    // any reason like mods or other reasons, they can".
    "feature.adminchat": {
        value: "true", label: "Admin+ chat",
        help: "true / false · off: Admin+ leaves chat to the game or another mod. No chat rooms, tags or filter in chat. Mutes still work, and chat is still logged"
    },
    "feature.ranktags": {
        value: "true", label: "Rank tags",
        help: "true / false · off: no rank tags in chat or above heads. Ranks still decide what people can use"
    },
    "feature.nametags": {
        value: "true", label: "Names above heads",
        help: "true / false · off: Admin+ never changes the name above a player's head, so another mod can"
    },
    "feature.tags": {
        value: "true", label: "Cosmetic ranks",
        help: "true / false · show the tags of cosmetic ranks: ranks that only change how a name looks, with no place in the rank order and no permissions"
    },
    "creator.console": {
        value: "true",
        label: "Creator & Dev console",
        help: "true / false · lets the Admin+ creator and anyone with the Dev tag open a console in /menu. It runs Admin+ commands only, with what their rank allows, and every use is logged. On by default."
    },
    "troll.smiteFire": {
        value: "true",
        label: "Smite sets fires",
        help: "true / false · true spawns a real lightning bolt, which can start fires. false gives the flash and the damage only."
    },
    "items.eyeRange": {
        value: "160",
        label: "Ender eye range",
        help: "How far the Ender Eye looks for a place to land, in blocks. Past this, it says nothing is in range."
    },
    "items.knockback": {
        value: "12",
        label: "Knockback stick force",
        help: "How far the stick knocks a player sideways. 4 is gentle and 12 is strong. Very high values can throw a player into unloaded chunks."
    },
    "items.knockbackLift": {
        value: "1",
        label: "Knockback stick lift",
        help: "How much of the throw goes upward. Higher sends them up rather than away."
    },
    "ban.allowPermanent": {
        value: "true",
        label: "Permanent bans",
        help: "true / false · off limits every ban to 7 days at most"
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
        help: "Seconds to stand still before a teleport · 0 for none · staff skip it"
    },
    "teleport.cancelOnMove": {
        value: "true",
        label: "Moving cancels a teleport",
        help: "true / false · stops players teleporting out of a fight"
    },
    "teleport.cooldown": {
        value: "3",
        label: "Default teleport cooldown (seconds)",
        help: "Used when a rank sets no cooldown of its own · staff are exempt unless that is turned off"
    },
    "tpa.expire": {
        value: "60",
        label: "TPA request expiry (seconds)",
        help: "How long a teleport request lasts before it expires"
    },
    "ranks.permissionEditor": {
        value: "toggle",
        label: "Rank permission editor",
        help: "toggle / dropdown · dropdown gives Default, Allow and Deny for each permission"
    },
    "staff.exemptCooldowns": {
        value: "true",
        label: "Staff ignore cooldowns",
        help: "true / false · staff don't wait between warps, spawn and TPA"
    },
    "format.noRankTag": {
        value: "",
        label: "Rank tag when they have no rank",
        help: "Leave empty to show nothing."
    },
    "format.command": {
        value: "§o§7[{NICKNAME}: {ACTION}]",
        label: "Staff action line",
        help: "Tokens: {NAME} {NICKNAME} {ACTION} {TARGET} {DETAIL} · shown in chat to staff who outrank the target. {ACTION} is the whole sentence, for example Banned Steve."
    },
    "audit.announce": {
        value: "true",
        label: "Announce staff actions in chat",
        help: "true / false · only staff who outrank the target see it, never the target. Sudo is shown only to staff who can use it."
    },
    "invsee.iconOffset": {
        value: "0",
        label: "/invsee icon nudge",
        help: "Whole number · change this only if every icon is off by the same number of places. If they are N places too far right, set -N."
    },
    "invsee.chestUI": {
        value: "true",
        label: "/invsee shows a chest grid",
        help: "true / false · shows items in a chest grid, which needs the resource pack. false shows a plain list instead."
    },
    "format.emote": {
        value: "§d* {NICKNAME} §r§d§o{MSG}",
        label: "Emote line",
        help: "Tokens: {NAME} {NICKNAME} {MSG} {CHANNEL} · what /emote prints"
    },
    "feature.emote": {
        value: "true",
        label: "Emotes (/emote)",
        help: "true / false · lets players describe an action instead of saying something"
    },
    "format.pmOut": {
        value: "§8[§dyou §8» §d{NICKNAME}§8] §7{MSG}",
        label: "Private message you sent",
        help: "Tokens: {NAME} {NICKNAME} {MSG} · {NAME} is who you sent it to"
    },
    "format.pmIn": {
        value: "§8[§d{NICKNAME} §8» §dyou§8] §7{MSG}",
        label: "Private message you received",
        help: "Tokens: {NAME} {NICKNAME} {MSG} · {NAME} is who sent it"
    },
    "format.prchat": {
        // Same shape as format.chatChannel: who the room is, then who spoke.
        // {PAIR} names BOTH people, so a line scrolling past says which
        // conversation it belongs to — the same job the channel label does.
        value: "§8[§5{PAIR}§8]§r {TAG} {NICKNAME}§7: §r{MSG}",
        label: "Private chat session line",
        help: "Tokens: {PAIR} {TAG} {RANK} {NAME} {NICKNAME} {MSG} · {PAIR} is both names, {NAME} is whoever spoke"
    },
    "format.spy": {
        value: "§8[spy · {KIND}] §7{FROM} §8» §7{TO}§8: {MSG}",
        label: "Social spy line",
        help: "Tokens: {FROM} {TO} {MSG} {KIND} · only staff with Social spy turned on see this"
    },
    "feature.pm": {
        value: "true",
        label: "Private messages",
        help: "true / false · /pm, /r and /prchat"
    },
    "format.broadcast": {
        value: "§8[§c§lBroadcast§r§8]§r §e{MSG}",
        label: "Broadcast line",
        help: "Tokens: {MSG} {NAME} {NICKNAME} {CHANNEL} · {NAME} is whoever sent it"
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
    // **A rank with no name renders NOTHING, not empty brackets.**
    //
    // Reported from CurseForge: somebody clearing the rank names to switch the
    // prefixes off was left with `§8[]` in dark grey on every line, and no way
    // to get rid of it — because the brackets are decoration around a name, and
    // the code drew them whether or not there was a name to decorate.
    //
    // Blanking the name is a reasonable way to ask for no tag, so it now means
    // that. `format.tag` is still there for anybody who wants a different shape
    // entirely.
    const display = String(rank.display ?? "")
    if (!stripFormatting(display).trim()) return ""
    return setting("format.tag")
        .replaceAll("{OPEN}", setting("bracket.open"))
        .replaceAll("{CLOSE}", setting("bracket.close"))
        .replaceAll("{RANK}", display)
}

/** A string with its § codes taken out, for asking whether it says anything. */
function stripFormatting(text) {
    return String(text ?? "").replace(/§./g, "")
}

/**
 * The formatting in force at `index` of a template: every code since the last
 * `§r`, in order.
 *
 * A COLOUR clears styles and a style stacks on the colour, which is Minecraft's
 * own rule — so `§e§l` prevails as both, while `§e§c` prevails as just `§c`.
 */
function prevailing(template, index) {
    const out = []
    for (const code of template.slice(0, index).match(/§./g) ?? []) {
        const c = code[1].toLowerCase()
        if (c === "r") { out.length = 0; continue }
        if (/[0-9a-f]/.test(c)) out.length = 0
        out.push(code)
    }
    return out.join("")
}

/**
 * Apply a format string. `\n` in a stored value becomes a real line break.
 *
 * **A styled value must not repaint the rest of the line, and must not wipe it
 * either.** identity.js ends a styled name with `§r` so a nickname's colour
 * cannot escape into the words after it. That was right, and it was too blunt:
 * `§r` resets to WHITE, so `§e{NICKNAME} left the game` rendered the name in
 * its own colour and then everything after it in white — reported from a world
 * as the leave line losing its yellow.
 *
 * A reset is the wrong tool because it restores the DEFAULT rather than what
 * the template had. So every substituted value that carries formatting is
 * followed by the formatting the template itself was in at that point. Where
 * the template had nothing, that is the empty string and the `§r` stands, which
 * is the old behaviour for uncoloured templates.
 */
export function render(key, tokens) {
    let out = setting(key).replaceAll("\\n", "\n")

    // An EMPTY token takes the gap around it with it.
    //
    // Same report as renderTag above: with the tag blanked, `{TAG} {NICKNAME}`
    // left a stray space and the line began adrift. Marking the empty ones and
    // collapsing afterwards keeps that tidying away from the MESSAGE, which is
    // somebody's own text and must survive exactly as typed — "hello    there"
    // stays "hello    there".
    const GAP = "\u0000"
    for (const [token, value] of Object.entries(tokens)) {
        const text = String(value ?? "")
        const empty = !stripFormatting(text).trim()
        // One at a time rather than replaceAll, because what goes in depends on
        // WHERE it goes: the formatting to restore afterwards is whatever the
        // template was in at that spot.
        for (;;) {
            const at = out.indexOf(`{${token}}`)
            if (at < 0) break
            // identity.js already closes a styled name with §r; don't add a
            // second one just to put the template's colour back after it.
            const closed = text.endsWith("§r") ? text : `${text}§r`
            const piece = empty
                ? GAP
                : (text.includes("§") ? `${closed}${prevailing(out, at)}` : text)
            out = out.slice(0, at) + piece + out.slice(at + token.length + 2)
        }
    }
    out = out.replace(new RegExp(`[ \t]*${GAP}[ \t]*`, "g"), " ")
    // A line that is now only separators and spaces had nothing in it to begin
    // Trim only. A global space-collapse was tried here and was WRONG: it ran
    // over the MESSAGE too, so "hello     there" arrived as "hello there".
    // Somebody's own text survives exactly as typed; only the gaps left by
    // empty tokens close, and the sentinel above already closed those.
    return out.trim()
}

/** Read a setting as a boolean. Anything but "false"/"0"/"off"/"no" is true. */
export function flag(key) {
    const raw = String(setting(key) ?? "").trim().toLowerCase()
    return !["false", "0", "off", "no", ""].includes(raw)
}

/**
 * Whether Admin+ may write the name above a player's head at all: the
 * compile-time switch, and the "Names above heads" switch in Server ▸ Settings
 * for a server where another mod draws nametags.
 */
export function nameTagsEnabled() { return CONFIG.ranks.showOnNameTag && flag("feature.nametags") }
