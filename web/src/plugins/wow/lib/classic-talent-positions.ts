/**
 * Static mapping of TBC WoW talent URL slugs to their grid positions
 * within each talent tree, used to construct Wowhead talent calculator URLs.
 *
 * Grid positions follow the Wowhead format: row letter (a-i) + column number (1-4).
 * The talent string is built by iterating positions left-to-right, top-to-bottom
 * (a1, a2, a3, a4, b1, b2, ..., i4), with each digit representing points spent.
 * Trees are separated by hyphens.
 *
 * Keys are URL slugs derived from Wowhead spell URLs (e.g. "natures-grasp").
 * Matching against Blizzard API talent names is done by normalizing to slug form.
 *
 * Source: Wowhead TBC Classic talent calculator (https://www.wowhead.com/tbc/talent-calc).
 */

/** Grid position in format 'a1' through 'i4' */
type GridPosition = string;

/** Map from talent slug → grid position within a single talent tree */
type TreePositionMap = Record<string, GridPosition>;

/** Map from tree name → talent positions for that tree */
type ClassPositionMap = Record<string, TreePositionMap>;

/**
 * All TBC WoW classes and their talent tree position maps.
 * Key = Blizzard API class name (title case).
 * Value = ordered record of tree name → talent-position map (keyed by URL slug).
 */
