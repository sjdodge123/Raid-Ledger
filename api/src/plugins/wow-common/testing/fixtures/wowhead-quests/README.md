# Wowhead quest/zone fixtures (ROK-1748 probe, captured 2026-10-09)

UA `RaidLedger/1.0 (+https://raid.gamernight.net)`, <=1 req/s.

## Forever pages EXIST already
- `/forever/zone=1584` -> 301 -> `/forever/zone=1584/blackrock-depths` -> 200 (title "Blackrock Depths - Zone - Forever").
- `/forever/quest=4136` -> 301 -> `/forever/quest=4136/ribbly-screwspigot` -> 200.
- Tooltip `nether.wowhead.com/tooltip/quest/4136?dataEnv=16` and `?dataEnv=4` -> 200, identical bodies (371 B). Note: quest 4136 is "Ribbly Screwspigot", not "Hard to Kill".
- Always follow the 301 (slug is appended); request the slugless URL, read `Location`.

## Files
- `zone-1584-forever.html`, `quest-4136-forever.html`: real Forever pages (full).
- `zone-1584-classic.html`: TRIMMED (orig 474 KB) to `<head>` + the quest Listview `<script>`.
- `quest-4136-classic.html`, `quest-4001-classic.html`, `quest-4136-tooltip.json`: full.

## Zone quest Listview
`new Listview({template: 'quest', id: 'quests', ... data: [ {...}, ... ]` (JSON array in `data:`).
Keys: `id, name, level, reqlevel, side (1 Alliance/2 Horde/3 both), type, xp, money, itemrewards [[itemId,qty]], itemchoices [[itemId,qty]], reprewards [[factionId,amt]], category, category2, wflags, _type`.
Forever adds `envChange {status, labels[], lines[]}`; some rows have `notShown`.

## Quest page
- Infobox is a Markup string: `[li]Level: 53[/li][li]Requires level 48[/li][li]Type: Dungeon[/li][li]Side: Both[/li][li][icon name=quest-start]Start: [url=/forever/npc=9544/slug]Name[/url][/icon][/li][li][icon name=quest-end]End: ...[/li][li]Sharable[/li]` (JSON-escaped `[\/li]` in source).
- Series: `<th>Series</th>` heading, then `<table class="series"><tr><th>1.</th><td><div><a href="/forever/quest=ID/slug">Name</a></div></td></tr>...`. The current quest is `<b>Name</b>` (no link). Order = chain order, so prev/next = neighbour rows.
