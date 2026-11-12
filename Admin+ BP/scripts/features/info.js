import { menu } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { command } from "../core/registry.js"
import { has, primaryRank, isStaff, whereToGrant } from "../core/ranks.js"
import { registeredCommands } from "../core/registry.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { ADMINPLUS_VERSION } from "../config.js"

// /info — what this thing is, for somebody who has never used a mod.
//
// The panel already explains itself to people who know what they are looking
// at. This is for the ten-year-old who joined a realm, saw a coloured tag next
// to their name and typed /info to find out what was going on.
//
// Three rules for every line in here:
//
//   SAY WHAT IT DOES, NOT WHAT IT IS. Not "a permission node gating the
//   teleport subsystem" — "lets you go to people".
//   SHOW, DO NOT DESCRIBE. Every command comes with a real example that works
//   if you type it.
//   ONLY WHAT THEY CAN USE. A member reading a list of staff commands learns
//   nothing except that the mod is not for them. What staff can do gets one
//   line saying it exists, and the detail appears when they can actually use it.
//
// The topics are separate screens rather than one long wall, because a wall is
// what people close.

/** A line per command, only if they can run it. */
function lines(player, rows) {
    return rows
        .filter(row => !row.need || has(player, row.need))
        .filter(row => !row.on || flag(row.on))
        .map(row => `§f${row.cmd}\n§7  ${row.what}`)
}

const BASICS = [
    { cmd: "/info", what: "Shows this help." },
    { cmd: "/online", what: "See who else is playing right now.", need: "online.use" },
    { cmd: "/spawn", what: "Go back to the world's starting point.", need: "spawn.use", on: "feature.spawn" },
    { cmd: "/warp", what: "A list of places the staff set up. Tap one to go there.", need: "warp.use", on: "feature.warps" },
    { cmd: "/home", what: "Your own saved places. Opens a screen to go to one, or set one where you stand. Only you can see them.", on: "feature.homes" },
    { cmd: "/back", what: "Go back to where you were before a teleport, or where you died.", on: "feature.back" },
    { cmd: "/rtp", what: "Go to a random place far away. Set a home first so you can get back.", on: "feature.rtp" },
    { cmd: "/tpa Steve", what: "Ask Steve if you can teleport to them. They say yes or no.", need: "tpa.use", on: "feature.tpa" },
    { cmd: "/tpahere Steve", what: "Ask Steve to come to you instead.", need: "tpa.use", on: "feature.tpa" },
    { cmd: "/pm Steve hello", what: "Send Steve a private message only they can see.", on: "feature.pm" },
    { cmd: "/r hi back", what: "Reply to whoever messaged you last.", on: "feature.pm" },
    { cmd: "/report Steve griefing", what: "Tell staff about a player. They see it right away.", need: "report.use", on: "feature.reports" },
    { cmd: "/warnings", what: "See if you have any warnings on your record." },
    { cmd: "/emote waves", what: "Say what you are doing: \"§oSteve waves§r\".", on: "feature.emote" }
]

async function infoScreen(player, back = () => {}) {
    const rank = primaryRank(player)
    const again = () => infoScreen(player, back)
    return menu(player, {
        title: hubTitle("about", "Help"),
        body: [
            `§7You are §r${displayName(player)}§7.`,
            rank ? `§7Your rank is ${rank.display}§r§7.` : "§7You do not have a rank yet.",
            "",
            "§7This world runs §l§bAdmin§d+§r§7, which adds ranks,",
            "§7teleports, private messages and tools for staff.",
            "",
            "§8Tap something to learn about it."
        ].join("\n"),
        buttons: [
            { text: "§bCommands you can use\n§8The ones that work for you right now", run: () => commandsScreen(player, again) },
            { text: "§bWhat a rank is\n§8Why some people have coloured names", run: () => ranksScreen(player, again) },
            { text: "§bChat\n§8Chat rooms, private messages and mutes", run: () => chatScreen(player, again) },
            isStaff(player)
                ? { text: "§6Staff tools\n§8What your staff tools do", run: () => staffScreen(player, again) }
                : { text: "§8What the staff can do\n§8So you know what to expect", run: () => aboutStaffScreen(player, again) },
            { text: "§8About Admin+\n§8Version and who made it", run: () => aboutScreen(player, again) }
        ],
        back
    })
}

async function commandsScreen(player, back) {
    const usable = lines(player, BASICS)
    return menu(player, {
        title: hubTitle("about", "Commands"),
        body: [
            "§7Type these in the chat box, exactly as written.",
            "§7Swap the name for whoever you mean.",
            "§7Or leave the rest off: §f/tpa§7 on its own shows a",
            "§7list to pick from, and §f/pm§7 opens a box to type in.",
            "",
            ...usable,
            "",
            "§8Anything you type that starts with / is a command,",
            "§8and nobody else sees it."
        ].join("\n"),
        buttons: [
            { text: "§bWho a command is for\n§8The part that names a player",
              run: () => targetsScreen(player, () => commandsScreen(player, back)) }
        ],
        back
    })
}

/**
 * The `who` argument, for somebody who has never typed an `@` in their life.
 *
 * This screen exists because of a playtest report about `/eff` (one of the
 * vanilla wrappers removed in 2.8.2; /gm and its siblings use it now): the game shows
 * `<targets_or_me: string>` and offers no list, so the box may as well be
 * blank. The engine USED to offer `@a @e @p @r @s` as you typed, and cannot any
 * more — it expands selectors at the command's permission level and refuses
 * every one of them at `Any`, which is where this pack registers so that people
 * without operator can use it at all. See core/selector.js.
 *
 * So the words came first and this explains the words. Ordered by who needs it:
 * `me` is what gets somebody unstuck, and the `@` forms sit at the bottom for
 * the person who already knew them.
 */
