/**
 * Command names the GAME owns, so a pack command must never use one.
 *
 * A custom command registers namespaced (`a:clock`), and Bedrock resolves the
 * BARE form (`/clock`) only when nothing else claims it. A pack command named
 * after a vanilla one answers only to its full `/a:` name, and for a ranked
 * player without operator the bare form reaches the game's version, which
 * refuses them. That is why time and weather are `/clock` and `/sky`.
 *
 * Every vanilla command: the 54 Admin+ used to wrap (all gone by 2.8.4) and
 * the ones it never ran. `tests/names.test.js` checks every pack command
 * against this list.
 */
export const GAME_OWNED = new Set([
    "aimassist", "allowlist", "alwaysday", "camera", "camerashake",
    "changesetting", "clear", "clearspawnpoint", "clone", "connect",
    "controlscheme", "damage", "daylock", "deop", "dialogue", "difficulty",
    "effect", "enchant", "event", "execute", "experience", "fill", "fog",
    "function", "gamemode", "gamerule", "gametest", "gametip", "give", "help",
    "hud", "immutableworld", "inputpermission", "kick", "kill", "list",
    "locate", "loot", "me", "mobevent", "msg", "music", "op", "ops", "particle",
    "permission", "place", "playanimation", "playsound", "project",
    "querytarget", "recipe", "reload", "reloadconfig", "replaceitem", "ride",
    "save", "schedule", "scoreboard", "script", "scriptevent",
    "sendshowstoreoffer", "setblock", "setmaxplayers", "setworldspawn",
    "spawnpoint", "spreadplayers", "stop", "stopsound", "structure", "summon",
    "tag", "teleport", "tell", "tellraw", "testfor", "testforblock",
    "testforblocks", "tickingarea", "tickingareas", "time", "title", "titleraw",
    "toggledownfall", "tp", "transfer", "w", "wb", "weather", "whitelist",
    "worldbuilder", "wsserver", "xp"
])
