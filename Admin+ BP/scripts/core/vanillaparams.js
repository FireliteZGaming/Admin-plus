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
    // The single-letter aliases are real and were missing. Note there is no
    // short form for spectator — the game does not define one.
    gamemode:   ["survival", "creative", "adventure", "spectator", "default",
                 "s", "c", "a", "d"],
    // Bedrock accepts single-letter aliases for every one of these, and leaving
    // them out meant `/diff p` was refused by a command that vanilla accepts.
    difficulty: ["peaceful", "easy", "normal", "hard", "p", "e", "n", "h"],
    // `query` is not a weather type — `/weather query` is its own overload, and
    // carrying it in the vocabulary is what lets ONE registration reach both.
    weather:    ["clear", "rain", "thunder", "query"],
    // No `timeset` vocabulary here on purpose. `/time set` takes a NUMBER or
    // a word, and one parameter cannot be both, so the value is a String and
    // an enum of day/noon/sunset/… would only ever have been registered and
    // never offered. Same for the old `riderule`: it belongs to the
    // summon_ride overload, which this table does not reach.
    timeop:     ["set", "add", "query"],
    tagop:      ["add", "remove", "list"],
    titleop:    ["clear", "reset", "title", "subtitle", "actionbar", "times"],
    fillmode:   ["destroy", "hollow", "keep", "outline", "replace"],
    setblockmode: ["destroy", "keep", "replace"],
    clonemask:  ["replace", "masked", "filtered"],
    clonemode:  ["normal", "force", "move"],
    scanmode:   ["all", "masked"],
    structureop: ["save", "load", "delete"],
    tickingareaop: ["add", "remove", "remove_all", "list", "preload"],
    fogop:      ["push", "pop", "remove"],
    dialogueop: ["open", "change"],
    controlschemeop: ["set", "clear"],
    controlscheme: ["camera_relative_strafe", "camera_relative",
                    "player_relative_strafe", "player_relative",
                    "locked_player_relative_strafe"],
    placeop:    ["structure", "jigsaw", "feature", "featurerule"],
    scoreboardsection: ["objectives", "players"],
    lootaction: ["spawn", "give", "insert", "replace"],
    cameraop: ["set", "clear", "fade", "fov_set", "fov_clear",
               "attach_to_entity", "detach_from_entity", "target_entity",
               "remove_target", "play_spline"],
    rideop:     ["start_riding", "stop_riding", "evict_riders", "summon_rider", "summon_ride"],
    ridefill:   ["until_full", "if_group_fits"],
    // TeleportRules, which was missing entirely — start_riding takes it.
    teleportrules: ["teleport_rider", "teleport_ride"],
    recipeop:   ["give", "take"],
    musicop:    ["play", "queue", "stop", "volume"],
    // MusicRepeatMode. Two values, both bare words, so unlike most of the
    // vocabularies here it CAN be an enum — and was a String for no reason.
    musicrepeat: ["play_once", "loop"],
    hudvis:     ["hide", "reset"],
    hudelement: ["all", "air_bubbles", "armor", "crosshair", "health", "hotbar",
                 "horse_health", "hunger", "item_text", "paperdoll", "progress_bar",
                 "tooltips", "touch_controls", "status_effects"],
    // Not "vehicle_health" — that is not a HudElement. horse_health is the
    // one that covers your ride.
    // Eleven, not two. Everything past camera/movement was missing, which is
    // most of what makes this command worth having — you cannot freeze just
    // somebody's jump or just their sneak without them.
    inputperm:  ["camera", "movement", "jump", "lateral_movement", "sneak",
                 "dismount", "mount", "move_backward", "move_forward",
                 "move_left", "move_right"],
    inputpermop: ["set", "query"],
    shaketype:  ["positional", "rotational"],
    camerashakeop: ["add", "stop"],
    permstate:  ["enabled", "disabled"],
    aimassistop: ["set", "clear"],
    // ReplaceMode. Only two values, and both are bare words — unlike the slot
    // NAMES this command also takes, which carry dots and therefore cannot be
    // an enum at all. See the replaceitem row.
    replacemode: ["destroy", "keep"],
    // Which target aim assist prefers: the CLOSEST one, or the one nearest to
    // where the crosshair already points. Microsoft's docs call this
    // AimAssistTargetMode.
    aimmode:    ["distance", "angle"],
    locateop:   ["biome", "structure"],
    // The 38 rule names, so `/rule ` completes instead of demanding the exact
    // spelling of "projectilescanbreakblocks" from memory. Bool and int rules
    // share one list because the VALUE is a String either way — a rule taking
    // a number and one taking true/false look identical in the grammar.
    gamerule: ["commandblockoutput", "dodaylightcycle", "doentitydrops", "dofiretick",
               "recipesunlock", "dolimitedcrafting", "domobloot", "domobspawning",
               "dotiledrops", "doweathercycle", "drowningdamage", "falldamage",
               "firedamage", "keepinventory", "mobgriefing", "pvp", "showcoordinates",
               "showdaysplayed", "naturalregeneration", "tntexplodes", "sendcommandfeedback",
               "doinsomnia", "commandblocksenabled", "doimmediaterespawn",
               "showdeathmessages", "showtags", "freezedamage", "respawnblocksexplode",
               "showbordereffect", "showrecipemessages", "projectilescanbreakblocks",
               "tntexplosiondropdecay", "playerwaypoints",
               "maxcommandchainlength", "randomtickspeed", "functioncommandlimit",
               "spawnradius", "playerssleepingpercentage"],
    damagecause: ["anvil", "block_explosion", "campfire", "charging", "contact", "drowning",
                  "entity_attack", "entity_explosion", "fall", "falling_block", "fire",
                  "fire_tick", "fireworks", "fly_into_wall", "freezing", "lava", "lightning",
                  "magic", "magma", "none", "override", "piston", "projectile", "ram_attack",
                  "self_destruct", "sonic_boom", "soul_campfire", "stalactite", "stalagmite",
                  "starve", "suffocation", "temperature", "thorns", "void", "wither",
                  // Not "suicide" — that is not a Bedrock cause and never was.
                  // mace_smash is, and was missing.
                  "mace_smash"],
    effect: ["absorption", "bad_omen", "blindness", "conduit_power", "darkness", "fatal_poison",
             "fire_resistance", "haste", "health_boost", "hunger", "instant_damage",
             "instant_health", "invisibility", "jump_boost", "levitation", "mining_fatigue",
             "nausea", "night_vision", "poison", "regeneration", "resistance", "saturation",
             "slow_falling", "slowness", "speed", "strength", "water_breathing",
             "weakness", "wither", "village_hero",
             // The 1.21 additions, missing until 2.1.16 — six of the seven come
             // from trial chambers, which is exactly where a realm running one
             // would want to hand them out or take them away.
             "trial_omen", "wind_charged", "weaving", "oozing", "infested",
             "raid_omen", "breath_of_the_nautilus",
             // Not an effect: `/effect <player> clear` is its own overload, and
             // carrying `clear` in the vocabulary is what lets ONE registration
             // reach both. Bedrock takes it in the effect position.
             "clear"],
    enchantment: ["aqua_affinity", "bane_of_arthropods", "binding", "blast_protection",
                  "channeling", "density", "depth_strider", "efficiency", "feather_falling",
                  "fire_aspect", "fire_protection", "flame", "fortune", "frost_walker",
                  "impaling", "infinity", "knockback", "looting", "loyalty", "luck_of_the_sea",
                  "lure", "mending", "multishot", "piercing", "power", "projectile_protection",
                  "protection", "punch", "quick_charge", "respiration", "riptide", "sharpness",
                  "silk_touch", "smite", "soul_speed", "swift_sneak", "thorns", "unbreaking",
                  "vanishing", "wind_burst",
                  // 1.21 mace enchantments, missing until 2.1.16.
                  "breach", "lunge"]
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

    // Five overloads; this is the start_riding one, which is the only one a
    // person types by hand:
    //   /ride <riders> start_riding <ride> [teleportRules] [howToFill]
    // The row this replaced had howToFill BEFORE the rules and no
    // teleportRules at all, so the two optional slots were the wrong pair in
    // the wrong order. The summon_rider / summon_ride forms take an EntityType
    // where this takes a selector and cannot share the registration.
    { name: "ride", help: "Make entities ride other entities — /mount <riders> start_riding <ride>",
      params: [["riders", P.EntitySelector], ["action", P.Enum, false, "rideop"],
               ["ride", P.EntitySelector, true],
               ["teleportRules", P.Enum, true, "teleportrules"],
               ["howToFill", P.Enum, true, "ridefill"]] },

    // The real grammar is `/event entity <target> <eventName>` — that `entity`
    // is a literal and was missing, so this emitted `event @e[…] myevent` and
    // the game refused it. Exactly the shape `fixed` exists for.
    { name: "event", help: "Fire an entity event",
      fixed: ["entity"],
      params: [["targets", P.EntitySelector], ["event", P.String]] },

    { name: "playanimation", help: "Play an animation on entities",
      params: [["targets", P.EntitySelector], ["animation", P.String],
               ["nextState", P.String, true], ["blendTime", P.Float, true],
               ["stopExpression", P.String, true], ["controller", P.String, true]] },

    // The real grammar is
    //   /summon <entityType> [spawnPos] [yRot] [xRot] [spawnEvent] [nameTag]
    // and the row this replaced had nameTag in position THREE, where vanilla
    // expects yRot. So `/sum zombie ~ ~ ~ Bob` handed "Bob" to a rotation and
    // failed, and there was no way to reach a spawn event at all.
    //
    // Bedrock also has a short form, `/summon <entityType> <nameTag> [spawnPos]`,
    // which cannot share a registration with this one — position two is a
    // string there and a position here. The long form wins because it is the
    // one that can express everything.
    //
    // spawnEvent is a String, not an Enum: the vocabulary is every event of
    // every entity in the game and it changes with the version, and a stale
    // enum would refuse a value the game accepts.
    { name: "summon", help: "Summon an entity",
      params: [["entity", P.EntityType], ["spawnPos", P.Location, true],
               ["yRot", P.Float, true], ["xRot", P.Float, true],
               ["spawnEvent", P.String, true], ["nameTag", P.String, true]] },

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

    // `/xp <amount: int> [player: target]`, and that is ALL of it.
    //
    // The row this replaced demanded a mandatory `levels|points` unit that
    // Bedrock's xp command does not have — that is Java's grammar. So
    // `/exp 30 levels @s` emitted `xp 30 levels @s`, which the game rejects,
    // and the command could not work at all in the shape it advertised.
    //
    // Levels are `5L` in Bedrock — an L on the number, not a separate word.
    // `amount` stays an Integer so the game suggests numbers, which costs the
    // L form; widening it to a String to reach one suffix would take the
    // number completion off every ordinary use.
    { name: "xp", help: "Give or take experience — negative removes it",
      params: [["amount", P.Integer], ["players", P.PlayerSelector, true]] },

    { name: "spawnpoint", help: "Set a player's spawn",
      params: [["players", P.PlayerSelector, true], ["position", P.Location, true]] },

    { name: "clearspawnpoint", help: "Clear a player's spawn",
      params: [["players", P.PlayerSelector, true]] },

    { name: "recipe", help: "Give or take recipes",
      params: [["action", P.Enum, false, "recipeop"], ["players", P.PlayerSelector],
               ["recipe", P.String]] },

    // `/inputpermission set <targets> <permission> <state>` — the SET was
    // missing entirely, so this emitted `inputpermission @a[…] camera enabled`
    // with no verb and the game refused every one. `query` is the other
    // overload and rides the same enum.
    { name: "inputpermission", help: "Allow or deny a player's input — /input <set|query> <player> <permission> <state>",
      params: [["action", P.Enum, false, "inputpermop"], ["players", P.PlayerSelector],
               ["permission", P.Enum, false, "inputperm"],
               ["state", P.Enum, true, "permstate"]] },

    // `/controlscheme <players> set <scheme>` and `/controlscheme <players>
    // clear`. The `set` was missing entirely, so this emitted
    // `controlscheme @a[…] player_relative` with no verb and the game refused
    // it. The five scheme names are bare identifiers, so they complete now too.
    { name: "controlscheme", help: "Set or clear a control scheme — /controls <player> <set|clear> [scheme]",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "controlschemeop"],
               ["scheme", P.Enum, true, "controlscheme"]] },

    { name: "hud", help: "Hide or reset HUD elements",
      params: [["players", P.PlayerSelector], ["visible", P.Enum, false, "hudvis"],
               ["element", P.Enum, true, "hudelement"]] },

    // Same shape of bug: `/camerashake add <player> …` and `/camerashake stop
    // [player]`, and the verb was missing, so this emitted
    // `camerashake @a[…] 0.5 1 positional` and was refused. shakeType is a real
    // two-value enum rather than the String it was.
    { name: "camerashake", help: "Shake a player's camera — /shake <add|stop> <player> [intensity] [seconds] [type]",
      params: [["action", P.Enum, false, "camerashakeop"], ["players", P.PlayerSelector],
               ["intensity", P.Float, true], ["seconds", P.Float, true],
               ["shakeType", P.Enum, true, "shaketype"]] },

    // `/fog <victim> push <fogId> <userProvidedId>` and
    // `/fog <victim> <pop|remove> <userProvidedId>`. The mode was a bare String
    // and is a real three-value vocabulary.
    { name: "fog", help: "Push or pop a fog setting — /mist <player> <push|pop|remove> …",
      params: [["players", P.PlayerSelector], ["mode", P.Enum, false, "fogop"],
               ["fogId", P.String, true], ["userId", P.String, true]] },

    // THIRTY-FIVE overloads, and every one is built from literal words in the
    // MIDDLE of the line — `set`, `ease`, `pos`, `rot`, `facing`, `fade`,
    // `time`, `color`, `view_offset`, `entity_offset`. A parameter list cannot
    // express a grammar made of keywords, so the player and the verb are typed
    // and the rest is words. This is the one command here genuinely beyond the
    // registration model rather than merely awkward.
    { name: "camera", help: "Control a player's camera — /cam <player> <set|clear|fade|fov_set|…> …",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "cameraop"],
               ["arg", P.String, true], ["arg2", P.String, true],
               ["arg3", P.String, true], ["arg4", P.String, true],
               ["arg5", P.String, true]] },

    // Typed from Microsoft's own reference, not from guessing at the five loose
    // strings this used to be:
    //
    //   /aimassist <players: target> set [x angle] [y angle] [max distance]
    //                                    [target mode] [preset id]
    //   /aimassist <players: target> clear
    //
    // The selector comes FIRST and is MANDATORY, which nothing else in this
    // table does — everywhere else the target is either later or optional. Get
    // that order wrong and every argument lands one place off.
    //
    // Aim assist is the help Bedrock gives controller and touch players, easing
    // the crosshair toward a target. The angles are the cone it reaches
    // through, max distance how far it looks, and target mode decides whether
    // it prefers the NEAREST target or the one already closest to the
    // crosshair. A preset id names an aim-assist preset defined in a pack.
    { name: "aimassist", help: "Tune or clear a player's aim assist",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "aimassistop"],
               ["xAngle", P.Float, true], ["yAngle", P.Float, true],
               ["maxDistance", P.Float, true], ["targetMode", P.Enum, true, "aimmode"],
               ["presetId", P.String, true]] },

    // ---------------------------------------------------------- movement
    //
    // Retyped from Microsoft's reference. The row this replaced was WRONG in
    // three ways, and had been since it was written from memory:
    //
    //   * `facing` was declared a bare Location. In the real grammar `facing`
    //     is a LITERAL KEYWORD followed by a position or an entity, so the old
    //     row emitted `tp @s ~ ~10 ~ 10 20 30` — not a valid command. It could
    //     not have worked, and nothing caught it because nothing typed it.
    //   * yRot / xRot, the rotation form, were missing entirely.
    //   * checkForBlocks was missing entirely.
    //
    // /teleport has TEN overloads and a registration has one parameter list, so
    // they cannot all be offered. Bedrock ships `tp` and `teleport` as the same
    // command under two names, and this table used to carry BOTH, splitting the
    // overloads between them: /port took coordinates, /move took an entity
    // destination.
    //
    // `tp` is gone as of 2.1.23 and `port` is a pack command now — it hands
    // over the Ender Eye. The eye is the entity destination: you pick a player
    // from a list and you are there, which is the one form a custom command
    // cannot offer, because a destination means a selector and the ENGINE
    // refuses to expand one at the permission level these commands hold.
    //
    // So the single surviving row takes COORDINATES, which is the form neither
    // the eye nor the pack's own /a:tp can express:
    //
    //   /move <victim> <x y z> [yRot] [xRot] [checkForBlocks]
    //
    // `facing` is deliberately not offered. It needs a literal word in the
    // MIDDLE of the line, which buildLine's `fixed` cannot express (that only
    // emits after the command name), and it occupies the same argument
    // positions as yRot/xRot. Offering it broken is worse than not offering it.
    { name: "teleport", help: "Teleport to coordinates — /move <target> <x y z> [yRot] [xRot]",
      params: [["victim", P.EntitySelector], ["destination", P.Location],
               ["yRot", P.Float, true], ["xRot", P.Float, true],
               ["checkForBlocks", P.Boolean, true]] },

    // `/spreadplayers <x> <z> <spreadDistance> <maxRange> <victim> [maxHeight]`
    //
    // x and z are TWO separate numbers, not a position. The row this replaced
    // declared a Location, which is THREE, so every argument after it landed
    // one place along and the command could not work. maxHeight was missing too.
    //
    // Float rather than the game's `rotation` type, which would also accept
    // `~`: there is no `~` parameter type to register, and a number is what
    // this is nearly always given.
    { name: "spreadplayers", help: "Scatter players — /spread <x> <z> <spacing> <maxRange> <players>",
      params: [["x", P.Float], ["z", P.Float], ["spreadDistance", P.Float],
               ["maxRange", P.Float], ["victim", P.PlayerSelector],
               ["maxHeight", P.Float, true]] },

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
      params: [["position", P.Location], ["block", P.BlockType],
               ["blockStates", P.String, true]] },

    { name: "testforblocks", help: "Compare two regions",
      params: [["from", P.Location], ["to", P.Location], ["destination", P.Location],
               ["mode", P.Enum, true, "scanmode"]] },

    { name: "setworldspawn", help: "Set the world spawn",
      params: [["position", P.Location, true]] },

    // `/locate structure <structure> [useNewChunksOnly]` and
    // `/locate biome <biome>`. useNewChunksOnly was missing entirely.
    //
    // `name` stays a String rather than an enum because the two overloads have
    // DIFFERENT vocabularies — 88 biomes or 17 structures — and one parameter
    // cannot offer both. Offering the wrong list would be worse than offering
    // none.
    { name: "locate", help: "Find a structure or biome — /find <biome|structure> <name>",
      params: [["kind", P.Enum, false, "locateop"], ["name", P.String],
               ["useNewChunksOnly", P.Boolean, true]] },

    // `/place <structure|jigsaw|feature|featurerule> <name> [pos] …`. The kind
    // was a bare String and is a real four-value enum. The names themselves
    // stay Strings: there are several HUNDRED features and they are namespaced,
    // so a colon alone rules an enum out.
    { name: "place", help: "Place a feature or structure — /feature <structure|jigsaw|feature|featurerule> <name>",
      params: [["what", P.Enum, false, "placeop"], ["name", P.String],
               ["position", P.Location, true]] },

    // `save <name> <from> <to> [saveMode]`, `load <name> <to> [rotation]
    // [mirror] …`, `delete <name>`. The three disagree after the name — save
    // takes two positions, load takes one — so one registration reaches the
    // common shape of each and the trailing options ride loose strings.
    // `action` was a bare String and is a real three-value enum.
    { name: "structure", help: "Save, load or delete a structure",
      params: [["action", P.Enum, false, "structureop"], ["name", P.String],
               ["from", P.Location, true], ["to", P.Location, true],
               ["opt", P.String, true], ["opt2", P.String, true],
               ["opt3", P.String, true]] },

    // Eight overloads; this reaches `add <from> <to> [name] [preload]`, which
    // is the one worth typing. `remove` takes either a position OR a name, and
    // `add circle` puts a literal in the middle — neither fits beside the
    // other. `action` was a bare String and is a real five-value enum.
    { name: "tickingarea", help: "Manage ticking areas — /ticking <add|remove|remove_all|list|preload> …",
      params: [["action", P.Enum, false, "tickingareaop"], ["from", P.Location, true],
               ["to", P.Location, true], ["name", P.String, true],
               ["preload", P.Boolean, true]] },

    // TWENTY overloads, each carrying a literal word in the MIDDLE of the line
    // — `/loot give <players> loot <table>`, `/loot spawn <pos> kill <entity>`,
    // `/loot replace block <pos> slot.container <n> …`. buildLine's `fixed` can
    // only emit words straight after the command name, so none of these can be
    // described by a parameter list. Typed action, loose tail.
    { name: "loot", help: "Drop or give loot — /drops <spawn|give|insert|replace> … loot <table>",
      params: [["action", P.Enum, false, "lootaction"], ["arg", P.String],
               ["arg2", P.String, true], ["arg3", P.String, true],
               ["arg4", P.String, true], ["arg5", P.String, true]] },

    // Typed from Microsoft's reference. /replaceitem has FOUR overloads:
    //
    //   replaceitem block  <x y z>  slot.container <slotId> [mode] <item> [amount] [data]
    //   replaceitem entity <target> <slotType>     <slotId> [mode] <item> [amount] [data]
    //
    // A Bedrock registration has ONE parameter list, and position two is a
    // POSITION in the block form and a TARGET in the entity form, so the two
    // cannot share one. This row is the ENTITY form — the common case, and the
    // one the name /slot implies. The block form (putting an item into a chest
    // at coordinates) would need its own command; it is not registered.
    //
    // `mode` is mandatory here even though vanilla lets you leave it out. It
    // sits BEFORE the item, so making it optional would put a mandatory
    // parameter after an optional one, which Bedrock fills positionally and
    // this pack's own test forbids. One extra word buys an explicit answer to
    // "what happens to what was already in the slot".
    //
    // slotType is a STRING, not an Enum, and it is not an oversight: every
    // value carries dots (slot.armor.head, slot.weapon.mainhand) and Bedrock
    // refuses an enum whose values are not bare identifiers — silently. The
    // filter above this table would strip all fourteen of them.
    { name: "replaceitem", help: "Put an item in an entity's slot — slotType is slot.armor.head, slot.weapon.mainhand, slot.inventory, slot.hotbar, slot.enderchest…",
      fixed: ["entity"],
      params: [["target", P.EntitySelector], ["slotType", P.String],
               ["slotId", P.Integer], ["mode", P.Enum, false, "replacemode"],
               ["item", P.ItemType], ["amount", P.Integer, true],
               ["data", P.Integer, true]] },

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

    // `rule` was a bare String, which is the one place a String hurts most:
    // nobody remembers whether it is `dodaylightcycle` or `doDaylightCycle`, and
    // a wrong guess is silently just a wrong rule. There are 38 of them and the
    // list is stable, so it is an enum and the game completes it.
    //
    // `value` stays a String because the two overloads disagree — a bool rule
    // takes true/false and an int rule takes a number — and one registration
    // cannot be both. A String accepts either.
    { name: "gamerule", help: "Set a game rule — /rule <rule> [value]",
      params: [["rule", P.Enum, false, "gamerule"], ["value", P.String, true]] },

    // `event` is an Enum in vanilla with exactly four values, and it still has
    // to be a String here: three of them are namespaced —
    // `minecraft:pillager_patrols_event`, `minecraft:wandering_trader_event`,
    // `minecraft:ender_dragon_event`, plus the bare `events_enabled` — and a
    // colon fails the bare-identifier rule, which makes Bedrock refuse the
    // whole registration silently. Same wall as the slot names on /slot.
    { name: "mobevent", help: "Turn a mob event on or off — minecraft:pillager_patrols_event, minecraft:wandering_trader_event, minecraft:ender_dragon_event, events_enabled",
      params: [["event", P.String], ["enabled", P.Boolean, true]] },

    // ---------------------------------------------------------- presentation
    //
    // `say` is deliberately NOT here. /broadcast is the same act done better:
    // it picks an audience (all or a chat channel), it writes an audit record,
    // and it reports how many people it reached. A passthrough beside it would
    // have been a second way to do one thing, with the worse one unlogged.
    { name: "tellraw", help: "Send raw JSON text",
      params: [["players", P.PlayerSelector], ["json", P.String]] },

    { name: "title", help: "Show a title",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "titleop"],
               ["text", P.String, true], ["more", P.String, true],
               ["more2", P.String, true], ["more3", P.String, true]] },

    // Four overloads, and the `times` one needs THREE numbers:
    //   /titleraw <player> clear | reset
    //   /titleraw <player> <title|subtitle|actionbar> <json>
    //   /titleraw <player> times <fadeIn> <stay> <fadeOut>
    // With one optional argument after the action, `/rawtitle @s times 10 70 20`
    // emitted `titleraw @s times 10` — a third of a command. The two extra
    // slots carry the rest.
    { name: "titleraw", help: "Show a raw JSON title, or set times",
      params: [["players", P.PlayerSelector], ["action", P.Enum, false, "titleop"],
               ["json", P.String, true], ["stay", P.String, true],
               ["fadeOut", P.String, true]] },

    { name: "playsound", help: "Play a sound",
      params: [["sound", P.String], ["players", P.PlayerSelector, true],
               ["position", P.Location, true], ["volume", P.Float, true],
               ["pitch", P.Float, true], ["minVolume", P.Float, true]] },

    { name: "stopsound", help: "Stop a sound",
      params: [["players", P.PlayerSelector], ["sound", P.String, true]] },

    { name: "music", help: "Control background music",
      params: [["action", P.Enum, false, "musicop"], ["track", P.String, true],
               ["volume", P.Float, true], ["fadeSeconds", P.Float, true],
               ["repeatMode", P.Enum, true, "musicrepeat"]] },

    { name: "particle", help: "Spawn a particle",
      params: [["effect", P.String], ["position", P.Location, true]] },

    // `/dialogue open <npc> <player> [scene]` and
    // `/dialogue change <npc> <scene> [players]`. This is the open form; action
    // was a bare String and is a real two-value enum.
    { name: "dialogue", help: "Open or change an NPC dialogue",
      params: [["action", P.Enum, false, "dialogueop"], ["npc", P.EntitySelector],
               ["players", P.PlayerSelector, true], ["scene", P.String, true]] },

    // ---------------------------------------------------------- scoreboard
    // ELEVEN branches — objectives add/remove/list/setdisplay, players
    // list/reset/test/random/set/add/remove/operation — and they disagree from
    // the third word on. `players operation` even takes a bare `+=` as an
    // argument, which is not a token any parameter type can describe.
    //
    // So only the SECTION is typed and the rest is loose words. That is a
    // decision, not an oversight: a registration offering `objectives` when the
    // next word must be `add` would be a worse lie than offering nothing.
    { name: "scoreboard", help: "Objectives and scores — /score <objectives|players> <action> …",
      params: [["section", P.Enum, false, "scoreboardsection"],
               ["action", P.String], ["arg", P.String, true],
               ["arg2", P.String, true], ["arg3", P.String, true],
               ["arg4", P.String, true], ["arg5", P.String, true]] }
].filter(spec => !spec.skip)

