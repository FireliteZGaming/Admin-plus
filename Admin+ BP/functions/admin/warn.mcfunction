# The addon is not running, and this is the only thing that can say so.
#
# Run with "execute as @a[...]", so @s here is one player whose timer came due.
# On a first join that is about two seconds in; after that, once a minute.
#
# Selectors only - see the note in heartbeat.mcfunction about why "#script"
# could never work on Bedrock.

scoreboard players set @s ap_tick 0

execute if entity @s[scores={ap_alive=..-40}] run tellraw @s {"rawtext":[{"text":"§8[§bAdmin§d+§8] §c§lNOT RUNNING§r"}]}
execute if entity @s[scores={ap_alive=..-40}] run tellraw @s {"rawtext":[{"text":"§7Turn on §9Beta-API's §7or §cUpdate/Install §7the latest version of this mod"}]}
execute if entity @s[scores={ap_alive=..-40}] run tellraw @s {"rawtext":[{"text":"§8Settings > Game > Experiments > Beta APIs, then reload the world.§r"}]}
execute if entity @s[scores={ap_alive=..-40}] run tellraw @s {"rawtext":[{"text":"§8Run §f/function check§8 any time to see this again.§r"}]}
execute if entity @s[scores={ap_alive=..-40}] run playsound note.bass @s ~ ~ ~
