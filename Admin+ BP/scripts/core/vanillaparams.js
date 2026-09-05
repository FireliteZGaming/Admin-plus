import { CustomCommandParamType } from "@minecraft/server"

// The parameter table: what every vanilla command on the allowlist actually
// takes, in the types Bedrock knows about.
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
    gamemode:   ["survival", "creative", "adventure", "spectator", "default"],
    difficulty: ["peaceful", "easy", "normal", "hard"],
    weather:    ["clear", "rain", "thunder"],
    timeset:    ["day", "noon", "sunset", "night", "midnight", "sunrise"],
    timeop:     ["set", "add", "query"],
    tagop:      ["add", "remove", "list"],
    titleop:    ["clear", "reset", "title", "subtitle", "actionbar", "times"],
    fillmode:   ["destroy", "hollow", "keep", "outline", "replace"],
    setblockmode: ["destroy", "keep", "replace"],
    clonemask:  ["replace", "masked", "filtered"],
    clonemode:  ["normal", "force", "move"],
    scanmode:   ["all", "masked"],
    rideop:     ["start_riding", "stop_riding", "evict_riders", "summon_rider", "summon_ride"],
    ridefill:   ["until_full", "if_group_fits"],
    riderule:   ["no_ride_change", "reassign_rides", "skip_riders"],
    recipeop:   ["give", "take"],
    musicop:    ["play", "queue", "stop", "volume"],
    hudvis:     ["hide", "reset"],
    hudelement: ["all", "air_bubbles", "armor", "crosshair", "health", "hotbar",
                 "horse_health", "hunger", "item_text", "paperdoll", "progress_bar",
                 "tooltips", "touch_controls", "status_effects", "vehicle_health"],
    inputperm:  ["camera", "movement"],
    permstate:  ["enabled", "disabled"],
    locateop:   ["biome", "structure"],
    xpunit:     ["levels", "points"],
    damagecause: ["anvil", "block_explosion", "campfire", "charging", "contact", "drowning",
                  "entity_attack", "entity_explosion", "fall", "falling_block", "fire",
                  "fire_tick", "fireworks", "fly_into_wall", "freezing", "lava", "lightning",
                  "magic", "magma", "none", "override", "piston", "projectile", "ram_attack",
                  "self_destruct", "sonic_boom", "soul_campfire", "stalactite", "stalagmite",
                  "starve", "suffocation", "suicide", "temperature", "thorns", "void", "wither"],
    effect: ["absorption", "bad_omen", "blindness", "conduit_power", "darkness", "fatal_poison",
             "fire_resistance", "haste", "health_boost", "hunger", "instant_damage",
             "instant_health", "invisibility", "jump_boost", "levitation", "mining_fatigue",
             "nausea", "night_vision", "poison", "regeneration", "resistance", "saturation",
             "slow_falling", "slowness", "speed", "strength", "water_breathing",
             "weakness", "wither", "village_hero", "clear"],
    enchantment: ["aqua_affinity", "bane_of_arthropods", "binding", "blast_protection",
                  "channeling", "density", "depth_strider", "efficiency", "feather_falling",
                  "fire_aspect", "fire_protection", "flame", "fortune", "frost_walker",
                  "impaling", "infinity", "knockback", "looting", "loyalty", "luck_of_the_sea",
                  "lure", "mending", "multishot", "piercing", "power", "projectile_protection",
                  "protection", "punch", "quick_charge", "respiration", "riptide", "sharpness",
                  "silk_touch", "smite", "soul_speed", "swift_sneak", "thorns", "unbreaking",
                  "vanishing", "wind_burst"]
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
    // ---------------------------------------------------------- entities
    { name: "kill", help: "Kill entities",
      params: [["targets", P.EntitySelector, true]] },

    { name: "damage", help: "Damage entities",
      params: [["targets", P.EntitySelector], ["amount", P.Integer],
               ["cause", P.Enum, true, "damagecause"]] },

    { name: "effect", help: "Give or clear an effect",
      params: [["targets", P.EntitySelector], ["effect", P.Enum, false, "effect"],
               ["seconds", P.Integer, true], ["amplifier", P.Integer, true],
               ["hideParticles", P.Boolean, true]] },

    { name: "tag", help: "Add, remove or list entity tags",
      params: [["targets", P.EntitySelector], ["action", P.Enum, false, "tagop"],
               ["name", P.String, true]] },

    { name: "testfor", help: "Count entities matching a selector",
      params: [["targets", P.EntitySelector]] },

    { name: "ride", help: "Make entities ride other entities",
      params: [["riders", P.EntitySelector], ["action", P.Enum, false, "rideop"],
               ["ride", P.EntitySelector, true], ["fill", P.Enum, true, "ridefill"],
               ["rule", P.Enum, true, "riderule"]] },

    { name: "event", help: "Fire an entity event",
      params: [["targets", P.EntitySelector], ["event", P.String]] },

    { name: "playanimation", help: "Play an animation on entities",
      params: [["targets", P.EntitySelector], ["animation", P.String],
               ["nextState", P.String, true], ["blendTime", P.Float, true],
               ["stopExpression", P.String, true], ["controller", P.String, true]] },

    { name: "summon", help: "Summon an entity",
      params: [["entity", P.EntityType], ["position", P.Location, true],
               ["nameTag", P.String, true]] },

    // ---------------------------------------------------------- players
    { name: "give", help: "Give an item",
      params: [["players", P.PlayerSelector], ["item", P.ItemType],
               ["amount", P.Integer, true], ["data", P.Integer, true]] },

    { name: "clear", help: "Clear items from inventory",
      params: [["players", P.PlayerSelector, true], ["item", P.ItemType, true],
               ["data", P.Integer, true], ["maxCount", P.Integer, true]] },

    { name: "enchant", help: "Enchant the held item",
      params: [["players", P.PlayerSelector], ["enchantment", P.Enum, false, "enchantment"],
               ["level", P.Integer, true]] },

    { name: "gamemode", help: "Set a game mode",
      params: [["mode", P.Enum, false, "gamemode"], ["players", P.PlayerSelector, true]] },

    { name: "xp", help: "Give experience",
      params: [["amount", P.Integer], ["unit", P.Enum, false, "xpunit"],
               ["players", P.PlayerSelector, true]] },

    { name: "spawnpoint", help: "Set a player's spawn",
      params: [["players", P.PlayerSelector, true], ["position", P.Location, true]] },

    { name: "clearspawnpoint", help: "Clear a player's spawn",
      params: [["players", P.PlayerSelector, true]] },

    { name: "recipe", help: "Give or take recipes",
      params: [["action", P.Enum, false, "recipeop"], ["players", P.PlayerSelector],
               ["recipe", P.String]] },

    { name: "inputpermission", help: "Allow or deny a player's input",
      params: [["players", P.PlayerSelector], ["permission", P.Enum, false, "inputperm"],
               ["state", P.Enum, false, "permstate"]] },

    { name: "controlscheme", help: "Set a player's control scheme",
      params: [["players", P.PlayerSelector], ["scheme", P.String]] },

    { name: "hud", help: "Hide or reset HUD elements",
      params: [["players", P.PlayerSelector], ["visible", P.Enum, false, "hudvis"],
               ["element", P.Enum, true, "hudelement"]] },

    { name: "camerashake", help: "Shake a player's camera",
      params: [["players", P.PlayerSelector], ["intensity", P.Float, true],
               ["seconds", P.Float, true], ["shakeType", P.String, true]] },

    { name: "fog", help: "Push or pop a fog setting",
      params: [["players", P.PlayerSelector], ["mode", P.String],
               ["fogId", P.String, true], ["userId", P.String, true]] },

    { name: "camera", help: "Control a player's camera",
      params: [["players", P.PlayerSelector], ["rest", P.String, true],
               ["rest2", P.String, true], ["rest3", P.String, true],
               ["rest4", P.String, true], ["rest5", P.String, true]] },

    { name: "aimassist", help: "Aim assist settings",
      params: [["rest", P.String], ["rest2", P.String, true], ["rest3", P.String, true],
               ["rest4", P.String, true], ["rest5", P.String, true]] },

    // ---------------------------------------------------------- movement
    { name: "tp", help: "Teleport",
      params: [["targets", P.EntitySelector], ["destination", P.Location, true],
               ["facing", P.Location, true]] },

    { name: "teleport", help: "Teleport",
      params: [["targets", P.EntitySelector], ["destination", P.Location, true],
               ["facing", P.Location, true]] },

    { name: "spreadplayers", help: "Scatter players around a point",
      params: [["centre", P.Location], ["spread", P.Float], ["maxRange", P.Float],
               ["targets", P.EntitySelector]] },

    // ---------------------------------------------------------- the world
    { name: "setblock", help: "Place one block",
      params: [["position", P.Location], ["block", P.BlockType],
               ["mode", P.Enum, true, "setblockmode"]] },

    { name: "fill", help: "Fill a region with a block",
      params: [["from", P.Location], ["to", P.Location], ["block", P.BlockType],
               ["mode", P.Enum, true, "fillmode"], ["replace", P.BlockType, true]] },

    { name: "clone", help: "Copy a region",
      params: [["from", P.Location], ["to", P.Location], ["destination", P.Location],
               ["maskMode", P.Enum, true, "clonemask"], ["cloneMode", P.Enum, true, "clonemode"]] },

    { name: "testforblock", help: "Test for a block",
      params: [["position", P.Location], ["block", P.BlockType]] },

    { name: "testforblocks", help: "Compare two regions",
      params: [["from", P.Location], ["to", P.Location], ["destination", P.Location],
               ["mode", P.Enum, true, "scanmode"]] },

    { name: "setworldspawn", help: "Set the world spawn",
      params: [["position", P.Location, true]] },

    { name: "locate", help: "Find a structure or biome",
      params: [["kind", P.Enum, false, "locateop"], ["name", P.String]] },

    { name: "place", help: "Place a feature or structure",
      params: [["what", P.String], ["name", P.String, true], ["position", P.Location, true]] },

    { name: "structure", help: "Save or load a structure",
      params: [["action", P.String], ["name", P.String, true],
               ["from", P.Location, true], ["to", P.Location, true]] },

    { name: "tickingarea", help: "Manage ticking areas",
      params: [["action", P.String], ["from", P.Location, true],
               ["to", P.Location, true], ["name", P.String, true]] },

    { name: "loot", help: "Drop or give loot",
      params: [["action", P.String], ["rest", P.String, true], ["rest2", P.String, true],
               ["rest3", P.String, true], ["rest4", P.String, true]] },

    { name: "replaceitem", help: "Replace an item in a slot",
      params: [["rest", P.String], ["rest2", P.String, true], ["rest3", P.String, true],
               ["rest4", P.String, true], ["rest5", P.String, true],
               ["rest6", P.String, true]] },

    // ---------------------------------------------------------- world state
    { name: "time", help: "Set or query the time",
      params: [["action", P.Enum, false, "timeop"], ["value", P.String, true]] },

    { name: "weather", help: "Set the weather",
      params: [["kind", P.Enum, false, "weather"], ["duration", P.Integer, true]] },

    { name: "difficulty", help: "Set the difficulty",
      params: [["level", P.Enum, false, "difficulty"]] },

    { name: "daylock", help: "Lock or unlock the day cycle",
      params: [["locked", P.Boolean, true]] },

    { name: "toggledownfall", help: "Toggle the weather", params: [] },

    { name: "gamerule", help: "Set a game rule",
      params: [["rule", P.String], ["value", P.String, true]] },

    { name: "mobevent", help: "Turn a mob event on or off",
      params: [["event", P.String], ["enabled", P.Boolean, true]] },

    // ---------------------------------------------------------- presentation
    { name: "say", help: "Say something as the server",
      params: [["message", P.String], ["more", P.String, true], ["more2", P.String, true],
               ["more3", P.String, true], ["more4", P.String, true],
               ["more5", P.String, true], ["more6", P.String, true]] },

    { name: "tellraw", help: "Send raw JSON text",
      params: [["players", P.PlayerSelector], ["json", P.String]] },

    { name: "title", help: "Show a title",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "titleop"],
               ["text", P.String, true], ["more", P.String, true],
               ["more2", P.String, true], ["more3", P.String, true]] },

    { name: "titleraw", help: "Show a raw JSON title",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "titleop"],
               ["json", P.String, true]] },

    { name: "playsound", help: "Play a sound",
      params: [["sound", P.String], ["players", P.PlayerSelector, true],
               ["position", P.Location, true], ["volume", P.Float, true],
               ["pitch", P.Float, true], ["minVolume", P.Float, true]] },

    { name: "stopsound", help: "Stop a sound",
      params: [["players", P.PlayerSelector], ["sound", P.String, true]] },

    { name: "music", help: "Control background music",
      params: [["action", P.Enum, false, "musicop"], ["track", P.String, true],
               ["volume", P.Float, true], ["fadeSeconds", P.Float, true],
               ["repeatMode", P.String, true]] },

    { name: "particle", help: "Spawn a particle",
      params: [["effect", P.String], ["position", P.Location, true]] },

    { name: "dialogue", help: "Open or change an NPC dialogue",
      params: [["action", P.String], ["npc", P.EntitySelector, true],
               ["players", P.PlayerSelector, true], ["scene", P.String, true]] },

    // ---------------------------------------------------------- scoreboard
    { name: "scoreboard", help: "Objectives and scores",
      params: [["rest", P.String], ["rest2", P.String, true], ["rest3", P.String, true],
               ["rest4", P.String, true], ["rest5", P.String, true],
               ["rest6", P.String, true], ["rest7", P.String, true]] }
].filter(spec => !spec.skip)