/**
 * What each vanilla command is actually CALLED in this pack.
 *
 * These replaced the `z` prefix in 2.1.15. The prefix was a sorting hack — it
 * pushed all 54 below the pack's own commands in the alphabetical in-game list
 * — and it cost every single one of them a leading letter that meant nothing.
 * `/a:zfill` reads as a typo. Sorting is a weaker reason to disfigure 54 names
 * than legibility is to keep them clean, and the standing decision in
 * CLAUDE.md was already "bare command names" — the prefix was the thing out of
 * step, not this.
 *
 * The rule, from the user: readable at a glance, and shortened only where
 * shortening leaves something a person can still read. `/gm` works as an
 * abbreviation because everybody already types it in Minecraft; `/fl` would
 * not, because nobody does. So:
 *
 *   * a long name gets the shortening people already use out loud — camera to
 *     cam, difficulty to diff, damage to dmg, music to mus.
 *   * a name that cannot be shortened without turning into initials gets a
 *     real WORD instead, taken from what the command does. `testfor` counts
 *     entities, so it is `count`. `camerashake` shakes the camera, so it is
 *     `shake`. `replaceitem` writes an item into a slot, so it is `slot`.
 *
 * **EVERY ONE of the 54 is renamed, and that is the important part.** The first
 * pass left 27 of them on their vanilla name — kill, give, fill, tag, time —
 * on the reasoning that those were already short enough to leave alone. That
 * was wrong, and the pack's own verifier had the answer written down:
 *
 *     a custom command registers namespaced, and the bare form only reaches
 *     the player if nothing else claims it
 *
 * So `/kill` never reaches `/a:kill` — it reaches the GAME's kill, and the
 * pack's version is only available at the full `/a:kill`, colon and all. That
 * is slower to type, and worse than slow: the people this whole command set
 * exists for hold a rank and NO operator, and vanilla's kill refuses them. A
 * colliding name is not merely inconvenient for them, it is unreachable by the
 * short path.
 *
 * A name vanilla does not own is therefore not a nicety. It is the difference
 * between `/slay @e[type=cow]` and `/a:kill @e[type=cow]` for somebody who
 * cannot use `/kill` at all. Every name below is checked against the game's own
 * command list by `tests/vanillacmds.test.js`, and adding one that collides
 * fails the suite.
 *
 * NOT keyed to permissions. `commandNode()` builds `cmd.<vanilla name>` from
 * the command text at run time, so a rank that holds `cmd.fill` is unaffected
 * by what the registration is called. Renaming here is purely cosmetic, which
 * is why it was safe to do in one pass.
 */