export const CLASSIC_TALENT_POSITIONS: Record<string, ClassPositionMap> = {
    Druid: {
        Balance: {
            'starlight-wrath': 'a1',
            'natures-grasp': 'a2',
            'improved-natures-grasp': 'a3',
            'control-of-nature': 'b1',
            'focused-starlight': 'b2',
            'improved-moonfire': 'b3',
            'brambles': 'c1',
            'insect-swarm': 'c3',
            'natures-reach': 'c4',
            'vengeance': 'd2',
            'celestial-focus': 'd3',
            'lunar-guidance': 'e1',
            'natures-grace': 'e2',
            'moonglow': 'e3',
            'moonfury': 'f2',
            'balance-of-power': 'f3',
            'dreamstate': 'g1',
            'moonkin-form': 'g2',
            'improved-faerie-fire': 'g3',
            'wrath-of-cenarius': 'h2',
            'force-of-nature': 'i2',
        },
        'Feral Combat': {
            'ferocity': 'a2',
            'feral-aggression': 'a3',
            'feral-instinct': 'b1',
            'brutal-impact': 'b2',
            'thick-hide': 'b3',
            'feral-swiftness': 'c1',
            'feral-charge': 'c2',
            'sharpened-claws': 'c3',
            'shredding-attacks': 'd1',
            'predatory-strikes': 'd2',
            'primal-fury': 'd3',
            'savage-fury': 'e1',
            'faerie-fire-feral': 'e3',
            'nurturing-instinct': 'e4',
            'heart-of-the-wild': 'f2',
            'survival-of-the-fittest': 'f3',
            'primal-tenacity': 'g1',
            'leader-of-the-pack': 'g2',
            'improved-leader-of-the-pack': 'g3',
            'predatory-instincts': 'h3',
            'mangle': 'i2',
        },
        Restoration: {
            'improved-mark-of-the-wild': 'a2',
            'furor': 'a3',
            'naturalist': 'b1',
            'natures-focus': 'b2',
            'natural-shapeshifter': 'b3',
            'intensity': 'c1',
            'subtlety': 'c2',
            'omen-of-clarity': 'c3',
            'tranquil-spirit': 'd2',
            'improved-rejuvenation': 'd3',
            'natures-swiftness': 'e1',
            'gift-of-nature': 'e2',
            'improved-tranquility': 'e4',
            'empowered-touch': 'f1',
            'improved-regrowth': 'f3',
            'living-spirit': 'g1',
            'swiftmend': 'g2',
            'natural-perfection': 'g3',
            'empowered-rejuvenation': 'h2',
            'tree-of-life': 'i2',
        },
    },
    Hunter: {
        'Beast Mastery': {
            'improved-aspect-of-the-hawk': 'a2',
            'endurance-training': 'a3',
            'focused-fire': 'b1',
            'improved-aspect-of-the-monkey': 'b2',
            'thick-hide': 'b3',
            'improved-revive-pet': 'b4',
            'pathfinding': 'c1',
            'bestial-swiftness': 'c2',
            'unleashed-fury': 'c3',
            'improved-mend-pet': 'd2',
            'ferocity': 'd3',
            'spirit-bond': 'e1',
            'intimidation': 'e2',
            'bestial-discipline': 'e4',
            'animal-handler': 'f1',
            'frenzy': 'f3',
            'ferocious-inspiration': 'g1',
            'bestial-wrath': 'g2',
            'catlike-reflexes': 'g3',
            'serpents-swiftness': 'h3',
            'the-beast-within': 'i2',
        },
        Marksmanship: {
            'improved-concussive-shot': 'a2',
            'lethal-shots': 'a3',
            'go-for-the-throat': 'c1',
            'improved-hunters-mark': 'b2',
            'efficiency': 'b3',
            'improved-arcane-shot': 'c2',
            'aimed-shot': 'c3',
            'rapid-killing': 'c4',
            'improved-stings': 'd2',
            'mortal-shots': 'd3',
            'concussive-barrage': 'e1',
            'scatter-shot': 'e2',
            'barrage': 'e3',
            'combat-experience': 'f1',
            'ranged-weapon-specialization': 'f4',
            'careful-aim': 'g1',
            'trueshot-aura': 'g2',
            'improved-barrage': 'g3',
            'master-marksman': 'h2',
            'silencing-shot': 'i2',
        },
        Survival: {
            'monster-slaying': 'a1',
            'humanoid-slaying': 'a2',
            'hawk-eye': 'a3',
            'savage-strikes': 'a4',
            'entrapment': 'b1',
            'deflection': 'b2',
            'improved-wing-clip': 'b3',
            'clever-traps': 'c1',
            'survivalist': 'c2',
            'deterrence': 'c3',
            'trap-mastery': 'd1',
            'surefooted': 'd2',
            'improved-feign-death': 'd4',
            'survival-instincts': 'e1',
            'killer-instinct': 'e2',
            'counterattack': 'e3',
            'resourcefulness': 'f1',
            'lightning-reflexes': 'f3',
            'thrill-of-the-hunt': 'g1',
            'wyvern-sting': 'g2',
            'expose-weakness': 'g3',
            'master-tactician': 'h2',
            'readiness': 'i2',
        },
    },
    Mage: {
        Arcane: {
            'arcane-subtlety': 'a1',
            'arcane-focus': 'a2',
            'improved-arcane-missiles': 'a3',
            'wand-specialization': 'b1',
            'magic-absorption': 'b2',
            'arcane-concentration': 'b3',
            'magic-attunement': 'c1',
            'arcane-impact': 'c2',
            'arcane-fortitude': 'c4',
            'improved-mana-shield': 'd1',
            'improved-counterspell': 'd2',
            'arcane-meditation': 'd4',
            'improved-blink': 'e1',
            'presence-of-mind': 'e2',
            'arcane-mind': 'e4',
            'prismatic-cloak': 'f1',
            'arcane-instability': 'f2',
            'arcane-potency': 'f3',
            'empowered-arcane-missiles': 'g1',
            'arcane-power': 'g2',
            'spell-power': 'g3',
            'mind-mastery': 'h2',
            'slow': 'i2',
        },
        Fire: {
            'improved-fireball': 'a2',
            'impact': 'a3',
            'ignite': 'b1',
            'flame-throwing': 'b2',
            'improved-fire-blast': 'b3',
            'incineration': 'c1',
            'improved-flamestrike': 'c2',
            'pyroblast': 'c3',
            'burning-soul': 'c4',
            'improved-scorch': 'd1',
            'molten-shields': 'd2',
            'master-of-elements': 'd4',
            'playing-with-fire': 'e1',
            'critical-mass': 'e2',
            'blast-wave': 'e3',
            'blazing-speed': 'f1',
            'fire-power': 'f3',
            'pyromaniac': 'g1',
            'combustion': 'g2',
            'molten-fury': 'g3',
            'empowered-fireball': 'h3',
            'dragons-breath': 'i2',
        },
        Frost: {
            'frost-warding': 'a1',
            'improved-frostbolt': 'a2',
            'elemental-precision': 'a3',
            'ice-shards': 'b1',
            'frostbite': 'b2',
            'improved-frost-nova': 'b3',
            'permafrost': 'b4',
            'piercing-ice': 'c1',
            'icy-veins': 'c2',
            'improved-blizzard': 'c4',
            'arctic-reach': 'd1',
            'frost-channeling': 'd2',
            'shatter': 'd3',
            'frozen-core': 'e1',
            'cold-snap': 'e2',
            'improved-cone-of-cold': 'e3',
            'ice-floes': 'f1',
            'winters-chill': 'f3',
            'ice-barrier': 'g2',
            'arctic-winds': 'g3',
            'empowered-frostbolt': 'h2',
            'summon-water-elemental': 'i2',
        },
    },
    Paladin: {
        Holy: {
            'divine-strength': 'a2',
            'divine-intellect': 'a3',
            'spiritual-focus': 'b2',
            'improved-seal-of-righteousness': 'b3',
            'healing-light': 'c1',
            'aura-mastery': 'c2',
            'improved-lay-on-hands': 'c3',
            'unyielding-faith': 'c4',
            'illumination': 'd2',
            'improved-blessing-of-wisdom': 'd3',
            'pure-of-heart': 'e1',
            'divine-favor': 'e2',
            'sanctified-light': 'e3',
            'purifying-power': 'f1',
            'holy-power': 'f3',
            'lights-grace': 'g1',
            'holy-shock': 'g2',
            'blessed-life': 'g3',
            'holy-guidance': 'h2',
            'divine-illumination': 'i2',
        },
        Protection: {
            'improved-devotion-aura': 'a2',
            'redoubt': 'a3',
            'precision': 'b1',
            'guardians-favor': 'b2',
            'toughness': 'b4',
            'blessing-of-kings': 'c1',
            'improved-righteous-fury': 'c2',
            'shield-specialization': 'c3',
            'anticipation': 'c4',
            'stoicism': 'd1',
            'improved-hammer-of-justice': 'd2',
            'improved-concentration-aura': 'd3',
            'spell-warding': 'e1',
            'blessing-of-sanctuary': 'e2',
            'reckoning': 'e3',
            'sacred-duty': 'f1',
            'one-handed-weapon-specialization': 'f3',
            'improved-holy-shield': 'g1',
            'holy-shield': 'g2',
            'ardent-defender': 'g3',
            'combat-expertise': 'h3',
            'avengers-shield': 'i2',
        },
        Retribution: {
            'improved-blessing-of-might': 'a2',
            'benediction': 'a3',
            'improved-judgement': 'b1',
            'improved-seal-of-the-crusader': 'b2',
            'deflection': 'b3',
            'vindication': 'c1',
            'conviction': 'c2',
            'seal-of-command': 'c3',
            'pursuit-of-justice': 'c4',
            'eye-for-an-eye': 'd1',
            'improved-retribution-aura': 'd3',
            'crusade': 'd4',
            'two-handed-weapon-specialization': 'e1',
            'sanctity-aura': 'e3',
            'improved-sanctity-aura': 'e4',
            'vengeance': 'f2',
            'sanctified-judgement': 'f3',
            'sanctified-seals': 'g1',
            'repentance': 'g2',
            'divine-purpose': 'g3',
            'fanaticism': 'h2',
            'crusader-strike': 'i2',
        },
    },
    Priest: {
        Discipline: {
            'unbreakable-will': 'a2',
            'wand-specialization': 'a3',
            'silent-resolve': 'b1',
            'improved-power-word-fortitude': 'b2',
            'improved-power-word-shield': 'b3',
            'martyrdom': 'b4',
            'absolution': 'c1',
            'inner-focus': 'c2',
            'meditation': 'c3',
            'improved-inner-fire': 'd1',
            'mental-agility': 'd2',
            'improved-mana-burn': 'd4',
            'mental-strength': 'e2',
            'divine-spirit': 'e3',
            'improved-divine-spirit': 'e4',
            'focused-power': 'f1',
            'force-of-will': 'f3',
            'focused-will': 'g1',
            'power-infusion': 'g2',
            'reflective-shield': 'g3',
            'enlightenment': 'h2',
            'pain-suppression': 'i2',
        },
        Holy: {
            'healing-focus': 'a1',
            'improved-renew': 'a2',
            'holy-specialization': 'a3',
            'spell-warding': 'b2',
            'divine-fury': 'b3',
            'holy-nova': 'c1',
            'blessed-recovery': 'c2',
            'inspiration': 'c4',
            'holy-reach': 'd1',
            'improved-healing': 'd2',
            'searing-light': 'd3',
            'healing-prayers': 'e1',
            'spirit-of-redemption': 'e2',
            'spiritual-guidance': 'e3',
            'surge-of-light': 'f1',
            'spiritual-healing': 'f3',
            'holy-concentration': 'g1',
            'lightwell': 'g2',
            'blessed-resilience': 'g3',
            'empowered-healing': 'h2',
            'circle-of-healing': 'i2',
        },
        Shadow: {
            'spirit-tap': 'a2',
            'blackout': 'a3',
            'shadow-affinity': 'b1',
            'improved-shadow-word-pain': 'b2',
            'shadow-focus': 'b3',
            'improved-psychic-scream': 'c1',
            'improved-mind-blast': 'c2',
            'mind-flay': 'c3',
            'improved-fade': 'd2',
            'shadow-reach': 'd3',
            'shadow-weaving': 'd4',
            'silence': 'e1',
            'vampiric-embrace': 'e2',
            'improved-vampiric-embrace': 'e3',
            'focused-mind': 'e4',
            'shadow-resilience': 'f1',
            'darkness': 'f3',
            'shadowform': 'g2',
            'shadow-power': 'g3',
            'misery': 'h3',
            'vampiric-touch': 'i2',
        },
    },
    Rogue: {
        Assassination: {
            'improved-eviscerate': 'a1',
            'remorseless-attacks': 'a2',
            'malice': 'a3',
            'ruthlessness': 'b1',
            'murder': 'b2',
            'puncturing-wounds': 'b4',
            'relentless-strikes': 'c1',
            'improved-expose-armor': 'c2',
            'lethality': 'c3',
            'vile-poisons': 'd2',
            'improved-poisons': 'd3',
            'fleet-footed': 'e1',
            'cold-blood': 'e2',
            'improved-kidney-shot': 'e3',
            'quick-recovery': 'e4',
            'seal-fate': 'f2',
            'master-poisoner': 'f3',
            'deadened-nerves': 'g3',
            'vigor': 'g2',
            'find-weakness': 'h3',
            'mutilate': 'i2',
        },
        Combat: {
            'improved-gouge': 'a1',
            'improved-sinister-strike': 'a2',
            'lightning-reflexes': 'a3',
            'improved-slice-and-dice': 'b1',
            'deflection': 'b2',
            'precision': 'b3',
            'endurance': 'c1',
            'riposte': 'c2',
            'improved-sprint': 'c4',
            'improved-kick': 'd1',
            'dagger-specialization': 'd2',
            'dual-wield-specialization': 'd3',
            'mace-specialization': 'e1',
            'blade-flurry': 'e2',
            'sword-specialization': 'e3',
            'fist-weapon-specialization': 'e4',
            'blade-twisting': 'f1',
            'weapon-expertise': 'f2',
            'aggression': 'f3',
            'vitality': 'g1',
            'adrenaline-rush': 'g2',
            'nerves-of-steel': 'g3',
            'combat-potency': 'h3',
            'surprise-attacks': 'i2',
        },
        Subtlety: {
            'master-of-deception': 'a2',
            'opportunity': 'a3',
            'sleight-of-hand': 'b1',
            'dirty-tricks': 'b2',
            'camouflage': 'b3',
            'initiative': 'c1',
            'ghostly-strike': 'c2',
            'improved-ambush': 'c3',
            'setup': 'd1',
            'elusiveness': 'd2',
            'serrated-blades': 'd3',
            'heightened-senses': 'e1',
            'preparation': 'e2',
            'dirty-deeds': 'e3',
            'hemorrhage': 'e4',
            'master-of-subtlety': 'f1',
            'deadliness': 'f3',
            'enveloping-shadows': 'g1',
            'premeditation': 'g2',
            'cheat-death': 'g3',
            'sinister-calling': 'h2',
            'shadowstep': 'i2',
        },
    },
    Shaman: {
        Elemental: {
            'convection': 'a2',
            'concussion': 'a3',
            'earths-grasp': 'b1',
            'elemental-warding': 'b2',
            'call-of-flame': 'b3',
            'elemental-focus': 'c1',
            'reverberation': 'c2',
            'call-of-thunder': 'c3',
            'improved-fire-totems': 'd1',
            'eye-of-the-storm': 'd2',
            'elemental-devastation': 'd4',
            'storm-reach': 'e1',
            'elemental-fury': 'e2',
            'unrelenting-storm': 'e4',
            'elemental-precision': 'f1',
            'lightning-mastery': 'f3',
            'elemental-mastery': 'g2',
            'elemental-shields': 'g3',
            'lightning-overload': 'h2',
            'totem-of-wrath': 'i2',
        },
        Enhancement: {
            'ancestral-knowledge': 'a2',
            'shield-specialization': 'a3',
            'guardian-totems': 'b1',
            'thundering-strikes': 'b2',
            'improved-ghost-wolf': 'b3',
            'improved-lightning-shield': 'b4',
            'enhancing-totems': 'c1',
            'shamanistic-focus': 'c3',
            'anticipation': 'c4',
            'flurry': 'd2',
            'toughness': 'd3',
            'improved-weapon-totems': 'e1',
            'spirit-weapons': 'e2',
            'elemental-weapons': 'e3',
            'mental-quickness': 'f1',
            'weapon-mastery': 'f4',
            'dual-wield-specialization': 'g1',
            'dual-wield': 'g2',
            'stormstrike': 'g3',
            'unleashed-rage': 'h2',
            'shamanistic-rage': 'i2',
        },
        Restoration: {
            'improved-healing-wave': 'a2',
            'tidal-focus': 'a3',
            'improved-reincarnation': 'b1',
            'ancestral-healing': 'b2',
            'totemic-focus': 'b3',
            'natures-guidance': 'c1',
            'healing-focus': 'c2',
            'totemic-mastery': 'c3',
            'healing-grace': 'c4',
            'restorative-totems': 'd2',
            'tidal-mastery': 'd3',
            'healing-way': 'e1',
            'natures-swiftness': 'e3',
            'focused-mind': 'e4',
            'purification': 'f3',
            'mana-tide-totem': 'g2',
            'natures-guardian': 'g3',
            'natures-blessing': 'h2',
            'improved-chain-heal': 'h3',
            'earth-shield': 'i2',
        },
    },
    Warlock: {
        Affliction: {
            'suppression': 'a2',
            'improved-corruption': 'a3',
            'improved-curse-of-weakness': 'b1',
            'improved-drain-soul': 'b2',
            'improved-life-tap': 'b3',
            'soul-siphon': 'b4',
            'improved-curse-of-agony': 'c1',
            'fel-concentration': 'c2',
            'amplify-curse': 'c3',
            'grim-reach': 'd1',
            'nightfall': 'd2',
            'empowered-corruption': 'd4',
            'shadow-embrace': 'e1',
            'siphon-life': 'e2',
            'curse-of-exhaustion': 'e3',
            'shadow-mastery': 'f2',
            'contagion': 'g2',
            'dark-pact': 'g3',
            'improved-howl-of-terror': 'h1',
            'malediction': 'h3',
            'unstable-affliction': 'i2',
        },
        Demonology: {
            'improved-healthstone': 'a1',
            'improved-imp': 'a2',
            'demonic-embrace': 'a3',
            'improved-health-funnel': 'b1',
            'improved-voidwalker': 'b2',
            'fel-intellect': 'b3',
            'improved-sayaad': 'c1',
            'fel-domination': 'c2',
            'fel-stamina': 'c3',
            'demonic-aegis': 'c4',
            'master-summoner': 'd2',
            'unholy-power': 'd3',
            'improved-subjugate-demon': 'e1',
            'demonic-sacrifice': 'e2',
            'master-conjuror': 'e4',
            'mana-feed': 'f1',
            'master-demonologist': 'f3',
            'demonic-resilience': 'g1',
            'soul-link': 'g2',
            'demonic-knowledge': 'g3',
            'demonic-tactics': 'h2',
            'summon-felguard': 'i2',
        },
        Destruction: {
            'improved-shadow-bolt': 'a2',
            'cataclysm': 'a3',
            'bane': 'b2',
            'aftermath': 'b3',
            'improved-firebolt': 'c1',
            'improved-lash-of-pain': 'c2',
            'devastation': 'c3',
            'shadowburn': 'c4',
            'intensity': 'd1',
            'destructive-reach': 'd2',
            'improved-searing-pain': 'd4',
            'pyroclasm': 'e1',
            'improved-immolate': 'e2',
            'ruin': 'e3',
            'nether-protection': 'f1',
            'emberstorm': 'f3',
            'backlash': 'g1',
            'conflagrate': 'g2',
            'soul-leech': 'g3',
            'shadow-and-flame': 'h2',
            'shadowfury': 'i2',
        },
    },
    Warrior: {
        Arms: {
            'improved-heroic-strike': 'a1',
            'deflection': 'a2',
            'improved-rend': 'a3',
            'improved-charge': 'b1',
            'iron-will': 'b2',
            'improved-thunder-clap': 'b3',
            'improved-overpower': 'c1',
            'anger-management': 'c2',
            'deep-wounds': 'c3',
            'two-handed-weapon-specialization': 'd2',
            'impale': 'd3',
            'poleaxe-specialization': 'e1',
            'death-wish': 'e2',
            'mace-specialization': 'e3',
            'sword-specialization': 'e4',
            'improved-intercept': 'f1',
            'improved-hamstring': 'f3',
            'improved-disciplines': 'f4',
            'blood-frenzy': 'g1',
            'mortal-strike': 'g2',
            'second-wind': 'g3',
            'improved-mortal-strike': 'h2',
            'endless-rage': 'i2',
        },
        Fury: {
            'booming-voice': 'a2',
            'cruelty': 'a3',
            'improved-demoralizing-shout': 'b2',
            'unbridled-wrath': 'b3',
            'improved-cleave': 'c1',
            'piercing-howl': 'c2',
            'blood-craze': 'c3',
            'commanding-presence': 'c4',
            'dual-wield-specialization': 'd1',
            'improved-execute': 'd2',
            'enrage': 'd3',
            'improved-slam': 'e1',
            'sweeping-strikes': 'e2',
            'weapon-mastery': 'e4',
            'improved-berserker-rage': 'f1',
            'flurry': 'f3',
            'precision': 'g1',
            'bloodthirst': 'g2',
            'improved-whirlwind': 'g3',
            'improved-berserker-stance': 'h3',
            'rampage': 'i2',
        },
        Protection: {
            'improved-bloodrage': 'a1',
            'tactical-mastery': 'a2',
            'anticipation': 'a3',
            'shield-specialization': 'b2',
            'toughness': 'b3',
            'last-stand': 'c1',
            'improved-shield-block': 'c2',
            'improved-revenge': 'c3',
            'defiance': 'c4',
            'improved-sunder-armor': 'd1',
            'improved-disarm': 'd2',
            'improved-taunt': 'd3',
            'improved-shield-wall': 'e1',
            'concussion-blow': 'e2',
            'improved-shield-bash': 'e3',
            'shield-mastery': 'f1',
            'one-handed-weapon-specialization': 'f3',
            'improved-defensive-stance': 'g1',
            'shield-slam': 'g2',
            'focused-rage': 'g3',
            'vitality': 'h2',
            'devastate': 'i2',
        },
    },
};

