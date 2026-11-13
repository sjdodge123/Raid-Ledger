/**
 * ROK-1789 — the "Recruitment" card's header action: a ghost "Edit" for
 * editors (incl. the rank-0 GM, already folded into `viewer.canEdit` by the
 * api — A-D5) once recruitment is set; the unset card carries "Set
 * recruitment". Imported eagerly by `recruitment.register.ts`, so it uses only
 * the light query layer and the dialog store, never the dialog chunk.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { guildRecruitmentQuery } from '../hooks/use-guild-recruitment';
import { useRecruitmentDialog } from './recruitment-dialog-store';

/** Header "Edit" — editors only, and only once recruitment is set. */
export function RecruitmentAction({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useQuery(guildRecruitmentQuery(guildId));
    const open = useRecruitmentDialog((s) => s.open);
    if (data === undefined || !data.viewer.canEdit || data.recruitment === null) return null;
    return (
        <Button variant="ghost" size="sm" data-testid="recruitment-edit" onClick={() => open(guildId)}>
            Edit
        </Button>
    );
}
