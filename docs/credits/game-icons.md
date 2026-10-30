# Third-party art — game-icons.net

The guild crest's preset emblems (ROK-1814) are icons from [game-icons.net](https://game-icons.net),
licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)
(CC BY 3.0). Path data was copied unmodified from the official SVGs in
[github.com/game-icons/icons](https://github.com/game-icons/icons) (`<author>/<slug>.svg`); only the
full-canvas background square is dropped and the glyph is filled with the crest's palette colour.

Attribution is shown in the app as `GUILD_CREST_EMBLEM_CREDIT_LINE` under the crest picker
(`packages/contract/src/guild-crest.schema.ts`). The art lives in
`web/src/components/hub/crest/crest-emblem-art-a.ts` and `crest-emblem-art-b.ts`.

| Emblem id | Author | Source | Licence |
|---|---|---|---|
| `checked-shield` | Lorc | <https://game-icons.net/1x1/lorc/checked-shield.html> | CC BY 3.0 |
| `crossed-swords` | Lorc | <https://game-icons.net/1x1/lorc/crossed-swords.html> | CC BY 3.0 |
| `dragon-head` | Lorc | <https://game-icons.net/1x1/lorc/dragon-head.html> | CC BY 3.0 |
| `wolf-head` | Lorc | <https://game-icons.net/1x1/lorc/wolf-head.html> | CC BY 3.0 |
| `death-skull` | Sbed | <https://game-icons.net/1x1/sbed/death-skull.html> | CC BY 3.0 |
| `oak` | Lorc | <https://game-icons.net/1x1/lorc/oak.html> | CC BY 3.0 |
| `crown` | Lorc | <https://game-icons.net/1x1/lorc/crown.html> | CC BY 3.0 |
| `battle-axe` | Lorc | <https://game-icons.net/1x1/lorc/battle-axe.html> | CC BY 3.0 |
| `eagle-emblem` | Lorc | <https://game-icons.net/1x1/lorc/eagle-emblem.html> | CC BY 3.0 |
| `griffin-symbol` | Delapouite | <https://game-icons.net/1x1/delapouite/griffin-symbol.html> | CC BY 3.0 |
| `fleur-de-lys` | Delapouite | <https://game-icons.net/1x1/delapouite/fleur-de-lys.html> | CC BY 3.0 |
| `flame` | Carl Olsen | <https://game-icons.net/1x1/carl-olsen/flame.html> | CC BY 3.0 |
| `anvil` | Lorc | <https://game-icons.net/1x1/lorc/anvil.html> | CC BY 3.0 |
| `castle` | Delapouite | <https://game-icons.net/1x1/delapouite/castle.html> | CC BY 3.0 |
| `lion` | Lorc | <https://game-icons.net/1x1/lorc/lion.html> | CC BY 3.0 |
| `bear-head` | Delapouite | <https://game-icons.net/1x1/delapouite/bear-head.html> | CC BY 3.0 |

## Authors

- **Lorc** — <http://lorcblog.blogspot.com>
- **Delapouite** — <http://delapouite.com>
- **Sbed** — <http://opengameart.org/content/95-game-icons>
- **Carl Olsen** — <https://twitter.com/unstoppableCarl>

Adding or swapping an emblem: add its id to `GUILD_CREST_EMBLEM_IDS` + `GUILD_CREST_EMBLEM_CREDITS`,
update the credit line if the author is new, add the path to one of the art files, and add a row here.