/** Ordered list of all grid positions in a talent tree (left-to-right, top-to-bottom) */
const GRID_POSITIONS = [
    'a1', 'a2', 'a3', 'a4',
    'b1', 'b2', 'b3', 'b4',
    'c1', 'c2', 'c3', 'c4',
    'd1', 'd2', 'd3', 'd4',
    'e1', 'e2', 'e3', 'e4',
    'f1', 'f2', 'f3', 'f4',
    'g1', 'g2', 'g3', 'g4',
    'h1', 'h2', 'h3', 'h4',
    'i1', 'i2', 'i3', 'i4',
] as const;

/**
 * Normalize a Blizzard API talent name to a URL slug for matching.
 * "Nature's Grasp" → "natures-grasp"
 * "Faerie Fire (Feral)" → "faerie-fire-feral"
 * "Improved Power Word: Shield" → "improved-power-word-shield"
 */
function nameToSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[':]/g, '')       // strip apostrophes and colons
        .replace(/[()]/g, '')       // strip parentheses
        .replace(/\s+/g, '-')       // spaces → hyphens
        .replace(/-+/g, '-')        // collapse multiple hyphens
        .replace(/^-|-$/g, '');     // trim leading/trailing hyphens
}

/**
 * Build a Wowhead talent string for a single tree from a map of talent slugs → ranks.
 * Returns a string like "005323105" where each digit is the rank at that grid position.
 */
