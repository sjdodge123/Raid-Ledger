import type {
    CreateTemplateDto,
    TemplateResponseDto,
    TemplateListResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch all event templates */
export async function getEventTemplates(): Promise<TemplateListResponseDto> {
    return fetchApi<TemplateListResponseDto>('/event-templates');
}

/** Create a new event template */
export async function createEventTemplate(
    dto: CreateTemplateDto,
): Promise<TemplateResponseDto> {
    return fetchApi<TemplateResponseDto>('/event-templates', {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

/** Delete an event template */
export async function deleteEventTemplate(
    id: number,
): Promise<void> {
    await fetchApi(`/event-templates/${id}`, { method: 'DELETE' });
}
