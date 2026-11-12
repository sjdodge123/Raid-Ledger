/**
 * ROK-2187 L10 — GG delivery settings: the kill switch, delivery date + hour
 * (community timezone), DM offset after the announcement and an optional
 * announcement channel override (blank = the bot's default channel).
 */
import type { JSX } from 'react';
import { useState } from 'react';
import type { GgAdminSettingsDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { useGgAdminSettings, useUpdateGgAdminSettings } from '../../../hooks/admin/use-gg-admin';
import { toast } from '../../../lib/toast';

type Draft = Omit<GgAdminSettingsDto, 'mascot'>;

function toDraft(s: GgAdminSettingsDto): Draft {
    return { enabled: s.enabled, deliveryDate: s.deliveryDate, deliveryHour: s.deliveryHour, dmOffsetMinutes: s.dmOffsetMinutes, channelId: s.channelId };
}

function DeliveryFields({ d, setD }: { d: Draft; setD: (d: Draft) => void }): JSX.Element {
    return (
    <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Delivery date">
            <Input type="date" data-testid="gg-delivery-date" value={d.deliveryDate} onChange={(e) => setD({ ...d, deliveryDate: e.target.value })} />
        </Field>
        <Field label="Delivery hour (0–23, community time)">
            <Input type="number" min={0} max={23} data-testid="gg-delivery-hour" value={d.deliveryHour}
                onChange={(e) => setD({ ...d, deliveryHour: Number(e.target.value) })} />
        </Field>
        <Field label="DMs start after (minutes)">
            <Input type="number" min={0} max={1440} data-testid="gg-dm-offset" value={d.dmOffsetMinutes}
                onChange={(e) => setD({ ...d, dmOffsetMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Announcement channel ID" hint="Blank = the bot's default channel.">
            <Input inputMode="numeric" data-testid="gg-channel-id" value={d.channelId ?? ''}
                onChange={(e) => setD({ ...d, channelId: e.target.value.trim() === '' ? null : e.target.value.trim() })} />
        </Field>
    </div>
    );
}

function DeliveryForm({ initial }: { initial: GgAdminSettingsDto }): JSX.Element {
    const [d, setD] = useState<Draft>(toDraft(initial));
    const update = useUpdateGgAdminSettings();
    const save = (): void => update.mutate(d, {
        onSuccess: () => toast.success('GG settings saved'),
        onError: (err) => toast.error(err.message),
    });
    return (
        <div className="space-y-4">
            <Switch checked={d.enabled} onChange={(enabled) => setD({ ...d, enabled })} label="Send GG this year" testId="gg-enabled" />
            <DeliveryFields d={d} setD={setD} />
            <Button data-testid="gg-settings-save" loading={update.isPending} onClick={save}>Save settings</Button>
        </div>
    );
}

/** The delivery-settings card of the admin GG panel. */
export function GgDeliverySettings(): JSX.Element {
    const settings = useGgAdminSettings();
    return (
        <section data-testid="gg-delivery-settings" className="bg-panel border border-edge rounded-lg p-4 space-y-3">
            <h3 className="text-base font-semibold text-foreground">Delivery</h3>
            {settings.isLoading && <p className="text-sm text-muted">Loading…</p>}
            {settings.isError && <p role="alert" className="text-sm text-danger">{settings.error.message}</p>}
            {settings.data && <DeliveryForm initial={settings.data} />}
        </section>
    );
}
