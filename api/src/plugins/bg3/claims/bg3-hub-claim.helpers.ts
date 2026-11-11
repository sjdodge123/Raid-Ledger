/**
 * ROK-2153 S6 — pure mapping from a BG3 party (the active campaign's newest
 * canonical save) to core claim candidates, and the claim service's errors
 * onto the core claim vocabulary. Candidate id = `<campaignId>:<slotKey>`
 * (spec "BG3 delta"), so a claim aimed at a campaign that is no longer the
 * hub's active one is refused as gone. A save carries no per-slot player
 * identity, so `match` is always null (N3: list only).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  bg3ClassesLabel,
  bg3ClassLabel,
  bg3OriginLabel,
  bg3RaceLabel,
  type Bg3PartyMember,
  type HubClaimCandidate,
} from '@raid-ledger/contract';
import { HubClaimError } from '../../../guilds/claim/hub-claim.errors';
import type { HubClaimProviderStatus } from '../../plugin-host/extension-points';
import { slotKeys } from './bg3-party-slot.helpers';

/** No active campaign (or nothing claimable): the prompt never shows. */
export const NO_CLAIM_STATUS: HubClaimProviderStatus = {
  viewerHasClaim: false,
  unclaimedCount: 0,
  candidates: [],
  claimOptions: 'none',
};

/** The dismissal round: one per active campaign (N4/N5). */
export function bg3DismissScope(campaignId: number): string {
  return `campaign-${campaignId}`;
}

/** "Wood Elf Barbarian" — race + first class, the Party widget's slot label. */
export function bg3SlotName(member: Bg3PartyMember): string {
  const race = bg3RaceLabel(member.race);
  const [first] = member.classes;
  if (first === undefined) return race;
  return `${race} ${bg3ClassLabel({ main: first.main, sub: null })}`;
}

/** One party slot as a core claim candidate. */
export function toBg3Candidate(
  campaignId: number,
  slotKey: string,
  member: Bg3PartyMember,
): HubClaimCandidate {
  const classes = bg3ClassesLabel(member.classes);
  const subtitle = `Level ${member.level} · ${classes} · ${bg3OriginLabel(member.origin)}`;
  return {
    id: `${campaignId}:${slotKey}`,
    name: bg3SlotName(member).slice(0, 100),
    subtitle: subtitle.slice(0, 160),
    avatarUrl: null,
    detailPath: null,
    match: null,
    matchReason: null,
  };
}

/** Each non-summon member with its slot key, in save order. */
export function bg3Slots(
  party: readonly Bg3PartyMember[],
): { slotKey: string; member: Bg3PartyMember }[] {
  const keys = slotKeys(party);
  return party.flatMap((member, i) => {
    const slotKey = keys[i];
    return slotKey === null || slotKey === undefined
      ? []
      : [{ slotKey, member }];
  });
}

/** The party's unclaimed, non-summon slots as candidates. */
export function bg3Candidates(
  campaignId: number,
  party: readonly Bg3PartyMember[],
  claimedSlotKeys: ReadonlySet<string>,
): HubClaimCandidate[] {
  return bg3Slots(party)
    .filter((s) => !claimedSlotKeys.has(s.slotKey))
    .map((s) => toBg3Candidate(campaignId, s.slotKey, s.member));
}

/** `<campaignId>:<slotKey>` back to its parts, or null when malformed. */
export function parseBg3CandidateId(
  candidateId: string,
): { campaignId: number; slotKey: string } | null {
  const m = /^([1-9]\d{0,9}):(.+)$/.exec(candidateId);
  const [, id, slotKey] = m ?? [];
  if (id === undefined || slotKey === undefined) return null;
  const campaignId = Number(id);
  return campaignId <= 2_147_483_647 ? { campaignId, slotKey } : null;
}

export const bg3Gone = () =>
  new HubClaimError('HUB_CLAIM_CANDIDATE_GONE', 'No such party slot');

/** A BG3 access/claim exception as the core claim error (else unchanged). */
export function toHubClaimError(err: unknown): unknown {
  if (err instanceof ConflictException) {
    return err.message === 'already_claimed'
      ? new HubClaimError('HUB_CLAIM_VIEWER_HAS_CLAIM', 'already_claimed')
      : new HubClaimError('HUB_CLAIM_CANDIDATE_TAKEN', 'slot_taken');
  }
  if (err instanceof BadRequestException || err instanceof NotFoundException)
    return bg3Gone();
  if (err instanceof ForbiddenException)
    return new HubClaimError('HUB_CLAIM_FORBIDDEN', 'Hub members only');
  return err;
}
