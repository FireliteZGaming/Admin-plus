import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { command } from "../core/registry.js"
import { has, primaryRank, isStaff, whereToGrant } from "../core/ranks.js"
import { registeredCommands, commandSpecs } from "../core/registry.js"
import { specFor, runPackCommand } from "../core/dispatch.js"
import { err } from "../core/util.js"
import { flag } from "../core/settings.js"
import { CHAT_AUTOMOD_ON_HOLD } from "../core/hold.js"
import { displayName } from "../core/identity.js"
import { ADMINPLUS_VERSION } from "../config.js"
import { menusName } from "../core/channel.js"

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

/** A line per command, only if they can run it. The staff guide still uses it. */
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
]

// ------------------------------------------------------------- the help, 2.12.13
//
// The user, 2026-11-18: "make help way 100% better". Help used to be pages of
// text to read. Now it can be ASKED: search it by what you want to do, browse
// it by topic, and open a page per command with real examples and, when the
// command needs nothing typed after it, a button that does it for you.
//
// The pages below say what each command is for in a player's words. The LIST
// comes from the commands themselves (core/registry.js): a command added later
// appears under "More commands" before anybody writes its page, a page for a
// command that does not exist is never shown, and only commands this player
// can run are offered at all.

const TOPICS = [
    { id: "travel", label: "Transportation", hint: "Spawn, warps, homes, teleports" },
    { id: "talk", label: "Communication", hint: "Messages, chat rooms, reports and warnings" },
    { id: "you", label: "Your things", hint: "Your menu, settings and items" },
    { id: "staff", label: "Staff tools", hint: "What your staff tools do" },
    { id: "more", label: "More commands", hint: "Everything else you can use" }
]