export const CODENAME = new Map([
    // Shortenings people already say out loud.
    ["damage", "dmg"],
    ["effect", "eff"],
    ["enchant", "ench"],
    ["camera", "cam"],
    ["aimassist", "aim"],
    ["difficulty", "diff"],
    ["structure", "struct"],
    ["playanimation", "anim"],
    ["spreadplayers", "spread"],
    ["inputpermission", "input"],
    ["controlscheme", "controls"],
    ["tickingarea", "ticking"],
    ["dialogue", "dialog"],
    ["music", "mus"],
    ["xp", "exp"],
    ["hud", "overlay"],
    // Only one teleport row survives, and it takes coordinates. `/bring` and
    // `/goto` were considered and dropped: those read beautifully for a player
    // target and cannot express `~ ~10 ~` at all, which is what this row is
    // now entirely for. `move` reads as a sentence with a coordinate
    // destination — `/move @p ~ ~10 ~` — and leaves `port` free for the pack
    // command that hands over the Ender Eye.
    ["teleport", "move"],
    ["particle", "fx"],

    // Real words, because the vanilla name is already as short as it goes and
    // taking it would mean the bare form reaches the GAME's command instead of
    // this one. These are the 27 that the first pass wrongly left alone.
    ["kill", "slay"],
    ["give", "gift"],
    ["clear", "wipe"],
    ["fill", "region"],
    ["clone", "copy"],
    ["locate", "find"],
    ["loot", "drops"],
    ["time", "clock"],
    ["weather", "sky"],
    ["tag", "label"],
    ["ride", "mount"],
    ["event", "trigger"],
    ["summon", "sum"],
    ["recipe", "unlock"],       // recipe give/take is unlocking and relocking
    ["place", "feature"],       // it places features, jigsaws and structures
    ["fog", "mist"],
    ["daylock", "lockday"],     // same two words, the other way round
    ["mobevent", "mobs"],
    ["tellraw", "rawtell"],
    ["title", "showtitle"],
    ["titleraw", "rawtitle"],

    // Real words, because the vanilla name is either a mouthful or a lie
    // about what the command does.
    ["testfor", "count"],           // it counts entities; the help says so
    ["camerashake", "shake"],
    ["setblock", "block"],
    ["replaceitem", "slot"],        // writes an item INTO a slot
    ["toggledownfall", "rain"],
    ["gamerule", "rule"],
    ["playsound", "sound"],
    ["stopsound", "soundoff"],      // pairs with sound, reads as its opposite
    ["scoreboard", "score"],
    ["testforblock", "checkblock"],
    ["testforblocks", "checkarea"],
    ["spawnpoint", "setspawn"],
    ["clearspawnpoint", "unspawn"], // pairs with setspawn
    ["setworldspawn", "worldspawn"],

    // One name that could not just be taken.
    //
    // `gamemode` would sit next to this pack's own `/a:gm`, which does the
    // same job through the script API and is the one to reach for. `gmode`
    // keeps the vanilla passthrough available without the two reading as the
    // same command with a typo between them.
    ["gamemode", "gmode"]
])

