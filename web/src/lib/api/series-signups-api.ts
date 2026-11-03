import {
    JoinSeriesResponseSchema,
    LeaveSeriesResponseSchema,
    SeriesSignupStateSchema,
    type JoinSeriesDto,
    type JoinSeriesResponseDto,
    type LeaveSeriesResponseDto,
    type SeriesSignupStateDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

const seriesSignupPath = (eventId: number) => `/events/${eventId}/series/signup`;

/** Membership + the series nights from `eventId` forward (ROK-1728). */
export async function getSeriesSignupState(eventId: number): Promise<SeriesSignupStateDto> {
    return fetchApi(seriesSignupPath(eventId), {}, SeriesSignupStateSchema);
}

/** Joins the series from `eventId` forward with one character / role choice. */
export async function joinSeries(eventId: number, dto: JoinSeriesDto): Promise<JoinSeriesResponseDto> {
    return fetchApi(seriesSignupPath(eventId), { method: 'POST', body: JSON.stringify(dto) }, JoinSeriesResponseSchema);
}

/** Leaves the series: cancels the remaining nights it signed the viewer up for. */
export async function leaveSeries(eventId: number): Promise<LeaveSeriesResponseDto> {
    return fetchApi(seriesSignupPath(eventId), { method: 'DELETE' }, LeaveSeriesResponseSchema);
}