async function targetsScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "Who"),
        body: [
            "§7Some commands want to know §fwho§7, like §f/gmc§7. It is the",
            "§7first thing you type after the command. Any of these work:",
            "",
            "§fme",
            "§7  You. §8/gmc me",
            "§fa player's name",
            "§7  That player. Their display name works too.",
            "§8  /gmc Steve",
            "§feveryone",
            "§7  Every player here. §8/gms everyone",
            "§fnearest",
            "§7  Whoever is standing closest to you.",
            "§frandom",
            "§7  One player, picked at random.",
            "",
            "§8If you already know Minecraft selectors, @s @a @p @r",
            "§8all work too, with filters: @a[r=10]."
        ].join("\n"),
        buttons: [],
        back
    })
}

async function ranksScreen(player, back) {
    const rank = primaryRank(player)
    return menu(player, {
        title: hubTitle("about", "Ranks"),
        body: [
            "§7A rank is a label the owner gives you. It shows up",
            "§7next to your name in chat, like this:",
            "",
            `§8  ${rank?.display ?? "§7[Member]"}§r §fSteve§7: hi everyone`,
            "",
            "§7Ranks do two things:",
            "",
            "§f1. They show who is who.",
            "§7   Staff have a rank so you can tell who to ask for help.",
            "",
            "§f2. They decide what you can do.",
            "§7   Higher ranks can use more commands. When something",
            "§7   says you don't have permission, it isn't broken.",
            "§7   It needs a higher rank.",
            "",
            "§7Staff give out ranks. Asking politely works",
            "§7better than asking a lot."
        ].join("\n"),
        buttons: [],
        back
    })
}

async function chatScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "Chat"),
        body: [
            "§7Everything you type without a §f/§7 goes to chat.",
            "",
            "§fPrivate messages",
            "§7  §f/pm Steve hello§7 goes only to Steve.",
            "§7  §f/r§7 replies to whoever messaged you last.",
            "§7  Staff can read private messages. Do not use them",
            "§7  for anything you would not say out loud.",
            "",
            "§fChannels",
            "§7  Some worlds have more than one chat. The name at",
            "§7  the start of a line tells you which one it went to.",
            "",
            "§fBeing muted",
            "§7  If you are muted you can still see chat, but nothing",
            "§7  you type is sent. It will tell you how long is left,",
            "§7  and tell you again when it ends.",
            "",
            "§7Spamming the same thing over and over will mute you",
            "§7automatically. Typing fast only gets you a warning."
        ].join("\n"),
        buttons: [],
        back
    })
}

async function aboutStaffScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "The staff"),
        body: [
            "§7Staff are players the owner trusts with extra tools.",
            "",
            "§7They can:",
            "§8 · see who is online and where",
            "§8 · read chat back, including private messages",
            "§8 · teleport to people",
            "§8 · warn, mute, kick or ban players",
            "§8 · look in your inventory",
            "",
            "§7They can't do any of that to someone ranked above",
            "§7them. A moderator can't ban an owner.",
            "",
            "§7If a staff member is misusing this, report it:",
            "§f  /report <their name> §7and pick §fStaff abuse§7.",
            "§7Only people above them will see that report."
        ].join("\n"),
        buttons: [],
        back
    })
}

async function staffScreen(player, back) {
    const rows = [
        { cmd: "/admin", what: "The panel, with almost every staff tool.", need: "admin.panel" },
        { cmd: "/mm", what: "Staff mode: you get your tools and go invisible.", need: "admin.staffmode" },
        { cmd: "/items", what: "The admin item chest. A locked item says what it needs.", },
        { cmd: "/vanish", what: "Disappear. Nobody sees you or your armour.", need: "admin.vanish" },
        { cmd: "/warn Steve", what: "Put a warning on their record. By default it expires after 48 hours.", need: "admin.warn" },
        { cmd: "/mute Steve 10m", what: "Stop them talking for ten minutes.", need: "admin.mute" },
        { cmd: "/kick Steve", what: "Remove them from the world. They can come back.", need: "admin.kick" },
        { cmd: "/ban Steve", what: "Remove them until someone unbans them.", need: "admin.ban" },
        { cmd: "/gm creative", what: "Change your game mode, or another player's.", need: "admin.gamemode" },
        { cmd: "/port", what: "Gives you the Ender Eye. Use it to jump to a player.", need: "admin.tp" },
        { cmd: "/smite Steve", what: "Strikes them with lightning. It is logged.", need: "admin.smite" }
    ]
    return menu(player, {
        title: hubTitle("about", "Staff tools"),
        body: [
            "§7These are the ones your rank can use.",
            "",
            ...lines(player, rows),
            "",
            "§fThe rule that matters",
            "§7  You can't use any of this on someone ranked above",
            "§7  you. It tells you when that is why.",
            "",
            "§7Everything you do is written to the log with your name",
            `§7on it. §f/admin §7▸ Logs.`
        ].join("\n"),
        buttons: [],
        back
    })
}

async function aboutScreen(player, back) {
    return menu(player, {
        title: hubTitle("about", "About"),
        body: [
            `§l§bAdmin§d+§r §8v${ADMINPLUS_VERSION}`,
            "",
            `§7${registeredCommands().length} commands in Admin+.`,
            "",
            "§7Made by §dFireliteZGaming§7.",
            "§7Free, and it will stay free.",
            "",
            "§8Type /credits to see whose ideas are used here."
        ].join("\n"),
        buttons: [],
        back
    })
}

command({
    name: "info",
    description: "Learn what you can do on this server",
    run: (player) => infoScreen(player)
})

export { infoScreen, BASICS, lines }