/** Pages written by hand. `cmd` is the command's own name; `words` help the search find it. */
const PAGES = [
    { cmd: "spawn", topic: "travel", what: "Go back to the world's starting point.", how: ["/spawn"], words: "start beginning hub", on: "feature.spawn" },
    { cmd: "warp", topic: "travel", what: "Go to a place the staff set up. Leave the name off to see the list.", how: ["/warp", "/warp shop"], words: "places shop hub", on: "feature.warps" },
    { cmd: "home", topic: "travel", what: "Your own saved places. Go to one, or save where you stand. Only you can see them.", how: ["/home"], words: "house base bed save sethome", on: "feature.homes" },
    { cmd: "back", topic: "travel", what: "Go back to where you were before a teleport, or where you died.", how: ["/back"], words: "died death return undo", on: "feature.back" },
    { cmd: "rtp", topic: "travel", what: "Go to a random place far away. Set a home first so you can get back.", how: ["/rtp"], words: "random wild explore wilderness", on: "feature.rtp" },
    { cmd: "tpa", topic: "travel", what: "Ask a player if you can teleport to them. It pops up on their screen so they can accept or refuse.", how: ["/tpa Steve"], words: "teleport go friend visit join", on: "feature.tpa" },
    { cmd: "tpahere", topic: "travel", what: "Ask a player to teleport to you.", how: ["/tpahere Steve"], words: "teleport bring summon come here", on: "feature.tpa" },
    { cmd: "tpaccept", topic: "travel", what: "Say yes to a teleport request. With several waiting, it asks which.", how: ["/tpaccept", "/tpaccept Steve"], words: "teleport yes allow accept", on: "feature.tpa" },
    { cmd: "tpadeny", topic: "travel", what: "Say no to a teleport request.", how: ["/tpadeny", "/tpadeny Steve"], words: "teleport no refuse deny", on: "feature.tpa" },
    { cmd: "tpacancel", topic: "travel", what: "Take back the teleport request you sent.", how: ["/tpacancel"], words: "teleport cancel undo take back", on: "feature.tpa" },
    { cmd: "tpatoggle", topic: "travel", what: "Turn teleport requests to you off, or back on.", how: ["/tpatoggle"], words: "teleport block stop off on ignore", on: "feature.tpa" },
    { cmd: "pm", topic: "talk", what: "Send a private message only that player sees.", how: ["/pm Steve hello"], words: "message whisper dm tell private msg", on: "feature.pm" },
    { cmd: "r", topic: "talk", what: "Reply to whoever messaged you last.", how: ["/r hi back"], words: "reply answer message", on: "feature.pm" },
    { cmd: "prchat", topic: "talk", what: "Start a private two-person chat. Everything you type goes to them until you leave.", how: ["/prchat Steve"], words: "private chat conversation dm talk", on: "feature.pm", note: "Typed on its own, /prchat leaves the private chat." },
    { cmd: "praccept", topic: "talk", what: "Say yes to a private chat request.", how: ["/praccept"], words: "private chat yes accept", on: "feature.pm" },
    { cmd: "prdeny", topic: "talk", what: "Say no to a private chat request.", how: ["/prdeny"], words: "private chat no refuse", on: "feature.pm" },
    { cmd: "prexit", topic: "talk", what: "Leave the private chat you are in.", how: ["/prexit"], words: "private chat leave exit stop", on: "feature.pm" },
    { cmd: "chat", topic: "talk", what: "Pick which chat room you talk in.", how: ["/chat"], words: "room channel staff general switch" },
    { cmd: "menu", topic: "you", what: "Your own menu: travel, people, land claims, settings and help.", how: ["/menu"], words: "settings options profile personalize" },
    { cmd: "online", topic: "you", what: "See who else is playing right now.", how: ["/online"], words: "players list who" },
    { cmd: "info", topic: "you", what: "This help.", how: ["/info"], words: "help guide commands" },
    { cmd: "report", topic: "talk", what: "Tell the staff about a player. They see it right away.", how: ["/report Steve griefing"], words: "grief hack cheat abuse staff complain", on: "feature.reports" },
    { cmd: "warnings", topic: "talk", what: "See if you have any warnings on your record.", how: ["/warnings"], words: "warn record strikes" },
    { cmd: "admin", topic: "staff", what: "The panel, with almost every staff tool.", how: ["/admin"], words: "panel staff tools" },
    { cmd: "mm", topic: "staff", what: "Staff mode: you get your tools and go invisible.", how: ["/mm"], words: "staff mode moderate" },
    { cmd: "automod", topic: "staff", what: "Automod: Bot Guard (Bot Moderation, Detected Bots) and Chat Moderation.", how: ["/automod"], words: "automod bots bot guard bot detection detected bots half-joined spam ads chat moderation harassment hate speech sexual profanity swearing signs" },
    { cmd: "items", topic: "staff", what: "The admin item chest. A locked item says what it needs.", how: ["/items"], words: "tools hammer compass eye" },
    { cmd: "vanish", topic: "staff", what: "Disappear. Nobody sees you or your armour.", how: ["/vanish"], words: "invisible hide" },
    { cmd: "warn", topic: "staff", what: "Put a warning on a player's record.", how: ["/warn Steve spamming"], words: "warning strike" },
    { cmd: "mute", topic: "staff", what: "Stop a player talking for a while.", how: ["/mute Steve 10m"], words: "silence quiet" },
    { cmd: "ban", topic: "staff", what: "Remove a player until someone unbans them.", how: ["/ban Steve"], words: "remove kick" },
    { cmd: "invsee", topic: "staff", what: "Look inside a player's inventory, and take things out.", how: ["/invsee Steve"], words: "inventory items look" },
    { cmd: "broadcast", topic: "staff", what: "Send an announcement to everyone, or to one chat room.", how: ["/broadcast all Server restarting soon"], words: "announce message everyone" }
]

function topicOf(id) { return TOPICS.find(t => t.id === id) }

/** Can this player run it right now? */
function usable(player, spec) {
    return !!spec && !spec.hidden && (!spec.perm || has(player, spec.perm))
}

