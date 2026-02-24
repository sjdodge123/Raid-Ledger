/**
 * Static mapping of Classic WoW talent names to their grid positions
 * within each talent tree, used to construct Wowhead talent calculator URLs.
 *
 * Grid positions follow the Wowhead format: row letter (a-g) + column number (1-4).
 * The talent string is built by iterating positions left-to-right, top-to-bottom
 * (a1, a2, a3, a4, b1, b2, ..., g4), with each digit representing points spent.
 * Trees are separated by hyphens.
 *
 * Source: Classic WoW 1.12 talent tree layouts (Vanilla / Era).
 */

/** Grid position in format 'a1' through 'g4' */
type GridPosition = string;

/** Map from talent name → grid position within a single talent tree */
type TreePositionMap = Record<string, GridPosition>;

/** Map from tree name → talent positions for that tree */
type ClassPositionMap = Record<string, TreePositionMap>;

/**
 * All Classic WoW classes and their talent tree position maps.
 * Key = Blizzard API class name (title case).
 * Value = ordered record of tree name → talent-position map.
 */
export const CLASSIC_TALENT_POSITIONS: Record<string, ClassPositionMap> = {
    Druid: {
        Balance: {
            'Improved Wrath': 'a1',
            "Nature's Grasp": 'a2',
            "Improved Nature's Grasp": 'a3',
            'Improved Entangling Roots': 'b1',
            'Improved Moonfire': 'b2',
            'Natural Weapons': 'b3',
            'Natural Shapeshifter': 'b4',
            'Improved Thorns': 'c1',
            'Omen of Clarity': 'c3',
            "Nature's Reach": 'c4',
            'Vengeance': 'd2',
            'Improved Starfire': 'd3',
            "Nature's Grace": 'e2',
            'Moonglow': 'e3',
            'Moonfury': 'f2',
            'Moonkin Form': 'g2',
        },
        'Feral Combat': {
            'Ferocity': 'a2',
            'Feral Aggression': 'a3',
            'Feral Instinct': 'b1',
            'Brutal Impact': 'b2',
            'Thick Hide': 'b3',
            'Feline Swiftness': 'c1',
            'Feral Charge': 'c2',
            'Sharpened Claws': 'c3',
            'Improved Shred': 'd1',
            'Predatory Strikes': 'd2',
            'Blood Frenzy': 'd3',
            'Primal Fury': 'd4',
            'Savage Fury': 'e1',
            'Faerie Fire (Feral)': 'e3',
            'Heart of the Wild': 'f2',
            'Leader of the Pack': 'g2',
        },
        Restoration: {
            'Improved Mark of the Wild': 'a2',
            'Furor': 'a3',
            'Improved Healing Touch': 'b1',
            "Nature's Focus": 'b2',
            'Improved Enrage': 'b3',
            'Reflection': 'c2',
            'Insect Swarm': 'c3',
            'Subtlety': 'c4',
            'Tranquil Spirit': 'd2',
            'Improved Rejuvenation': 'd4',
            "Nature's Swiftness": 'e1',
            'Gift of Nature': 'e3',
            'Improved Tranquility': 'e4',
            'Improved Regrowth': 'f3',
            'Swiftmend': 'g2',
        },
    },
    Hunter: {
        'Beast Mastery': {
            'Improved Aspect of the Hawk': 'a2',
            'Endurance Training': 'a3',
            'Improved Eyes of the Beast': 'b1',
            'Improved Aspect of the Monkey': 'b2',
            'Thick Hide': 'b3',
            'Improved Revive Pet': 'b4',
            'Pathfinding': 'c1',
            'Bestial Swiftness': 'c2',
            'Unleashed Fury': 'c3',
            'Improved Mend Pet': 'd2',
            'Ferocity': 'd3',
            'Spirit Bond': 'e1',
            'Intimidation': 'e2',
            'Bestial Discipline': 'e4',
            'Frenzy': 'f3',
            'Bestial Wrath': 'g2',
        },
        Marksmanship: {
            'Improved Concussive Shot': 'a2',
            'Efficiency': 'a3',
            "Improved Hunter's Mark": 'b2',
            'Lethal Shots': 'b3',
            'Aimed Shot': 'c1',
            'Improved Arcane Shot': 'c2',
            'Hawk Eye': 'c4',
            'Improved Serpent Sting': 'd2',
            'Mortal Shots': 'd3',
            'Scatter Shot': 'e1',
            'Barrage': 'e2',
            'Improved Scorpid Sting': 'e3',
            'Ranged Weapon Specialization': 'f3',
            'Trueshot Aura': 'g2',
        },
        Survival: {
            'Monster Slaying': 'a1',
            'Humanoid Slaying': 'a2',
            'Deflection': 'a3',
            'Entrapment': 'b1',
            'Savage Strikes': 'b2',
            'Improved Wing Clip': 'b3',
            'Clever Traps': 'c1',
            'Survivalist': 'c2',
            'Deterrence': 'c3',
            'Trap Mastery': 'd1',
            'Surefooted': 'd2',
            'Improved Feign Death': 'd4',
            'Killer Instinct': 'e2',
            'Counterattack': 'e3',
            'Lightning Reflexes': 'f3',
            'Wyvern Sting': 'g2',
        },
    },
    Mage: {
        Arcane: {
            'Arcane Subtlety': 'a1',
            'Arcane Focus': 'a2',
            'Improved Arcane Missiles': 'a3',
            'Wand Specialization': 'b1',
            'Magic Absorption': 'b2',
            'Arcane Concentration': 'b3',
            'Magic Attunement': 'c1',
            'Improved Arcane Explosion': 'c2',
            'Arcane Resilience': 'c3',
            'Improved Mana Shield': 'd1',
            'Improved Counterspell': 'd2',
            'Arcane Meditation': 'd4',
            'Presence of Mind': 'e2',
            'Arcane Mind': 'e3',
            'Arcane Instability': 'f2',
            'Arcane Power': 'g2',
        },
        Fire: {
            'Improved Fireball': 'a2',
            'Impact': 'a3',
            'Ignite': 'b1',
            'Flame Throwing': 'b2',
            'Improved Fire Blast': 'b3',
            'Incinerate': 'c1',
            'Improved Flamestrike': 'c2',
            'Pyroblast': 'c3',
            'Burning Soul': 'c4',
            'Improved Scorch': 'd1',
            'Improved Fire Ward': 'd2',
            'Master of Elements': 'd4',
            'Critical Mass': 'e2',
            'Blast Wave': 'e3',
            'Fire Power': 'f3',
            'Combustion': 'g2',
        },
        Frost: {
            'Frost Warding': 'a1',
            'Improved Frostbolt': 'a2',
            'Elemental Precision': 'a3',
            'Ice Shards': 'b1',
            'Frostbite': 'b2',
            'Improved Frost Nova': 'b3',
            'Permafrost': 'b4',
            'Piercing Ice': 'c1',
            'Cold Snap': 'c2',
            'Improved Blizzard': 'c4',
            'Arctic Reach': 'd1',
            'Frost Channeling': 'd2',
            'Shatter': 'd3',
            'Ice Block': 'e2',
            'Improved Cone of Cold': 'e3',
            "Winter's Chill": 'f3',
            'Ice Barrier': 'g2',
        },
    },
    Paladin: {
        Holy: {
            'Divine Strength': 'a2',
            'Divine Intellect': 'a3',
            'Spiritual Focus': 'b2',
            'Improved Seal of Righteousness': 'b3',
            'Healing Light': 'c1',
            'Consecration': 'c2',
            'Improved Lay on Hands': 'c3',
            'Unyielding Faith': 'c4',
            'Illumination': 'd2',
            'Improved Blessing of Wisdom': 'd3',
            'Divine Favor': 'e2',
            'Lasting Judgement': 'e3',
            'Holy Power': 'f3',
            'Holy Shock': 'g2',
        },
        Protection: {
            'Improved Devotion Aura': 'a2',
            'Redoubt': 'a3',
            'Precision': 'b1',
            "Guardian's Favor": 'b2',
            'Toughness': 'b4',
            'Blessing of Kings': 'c1',
            'Improved Righteous Fury': 'c2',
            'Shield Specialization': 'c3',
            'Anticipation': 'c4',
            'Improved Hammer of Justice': 'd2',
            'Improved Concentration Aura': 'd3',
            'Blessing of Sanctuary': 'e2',
            'Reckoning': 'e3',
            'One-Handed Weapon Specialization': 'f3',
            'Holy Shield': 'g2',
        },
        Retribution: {
            'Improved Blessing of Might': 'a2',
            'Benediction': 'a3',
            'Improved Judgement': 'b1',
            'Improved Seal of the Crusader': 'b2',
            'Deflection': 'b3',
            'Vindication': 'c1',
            'Conviction': 'c2',
            'Seal of Command': 'c3',
            'Pursuit of Justice': 'c4',
            'Eye for an Eye': 'd1',
            'Improved Retribution Aura': 'd3',
            'Two-Handed Weapon Specialization': 'e1',
            'Sanctity Aura': 'e3',
            'Vengeance': 'f2',
            'Repentance': 'g2',
        },
    },
    Priest: {
        Discipline: {
            'Unbreakable Will': 'a2',
            'Wand Specialization': 'a3',
            'Silent Resolve': 'b1',
            'Improved Power Word: Fortitude': 'b2',
            'Improved Power Word: Shield': 'b3',
            'Martyrdom': 'b4',
            'Inner Focus': 'c2',
            'Meditation': 'c3',
            'Improved Inner Fire': 'd1',
            'Mental Agility': 'd2',
            'Improved Mana Burn': 'd4',
            'Mental Strength': 'e2',
            'Divine Spirit': 'e3',
            'Force of Will': 'f3',
            'Power Infusion': 'g2',
        },
        Holy: {
            'Healing Focus': 'a1',
            'Improved Renew': 'a2',
            'Holy Specialization': 'a3',
            'Spell Warding': 'b2',
            'Divine Fury': 'b3',
            'Holy Nova': 'c1',
            'Blessed Recovery': 'c2',
            'Inspiration': 'c4',
            'Holy Reach': 'd1',
            'Improved Healing': 'd2',
            'Searing Light': 'd3',
            'Improved Prayer of Healing': 'e1',
            'Spirit of Redemption': 'e2',
            'Spiritual Guidance': 'e3',
            'Spiritual Healing': 'f3',
            'Lightwell': 'g2',
        },
        Shadow: {
            'Spirit Tap': 'a2',
            'Blackout': 'a3',
            'Shadow Affinity': 'b1',
            'Improved Shadow Word: Pain': 'b2',
            'Shadow Focus': 'b3',
            'Improved Psychic Scream': 'c1',
            'Improved Mind Blast': 'c2',
            'Mind Flay': 'c3',
            'Improved Fade': 'd2',
            'Shadow Reach': 'd3',
            'Shadow Weaving': 'd4',
            'Silence': 'e1',
            'Vampiric Embrace': 'e2',
            'Improved Vampiric Embrace': 'e3',
            'Darkness': 'f3',
            'Shadowform': 'g2',
        },
    },
    Rogue: {
        Assassination: {
            'Improved Eviscerate': 'a1',
            'Remorseless Attacks': 'a2',
            'Malice': 'a3',
            'Ruthlessness': 'b1',
            'Murder': 'b2',
            'Improved Slice and Dice': 'b4',
            'Relentless Strikes': 'c1',
            'Improved Expose Armor': 'c2',
            'Lethality': 'c3',
            'Vile Poisons': 'd2',
            'Improved Poisons': 'd3',
            'Cold Blood': 'e2',
            'Improved Kidney Shot': 'e3',
            'Seal Fate': 'f2',
            'Vigor': 'g2',
        },
        Combat: {
            'Improved Gouge': 'a1',
            'Improved Sinister Strike': 'a2',
            'Lightning Reflexes': 'a3',
            'Improved Backstab': 'b1',
            'Deflection': 'b2',
            'Precision': 'b3',
            'Endurance': 'c1',
            'Riposte': 'c2',
            'Improved Sprint': 'c4',
            'Improved Kick': 'd1',
            'Dagger Specialization': 'd2',
            'Dual Wield Specialization': 'd3',
            'Mace Specialization': 'e1',
            'Blade Flurry': 'e2',
            'Sword Specialization': 'e3',
            'Fist Weapon Specialization': 'e4',
            'Weapon Expertise': 'f2',
            'Aggression': 'f3',
            'Adrenaline Rush': 'g2',
        },
        Subtlety: {
            'Master of Deception': 'a2',
            'Opportunity': 'a3',
            'Sleight of Hand': 'b1',
            'Elusiveness': 'b2',
            'Camouflage': 'b3',
            'Initiative': 'c1',
            'Ghostly Strike': 'c2',
            'Improved Ambush': 'c3',
            'Setup': 'd1',
            'Improved Sap': 'd2',
            'Serrated Blades': 'd3',
            'Heightened Senses': 'e1',
            'Preparation': 'e2',
            'Dirty Deeds': 'e3',
            'Hemorrhage': 'e4',
            'Deadliness': 'f3',
            'Premeditation': 'g2',
        },
    },
    Shaman: {
        Elemental: {
            'Convection': 'a2',
            'Concussion': 'a3',
            "Earth's Grasp": 'b1',
            'Elemental Warding': 'b2',
            'Call of Flame': 'b3',
            'Elemental Focus': 'c1',
            'Reverberation': 'c2',
            'Call of Thunder': 'c3',
            'Improved Fire Totems': 'd1',
            'Eye of the Storm': 'd2',
            'Elemental Devastation': 'd4',
            'Storm Reach': 'e1',
            'Elemental Fury': 'e2',
            'Lightning Mastery': 'f3',
            'Elemental Mastery': 'g2',
        },
        Enhancement: {
            'Ancestral Knowledge': 'a2',
            'Shield Specialization': 'a3',
            'Guardian Totems': 'b1',
            'Thundering Strikes': 'b2',
            'Improved Ghost Wolf': 'b3',
            'Improved Lightning Shield': 'b4',
            'Enhancing Totems': 'c1',
            'Two-Handed Axes and Maces': 'c3',
            'Anticipation': 'c4',
            'Flurry': 'd2',
            'Toughness': 'd3',
            'Improved Weapon Totems': 'e1',
            'Elemental Weapons': 'e2',
            'Parry': 'e3',
            'Weapon Mastery': 'f3',
            'Stormstrike': 'g2',
        },
        Restoration: {
            'Improved Healing Wave': 'a2',
            'Tidal Focus': 'a3',
            'Improved Reincarnation': 'b1',
            'Ancestral Healing': 'b2',
            'Totemic Focus': 'b3',
            "Nature's Guidance": 'c1',
            'Healing Focus': 'c2',
            'Totemic Mastery': 'c3',
            'Healing Grace': 'c4',
            'Restorative Totems': 'd2',
            'Tidal Mastery': 'd3',
            'Healing Way': 'e1',
            "Nature's Swiftness": 'e3',
            'Purification': 'f3',
            'Mana Tide Totem': 'g2',
        },
    },
    Warlock: {
        Affliction: {
            'Suppression': 'a2',
            'Improved Corruption': 'a3',
            'Improved Curse of Weakness': 'b1',
            'Improved Drain Soul': 'b2',
            'Improved Life Tap': 'b3',
            'Improved Drain Life': 'b4',
            'Improved Curse of Agony': 'c1',
            'Fel Concentration': 'c2',
            'Amplify Curse': 'c3',
            'Grim Reach': 'd1',
            'Nightfall': 'd2',
            'Improved Drain Mana': 'd4',
            'Siphon Life': 'e2',
            'Curse of Exhaustion': 'e3',
            'Improved Curse of Exhaustion': 'e4',
            'Shadow Mastery': 'f2',
            'Dark Pact': 'g2',
        },
        Demonology: {
            'Improved Healthstone': 'a1',
            'Improved Imp': 'a2',
            'Demonic Embrace': 'a3',
            'Improved Health Funnel': 'b1',
            'Improved Voidwalker': 'b2',
            'Fel Intellect': 'b3',
            'Improved Succubus': 'c1',
            'Fel Domination': 'c2',
            'Fel Stamina': 'c3',
            'Master Summoner': 'd2',
            'Unholy Power': 'd3',
            'Improved Enslave Demon': 'e1',
            'Demonic Sacrifice': 'e2',
            'Improved Firestone': 'e4',
            'Master Demonologist': 'f3',
            'Soul Link': 'g2',
            'Improved Spellstone': 'g3',
        },
        Destruction: {
            'Improved Shadow Bolt': 'a2',
            'Cataclysm': 'a3',
            'Bane': 'b2',
            'Aftermath': 'b3',
            'Improved Firebolt': 'c1',
            'Improved Lash of Pain': 'c2',
            'Devastation': 'c3',
            'Shadowburn': 'c4',
            'Intensity': 'd1',
            'Destructive Reach': 'd2',
            'Improved Searing Pain': 'd4',
            'Pyroclasm': 'e1',
            'Improved Immolate': 'e2',
            'Ruin': 'e3',
            'Emberstorm': 'f3',
            'Conflagrate': 'g2',
        },
    },
    Warrior: {
        Arms: {
            'Improved Heroic Strike': 'a1',
            'Deflection': 'a2',
            'Improved Rend': 'a3',
            'Improved Charge': 'b1',
            'Tactical Mastery': 'b2',
            'Improved Thunder Clap': 'b4',
            'Improved Overpower': 'c1',
            'Anger Management': 'c2',
            'Deep Wounds': 'c3',
            'Two-Handed Weapon Specialization': 'd2',
            'Impale': 'd3',
            'Axe Specialization': 'e1',
            'Sweeping Strikes': 'e2',
            'Mace Specialization': 'e3',
            'Sword Specialization': 'e4',
            'Polearm Specialization': 'f1',
            'Improved Hamstring': 'f3',
            'Mortal Strike': 'g2',
        },
        Fury: {
            'Booming Voice': 'a2',
            'Cruelty': 'a3',
            'Improved Demoralizing Shout': 'b2',
            'Unbridled Wrath': 'b3',
            'Improved Cleave': 'c1',
            'Piercing Howl': 'c2',
            'Blood Craze': 'c3',
            'Improved Battle Shout': 'c4',
            'Dual Wield Specialization': 'd1',
            'Improved Execute': 'd2',
            'Enrage': 'd3',
            'Improved Slam': 'e1',
            'Death Wish': 'e2',
            'Improved Intercept': 'e4',
            'Improved Berserker Rage': 'f1',
            'Flurry': 'f3',
            'Bloodthirst': 'g2',
        },
        Protection: {
            'Shield Specialization': 'a2',
            'Anticipation': 'a3',
            'Improved Bloodrage': 'b1',
            'Toughness': 'b3',
            'Iron Will': 'b4',
            'Last Stand': 'c1',
            'Improved Shield Block': 'c2',
            'Improved Revenge': 'c3',
            'Defiance': 'c4',
            'Improved Sunder Armor': 'd1',
            'Improved Disarm': 'd2',
            'Improved Taunt': 'd3',
            'Improved Shield Wall': 'e1',
            'Concussion Blow': 'e2',
            'Improved Shield Bash': 'e3',
            'One-Handed Weapon Specialization': 'f3',
            'Shield Slam': 'g2',
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
] as const;

/**
 * Build a Wowhead talent string for a single tree from a map of talent names → ranks.
 * Returns a string like "005323105" where each digit is the rank at that grid position.
 */
function buildTreeString(
    treePositionMap: TreePositionMap,
    talentRanks: Record<string, number>,
): string {
    // Invert position map: grid position → talent name
    const posToName: Record<string, string> = {};
    for (const [name, pos] of Object.entries(treePositionMap)) {
        posToName[pos] = name;
    }

    // Build the string by iterating all grid positions
    const digits: number[] = [];
    for (const pos of GRID_POSITIONS) {
        const talentName = posToName[pos];
        if (talentName && talentRanks[talentName]) {
            digits.push(talentRanks[talentName]);
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
 * Converts tierIndex (0-6) + columnIndex (0-3) to grid positions (a1-g4).
 */
function buildTreeStringFromApi(
    talents: ClassicTalentTree['talents'],
): string {
    const digits: number[] = new Array(GRID_POSITIONS.length).fill(0);

    for (const talent of talents) {
        if (talent.rank && talent.rank > 0 && talent.tierIndex != null && talent.columnIndex != null) {
            // tierIndex 0-6 → row a-g, columnIndex 0-3 → column 1-4
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
 * to the static CLASSIC_TALENT_POSITIONS name-based mapping.
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

        // Prefer API positions (tier_index/column_index) over static name mapping
        if (hasApiPositions(treeData.talents)) {
            treeStrings.push(buildTreeStringFromApi(treeData.talents));
        } else {
            // Fallback to static name-based mapping
            const talentRanks: Record<string, number> = {};
            for (const talent of treeData.talents) {
                if (talent.rank && talent.rank > 0) {
                    talentRanks[talent.name] = talent.rank;
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
