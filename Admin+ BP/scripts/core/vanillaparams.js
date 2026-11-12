import { CustomCommandParamType } from "@minecraft/server"

// The parameter table for the vanilla commands Admin+ runs for staff who are
// not operators: time and weather, and nothing else.
//
// **2.8.2 cut this from 54 commands to two**, the user's call: the rest were
// "excessive op commands", added to hand admins more power than an admin pack
// needs. What mattered already has an Admin+ tool of its own (/gm and /gmc,
// teleporting, spawn, lag clear, inventories). Do not add vanilla wrappers
// back; write a purpose-built Admin+ command instead, the way /gmc is.
//
// The history below is why each command is its own registration.
//
// WHY THIS FILE EXISTS. /cmd used to be one command with one text parameter,
// and a Bedrock text parameter is a single token — so `/cmd kill @e[type=cow]`
// was a syntax error, and the playtest found it. Widening it to an Enum plus
// seven loose words fixed that, but it still could not complete an ARGUMENT:
// you got the command name offered and nothing after it.
//
// The reason is worth writing down, because it is what shapes this file: a
// command registration has ONE fixed parameter list. /cmd cannot be typed
// `EntitySelector` for kill and `Location BlockType` for setblock at the same
// time. Real completion therefore needs one registration PER command, which is
// what `cmd:kill`, `cmd:give` and the rest are.
//
// What that buys, and it is a lot: the GAME parses the arguments. `@e[type=…]`
// gets the engine's own selector completion, every filter it supports, and it
// is validated before a line of our code runs. Item and block names complete
// too. Nothing here parses text.
//
// The eleven types are BlockType, Boolean, EntitySelector, EntityType, Enum,
// Float, Integer, ItemType, Location, PlayerSelector and String — verified
// against the API reference, not remembered.

const P = CustomCommandParamType

/**
 * Enum value sets. These are the vocabularies the game itself offers, so
 * spelling them out here is what makes `/cmd:gamemode ` open a list of four
 * words instead of a blank.
 *
 * Where a vocabulary is enormous and changes with the game version (sounds,
 * particles, structures) the parameter stays String — a stale enum would be
 * WORSE than free text, because it would refuse a value the game accepts.
 */
export const ENUMS = {
    // `query` is not a weather type — `/weather query` is its own overload, and
    // carrying it in the vocabulary is what lets ONE registration reach both.
    weather:    ["clear", "rain", "thunder", "query"],
    // `/time set` takes a number or a word (day, noon, sunset…), and one
    // parameter cannot be both, so the value after this stays a String.
    timeop:     ["set", "add", "query"]
}

// Every enum value has to be a bare identifier: the game refuses a registration
// carrying anything else, and refuses it silently.
for (const key of Object.keys(ENUMS)) {
    ENUMS[key] = ENUMS[key].filter(v => /^[a-z_0-9]+$/.test(v))
}

/**
 * How each argument turns back into command text.
 *
 * Selectors are the interesting case. The game hands back resolved `Entity[]`
 * and `Player[]`, not the text that was typed, so the selector cannot simply be
 * pasted back. Every entity gets a one-shot TAG instead, and the rebuilt line
 * targets `@e[tag=…]`.
 *
 * That is not a workaround for its own sake — it means the resolved set is
 * exactly what gets acted on, so `@e[type=cow,r=10,c=3]` picks its three cows
 * once, and the command cannot re-resolve to a different set a tick later.
 *
 * Everything else is already a value: Location is numbers, ItemType and
 * BlockType carry an id, the rest are primitives.
 */
export const SELECTOR_TYPES = new Set([P.EntitySelector, P.PlayerSelector])

/** One command's shape. `params` are in order; `optional` splits the list. */
export const COMMANDS = [
    { name: "time", help: "Set or query the time",
      params: [["action", P.Enum, false, "timeop"], ["value", P.String, true]] },

    { name: "weather", help: "Set the weather",
      params: [["kind", P.Enum, false, "weather"], ["duration", P.Integer, true]] }
].filter(spec => !spec.skip)

/**
 * What each vanilla command is CALLED in this pack.
 *
 * A custom command registers namespaced, and the bare form only reaches the
 * player if nothing else claims it. The game owns `/time` and `/weather`, and
 * its own versions refuse somebody with a rank and no operator, which is
 * exactly who these are for. So each gets a word the game does not own.
 * `tests/vanillacmds.test.js` checks every name against GAME_OWNED.
 *
 * NOT keyed to permissions: `commandNode()` builds `cmd.<vanilla name>` from
 * the command text, so a rank holding `cmd.time` is unaffected by the name.
 */