function buildTreeString(
    treePositionMap: TreePositionMap,
    talentRanks: Record<string, number>,
): string {
    // Invert position map: grid position → talent slug
    const posToSlug: Record<string, string> = {};
    for (const [slug, pos] of Object.entries(treePositionMap)) {
        posToSlug[pos] = slug;
    }

    // Build the string by iterating all grid positions
    const digits: number[] = [];
    for (const pos of GRID_POSITIONS) {
        const talentSlug = posToSlug[pos];
        if (talentSlug && talentRanks[talentSlug]) {
            digits.push(talentRanks[talentSlug]);
        } else {
            digits.push(0);
        }
    }

    // Trim trailing zeros
    let str = digits.join('');
    str = str.replace(/0+$/, '');
    return str || '0';
}

/**
 * Classic talent data shape matching what the Blizzard service returns.
 */
interface ClassicTalentTree {
    name: string;
    spentPoints: number;
    talents: Array<{
        name: string;
        rank?: number;
        tierIndex?: number;
        columnIndex?: number;
    }>;
}

/**
 * Build a tree string directly from API tier/column positions.
 * Converts tierIndex (0-8) + columnIndex (0-3) to grid positions (a1-i4).
 */
function buildTreeStringFromApi(
    talents: ClassicTalentTree['talents'],
): string {
    const digits: number[] = new Array(GRID_POSITIONS.length).fill(0);

    for (const talent of talents) {
        if (talent.rank && talent.rank > 0 && talent.tierIndex != null && talent.columnIndex != null) {
            const pos = String.fromCharCode(97 + talent.tierIndex) + (talent.columnIndex + 1);
            const idx = GRID_POSITIONS.indexOf(pos as typeof GRID_POSITIONS[number]);
            if (idx >= 0) {
                digits[idx] = talent.rank;
            }
        }
    }

    let str = digits.join('');
    str = str.replace(/0+$/, '');
    return str || '0';
}

