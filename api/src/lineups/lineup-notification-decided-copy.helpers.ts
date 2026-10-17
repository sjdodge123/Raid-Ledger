/**
 * Decided-phase embed copy that adapts to the ROK-1302 scheduling opt-out.
 * Extracted from lineup-notification-embed.helpers.ts to keep that file under
 * the 300-line limit.
 */
export interface DecidedEmbedCopy {
  body: string;
  /** Field heading for threshold-met games. */
  schedulingFieldName: string;
  /** Field heading for below-threshold games. */
  rallyFieldName: string;
}

/** Resolve decided-embed copy for a scheduling-enabled / opted-out lineup. */
export function decidedEmbedCopy(schedulingEnabled: boolean): DecidedEmbedCopy {
  if (schedulingEnabled) {
    return {
      body:
        'Voting is closed. Games that hit the vote threshold are ' +
        '**ready to schedule** — pick a time and play. Games still short ' +
        'on votes can rally more players and join the schedule.',
      schedulingFieldName: '✅ Ready to Schedule',
      rallyFieldName: '\u{1F91D} Almost There — Rally More Players',
    };
  }
  return {
    body:
      'Voting is closed. These are your group’s games — this lineup just ' +
      'picks the game, so there is no scheduling poll.',
    schedulingFieldName: '✅ Your Games',
    rallyFieldName: '\u{1F91D} Also Considered',
  };
}