export const CODENAME = new Map([
    ["time", "clock"],
    ["weather", "sky"]
])

/**
 * Command names the GAME owns, so a registration must never use one.
 *
 * A custom command is registered namespaced (`a:slay`), and Bedrock also
 * resolves the BARE form (`/slay`) — but only when nothing else claims it.
 * Anything on this list is claimed, so naming a passthrough `kill` would make
 * `/kill` reach vanilla's, leaving this pack's only at `/a:kill`.
 *
 * Every vanilla command, wrapped or not: the two this file still wraps, the
 * 52 it wrapped until 2.8.2, the ones the pack refuses to run at all (see NEVER
 * in core/execute.js), and the handful it never wrapped. Kept here rather than
 * in the test so the source of truth sits next to the names it constrains.
 */
export const GAME_OWNED = new Set([
    ...COMMANDS.map(c => c.name),
    // Wrapped until 2.8.2. The game still owns every one of these names.
    "kill", "damage", "effect", "tag", "testfor", "ride", "event", "playanimation",
    "summon", "give", "clear", "enchant", "gamemode", "xp", "spawnpoint",
    "clearspawnpoint", "recipe", "inputpermission", "controlscheme", "hud",
    "camerashake", "fog", "camera", "aimassist", "teleport", "spreadplayers",
    "setblock", "fill", "clone", "testforblock", "testforblocks", "setworldspawn",
    "locate", "place", "structure", "tickingarea", "loot", "replaceitem",
    "difficulty", "daylock", "toggledownfall", "gamerule", "mobevent", "tellraw",
    "title", "titleraw", "playsound", "stopsound", "music", "particle", "dialogue",
    "scoreboard",
    // Refused outright by core/execute.js, but the GAME still owns the name.
    "op", "deop", "execute", "function", "scriptevent", "schedule", "kick",
    "allowlist", "whitelist", "permission", "changesetting", "reload",
    "reloadconfig", "save", "stop", "transfer", "setmaxplayers", "wsserver",
    "sendshowstoreoffer", "script", "gametest", "project",
    // Real vanilla commands this pack has no passthrough for.
    //
    // `tp` is on this list rather than in COMMANDS as of 2.1.23. The game still
    // owns the name — dropping the passthrough does not free it — so a pack
    // command called `tp` would only ever answer to `/a:tp`, which is exactly
    // what main.js's teleport is and why it is registered under that name.
    "tp",
    "tell", "w", "list", "me", "msg", "experience", "gametip", "help",
    "immutableworld", "ops", "querytarget", "setmaxplayers", "tickingareas",
    "worldbuilder", "wb", "alwaysday", "clearspawnpoint", "connect"
])

/** What a vanilla command is registered as. Falls through to its own name. */
export function codenameFor(name) {
    return CODENAME.get(name) ?? name
}

/**
 * Which rows have been checked against Microsoft's command reference, and when.
 *
 * **A row not in here was written from memory and has never been verified.**
 * That is not a theoretical worry. `/tp` sat in this table for its whole life
 * declaring `facing` as a bare Location, when `facing` is a literal KEYWORD in
 * the real grammar — so it emitted `tp @s ~ ~10 ~ 10 20 30`, which is not a
 * command. Nothing caught it, because every test here checked the SHAPE of a
 * row (eight parameters or fewer, mandatory before optional, enums that exist)
 * and nothing checked whether the shape was the RIGHT one.
 *
 * `/aimassist` and `/replaceitem` were worse: five and six loose `rest` strings
 * standing in for grammars nobody had read.
 *
 * The source is `learn.microsoft.com/en-us/minecraft/creator/commands/commands/
 * <name>`, plus `.../enums/<name>` for a vocabulary. Not memory, and not
 * another addon — see [[bedrock-version-sourcing]].
 *
 * Kept beside the table rather than as a field on each row so that the honest
 * count is one thing you can look at, and so an unverified row cannot quietly
 * look verified. `python tools/commands.py` renders the whole set with this
 * column filled in.
 */
export const CHECKED = new Map([
    ["time", "2026-09-10"],        // right; value stays a String so it takes a number OR a time word
    ["weather", "2026-09-10"]      // shape right; `query` was missing from the vocabulary
])