/** Every command this player can use: the written pages first, then the rest from the registry. */
function entriesFor(player) {
    const written = new Set(PAGES.map(page => page.cmd))
    const out = []
    for (const page of PAGES) {
        const spec = specFor(page.cmd)
        if (!usable(player, spec) || (page.on && !flag(page.on))) continue
        out.push({ ...page, spec })
    }
    const rest = commandSpecs()
        .filter(spec => !written.has(spec.name) && usable(player, spec))
        .sort((a, b) => a.name.localeCompare(b.name))
    for (const spec of rest) {
        out.push({
            cmd: spec.name,
            topic: String(spec.perm ?? "").startsWith("admin.") ? "staff" : "more",
            what: spec.description ?? "",
            how: [],
            words: "",
            spec
        })
    }
    return out
}

/** "/tpa <player>", from the command itself, so it can never go stale. */
function usageOf(spec) {
    const bare = param => String(param.name).replace(/^[a-z0-9_]+:/i, "")
    return [
        `/${spec.name}`,
        ...(spec.mandatory ?? []).map(param => `<${bare(param)}>`),
        ...(spec.optional ?? []).map(param => `[${bare(param)}]`)
    ].join(" ")
}

function entryButton(entry) {
    const what = entry.what.length > 40 ? `${entry.what.slice(0, 38).trimEnd()}...` : entry.what
    return `§f/${entry.cmd}\n§8${what || "Tap to see how it works"}`
}

function runIt(player, name) {
    const result = runPackCommand(player, name)
    if (result && !result.ok) err(player, result.reason)
}

async function infoScreen(player, back = () => {}) {
    const rank = primaryRank(player)
    const again = () => infoScreen(player, back)
    const count = entriesFor(player).length
    return menu(player, {
        title: hubTitle("about", "Help"),
        body: [
            `§7You are §r${displayName(player)}§7.`,
            rank ? `§7Your rank is ${rank.display}§r§7.` : "§7You do not have a rank yet.",
            "",
            "§7This world runs §l§bAdmin§d+§r§7: ranks, teleports,",
            "§7private messages and tools for staff.",
            "",
            `§7Search for what you want to do, or browse the §f${count}§7`,
            "§7commands you can use."
        ].join("\n"),
        buttons: [
            { text: "§bSearch\n§8Type what you want to do", run: () => searchScreen(player, again) },
            { text: "§bBrowse commands\n§8Every command you can use", run: () => topicsScreen(player, again) },
            { text: "§bHow chat works\n§8Chat rooms, private messages, mutes", run: () => chatScreen(player, again) },
            isStaff(player)
                ? { text: "§6Staff guide\n§8What your staff tools do", run: () => staffScreen(player, again) }
                : { text: "§bWhat the staff can do\n§8So you know what to expect", run: () => aboutStaffScreen(player, again) },
            { text: "§bHow ranks work\n§8Why some people have coloured names", run: () => ranksScreen(player, again) },
            { text: "§bAbout Admin+\n§8Version and who made it", run: () => aboutScreen(player, again) }
        ],
        back
    })
}

async function topicsScreen(player, back) {
    const again = () => topicsScreen(player, back)
    const all = entriesFor(player)
    return menu(player, {
        title: hubTitle("about", "Commands"),
        body: [
            "§7Pick a topic, then a command, to see how it works.",
            "§7Leave anything off when you type a command, and it",
            "§7asks you for it."
        ].join("\n"),
        buttons: [
            ...TOPICS.map(topic => ({ topic, list: all.filter(entry => entry.topic === topic.id) }))
                .filter(({ list }) => list.length)
                .map(({ topic, list }) => ({
                    text: `§b${topic.label}\n§8${list.length} · ${topic.hint}`,
                    run: () => topicScreen(player, topic, again)
                })),
            { text: "§bWho a command is for\n§8The part that names a player", run: () => targetsScreen(player, again) }
        ],
        back
    })
}

