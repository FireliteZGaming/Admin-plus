# /function check - tells you, right now, whether Admin+ is actually running.
#
# Named "check" rather than "setup" on purpose: it configures nothing. Admin+
# needs no setup step, and calling it setup would imply the addon does not work
# until you run it. The useful thing here is knowing WHY nothing works.
#
# /function healthcheck does the same, for anyone who reaches for that name.
#
# Everything here addresses @s. The earlier version read a "#script" fake player
# the way a Java datapack would; Bedrock's parser rejects "#" in an execute
# target outright, so every conditional line below failed to parse, the file was
# dropped whole as unparseable, and this command printed absolutely nothing.
# See the long note in admin/heartbeat.mcfunction.

function admin/init

# Make sure this player has an entry before anything reads it. "add 0" creates
# it at zero when it is missing and leaves a live heartbeat untouched.
scoreboard players add @s ap_alive 0

# Always say something. A health check that can print nothing is worse than no
# health check, because silence looks identical to the addon being missing.
tellraw @s {"rawtext":[{"text":"§8[§bAdmin§d+§8] §fHealth check§r"}]}
tellraw @s {"rawtext":[{"text":"§8heartbeat §7"},{"score":{"name":"*","objective":"ap_alive"}},{"text":"§8 / 100§r"}]}

execute if entity @s[scores={ap_alive=-39..}] run tellraw @s {"rawtext":[{"text":"§aRunning normally.§r"}]}
execute if entity @s[scores={ap_alive=-39..}] run tellraw @s {"rawtext":[{"text":"§7Type §f/admin§7 for the panel. Nothing else needs setting up.§r"}]}

execute unless entity @s[scores={ap_alive=-39..}] run tellraw @s {"rawtext":[{"text":"§c§lNOT RUNNING§r"}]}
execute unless entity @s[scores={ap_alive=-39..}] run tellraw @s {"rawtext":[{"text":"§7Turn on §9Beta-API's §7or §cUpdate/Install §7the latest version of this mod"}]}
execute unless entity @s[scores={ap_alive=-39..}] run tellraw @s {"rawtext":[{"text":"§8Settings > Game > Experiments > Beta APIs, then reload the world.§r"}]}
execute unless entity @s[scores={ap_alive=-39..}] run playsound random.anvil_land @s ~ ~ ~
