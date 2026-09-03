# /function spear-mace — turn this world into the Spear Mace shape in one go.
#
# Sets the ladder, the config and the chats together: no TPA, ban above Admin,
# Moderator as a trial rank, automod watching, and the long tail of cosmetic
# tags that are Member with a different name on them.
#
# A .mcfunction cannot call script directly. /scriptevent is the only door
# between the two, so this fires an event that scripts/features/scriptevents.js
# is listening for.
#
# Your warps and who holds which rank are left alone. Ranks the new ladder does
# not define stop existing — Ranks > Ladder > Undo puts the old one back.

scriptevent adminplus:preset spearmace