async function topicScreen(player, topic, back) {
    const again = () => topicScreen(player, topic, back)
    const list = entriesFor(player).filter(entry => entry.topic === topic.id)
    return menu(player, {
        title: hubTitle("about", topic.label),
        body: [
            `§7${topic.hint}. Tap one to see how it works.`,
            ...(topic.id === "staff" ? [
                "",
                "§7You can't use these on anyone ranked above you.",
                "§7Everything you do is logged with your name: §f/admin§7 ▸ Logs."
            ] : [])
        ].join("\n"),
        buttons: list.map(entry => ({ text: entryButton(entry), run: () => commandPage(player, entry, again) })),
        back
    })
}

async function commandPage(player, entry, back) {
    const spec = entry.spec
    const free = !(spec.mandatory ?? []).length
    return menu(player, {
        title: hubTitle("about", `/${entry.cmd}`),
        body: [
            `§f${entry.what || spec.description || ""}`,
            "",
            "§7Type it like this:",
            `§f  ${usageOf(spec)}`,
            ...(entry.how?.length ? ["", "§7For example:", ...entry.how.map(line => `§f  ${line}`)] : []),
            ...(entry.note ? ["", `§7${entry.note}`] : []),
            "",
            "§8Leave anything in < > off and it asks you for it."
        ].join("\n"),
        buttons: free ? [{ text: "§aDo it now\n§8Runs it for you", run: () => runIt(player, entry.cmd) }] : [],
        back
    })
}

async function searchScreen(player, back) {
    const values = await modal(player, hubTitle("about", "Search help"), [
        { id: "text", type: "text", label: "What do you want to do?", placeholder: "go home, message a friend, report" }
    ])
    const query = String(values?.text ?? "").trim()
    if (!query) return back()
    return resultsScreen(player, query, back)
}

/** The best matches for what was typed, by the command's name, its words and its page. */
function findCommands(player, query) {
    const words = query.toLowerCase().split(/[^a-z0-9+]+/).filter(word => word.length > 1)
    if (!words.length) return []
    return entriesFor(player)
        .map(entry => {
            const hay = `${entry.cmd} ${entry.what} ${entry.words ?? ""} ${topicOf(entry.topic)?.label ?? ""}`.toLowerCase()
            const score = words.reduce((sum, word) => sum + (entry.cmd === word.replace(/^\//, "") ? 3 : 0) + (hay.includes(word) ? 1 : 0), 0)
            return { entry, score }
        })
        .filter(found => found.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map(found => found.entry)
}

async function resultsScreen(player, query, back) {
    const again = () => resultsScreen(player, query, back)
    const found = findCommands(player, query)
    return menu(player, {
        title: hubTitle("about", "Search help"),
        body: found.length
            ? subtitle(`${found.length} found for "${query}".`)
            : [
                `§7Nothing matched "${query}".`,
                "§7Try one word, like §fhome§7, §fmessage§7 or §freport§7."
            ].join("\n"),
        buttons: [
            ...found.map(entry => ({ text: entryButton(entry), run: () => commandPage(player, entry, again) })),
            { text: "§bSearch again\n§8Try other words", run: () => searchScreen(player, back) }
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
            "§fChat rooms",
            "§7  Some worlds have more than one chat room. The name",
            "§7  at the start of a line tells you which one it went to.",
            "",
            "§fBeing muted",
            "§7  If you are muted you can still see chat, but nothing",
            "§7  you type is sent. It will tell you how long is left,",
            "§7  and tell you again when it ends.",
            // Chat automod is on hold (core/hold.js), so nothing mutes for spam.
            ...(CHAT_AUTOMOD_ON_HOLD ? [] : [
                "",
                "§7Spamming the same thing over and over will mute you",
                "§7automatically. Typing fast only gets you a warning."
            ])
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
        { cmd: "/admin ▸ Players ▸ a player ▸ Actions ▸ Kick", what: "Remove them from the world. They can come back.", need: "admin.kick" },
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
            "§8Axiomation Syndicate © 2026",
            "",
            `§7Menus: §f${menusName()}`,
            "§8Switch between Admin+ menus and Minecraft's own in the",
            "§8world's settings: Behavior Packs ▸ Admin+ BP ▸ the gear.",
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