/**
 * Check if a tree's talents have API position data (tierIndex/columnIndex).
 */
function hasApiPositions(talents: ClassicTalentTree['talents']): boolean {
    const ranked = talents.filter((t) => t.rank && t.rank > 0);
    if (ranked.length === 0) return false;
    return ranked.every((t) => t.tierIndex != null && t.columnIndex != null);
}

/**
 * Build a complete Wowhead talent string from Classic talent data.
 * Returns a string like "05230051-33200520200501-05" or null if the class is unknown.
 *
 * Prefers API-provided tier/column positions when available, falling back
 * to the static CLASSIC_TALENT_POSITIONS slug-based mapping.
 *
 * @param className - Blizzard API class name (e.g. "Warrior", "Priest")
 * @param trees - Talent tree data from the Blizzard API
 */
export function buildWowheadTalentString(
    className: string,
    trees: ClassicTalentTree[],
): string | null {
    const classPositions = CLASSIC_TALENT_POSITIONS[className];
    if (!classPositions) return null;

    // Build the ordered tree strings. The tree order must match Wowhead's expected
    // order, which is the order defined in CLASSIC_TALENT_POSITIONS (matches the
    // standard Blizzard tree ordering: first/second/third spec tree).
    const treeOrder = Object.keys(classPositions);
    const treeStrings: string[] = [];

    for (const treeName of treeOrder) {
        const positionMap = classPositions[treeName];
        // Find matching tree data from Blizzard API (match by name)
        const treeData = trees.find(
            (t) => t.name === treeName || t.name.toLowerCase() === treeName.toLowerCase(),
        );

        if (!treeData) {
            treeStrings.push('0');
            continue;
        }

        // Prefer API positions (tier_index/column_index) over static slug mapping
        if (hasApiPositions(treeData.talents)) {
            treeStrings.push(buildTreeStringFromApi(treeData.talents));
        } else {
            // Fallback to static slug-based mapping:
            // Convert API talent names to slugs and match against position map
            const talentRanks: Record<string, number> = {};
            for (const talent of treeData.talents) {
                if (talent.rank && talent.rank > 0) {
                    const slug = nameToSlug(talent.name);
                    talentRanks[slug] = talent.rank;
                }
            }
            treeStrings.push(buildTreeString(positionMap, talentRanks));
        }
    }

    // Trim trailing "0" trees
    while (treeStrings.length > 1 && treeStrings[treeStrings.length - 1] === '0') {
        treeStrings.pop();
    }

    return treeStrings.join('-');
}