/**
 * Command names the GAME owns, so a registration must never use one.
 *
 * A custom command is registered namespaced (`a:slay`), and Bedrock also
 * resolves the BARE form (`/slay`) — but only when nothing else claims it.
 * Anything on this list is claimed, so naming a passthrough `kill` would make
 * `/kill` reach vanilla's, leaving this pack's only at `/a:kill`.
 *
 * It is the 54 this file already describes plus the ones the pack refuses to
 * run at all (see NEVER in core/execute.js) plus the handful of vanilla
 * commands with no passthrough. Kept here rather than in the test so the
 * source of truth sits next to the names it constrains.
 */
export const GAME_OWNED = new Set([
    ...COMMANDS.map(c => c.name),
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
    ["aimassist", "2026-09-10"],   // was 5 loose strings; selector is FIRST and mandatory
    ["replaceitem", "2026-09-10"], // was 6 loose strings; entity form only, block form unregistered
    ["teleport", "2026-09-11"],    // took over /port's coordinate form when tp was dropped
    ["kill", "2026-09-10"],        // already right
    ["give", "2026-09-10"],        // already right; [components: json] not offered
    ["clear", "2026-09-10"],       // already right
    // Shape was right. The VOCABULARY was seven effects short — the 1.21 batch,
    // six of them from trial chambers. `infinite` is a real duration keyword
    // (`/effect <p> <e> infinite [amp]`) and stays unreachable on purpose:
    // `seconds` is an Integer so the game suggests numbers, and widening it to
    // a String to fit one word would cost that on every use.
    ["effect", "2026-09-10"],
    ["fill", "2026-09-10"],        // already right, replace form included
    ["setblock", "2026-09-10"],    // already right
    // nameTag had been sitting in position THREE, where vanilla expects yRot —
    // so `/sum zombie ~ ~ ~ Bob` handed a name to a rotation. spawnEvent was
    // unreachable entirely.
    ["summon", "2026-09-10"],
    // Demanded a mandatory `levels|points` unit that Bedrock does not have —
    // that is Java's grammar. `/exp 30 levels @s` emitted an invalid command.
    ["xp", "2026-09-10"],
    ["weather", "2026-09-10"],     // shape right; `query` was missing from the vocabulary
    ["difficulty", "2026-09-10"],  // shape right; the p/e/n/h aliases were missing
    ["enchant", "2026-09-10"],     // shape right; breach and lunge were missing
    ["damage", "2026-09-10"],      // shape right; cause list had a "suicide" that is not real, and no mace_smash
    ["tag", "2026-09-10"],         // right, incl. carrying `list` in the vocabulary to reach both overloads
    ["time", "2026-09-10"],        // right; value stays a String so it takes a number OR a time word
    ["gamerule", "2026-09-10"],    // rule was a bare String — 38 names, now completed
    ["spawnpoint", "2026-09-10"],  // already right
    ["setworldspawn", "2026-09-10"], // already right
    ["particle", "2026-09-10"],    // already right — and it takes NO target, which I had wrongly suspected
    ["locate", "2026-09-10"],      // useNewChunksOnly was missing
    ["clearspawnpoint", "2026-09-10"], // already right
    ["daylock", "2026-09-10"],     // already right
    ["mobevent", "2026-09-10"],    // right; the four values are namespaced so they cannot be an enum
    ["playsound", "2026-09-10"],   // already right, all six parameters
    ["stopsound", "2026-09-10"],   // already right
    ["music", "2026-09-10"],       // right; repeatMode was a String and is a real two-value enum
    ["title", "2026-09-10"],       // right — the loose words carry the `times` form
    ["titleraw", "2026-09-10"],    // `times` needs three numbers and only one slot existed
    ["tellraw", "2026-09-10"],     // already right
    ["hud", "2026-09-10"],         // right; element list had a "vehicle_health" that is not one
    ["inputpermission", "2026-09-10"], // WAS BROKEN: no set/query verb, and 9 of 11 permissions missing
    ["camerashake", "2026-09-10"], // WAS BROKEN: no add/stop verb
    ["clone", "2026-09-10"],       // already right; `filtered` rides the mask enum to reach the other overload
    ["testfor", "2026-09-10"],     // already right
    ["testforblock", "2026-09-10"], // optional blockStates was missing
    ["testforblocks", "2026-09-10"], // already right
    ["gamemode", "2026-09-10"],    // right; the s/c/a/d aliases were missing
    ["toggledownfall", "2026-09-10"], // already right — genuinely takes no arguments
    ["spreadplayers", "2026-09-10"], // WAS BROKEN: x and z as one 3-value Location; victim was entity-typed
    ["ride", "2026-09-10"],        // WAS BROKEN: wrong optional pair, wrong order, no teleportRules
    ["structure", "2026-09-10"],   // action was a bare String; option tail had nowhere to go
    ["scoreboard", "2026-09-10"],  // 11 branches; section typed, tail loose ON PURPOSE
    ["loot", "2026-09-10"],        // 20 overloads with mid-line literals; action typed, tail loose
    ["camera", "2026-09-10"],      // 35 overloads built from keywords; beyond the registration model
    ["playanimation", "2026-09-10"], // already right, all six parameters in order
    ["event", "2026-09-10"],       // WAS BROKEN: the literal `entity` was missing
    ["recipe", "2026-09-10"],      // already right
    ["tickingarea", "2026-09-10"], // action was a bare String; preload had nowhere to go
    ["fog", "2026-09-10"],         // mode was a bare String
    ["dialogue", "2026-09-10"],    // action was a bare String; npc is mandatory, not optional
    ["controlscheme", "2026-09-10"], // WAS BROKEN: the `set` verb was missing
    ["place", "2026-09-10"]        // kind was a bare String
])

