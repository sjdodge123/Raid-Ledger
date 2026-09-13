/**
 * Discord message chrome for the ROK-1553 embed wireframe — DEV-ONLY.
 *
 * This mocks the DISCORD client, not the Raid Ledger app, so every colour is
 * a hardcoded Discord hex (`#313338` chat, `#2b2d31` embed, `#5865f2`
 * blurple, `#00a8fc` link). Deliberately NOT `web/src/index.css` tokens —
 * principle P-4 governs the app's own surfaces; this panel is a picture of
 * somebody else's product and must not drift with our theme.
 */
import type { JSX } from 'react';
import type { EmbedButton, EmbedLine, EphemeralModel, WfEmbedModel } from './embed-model';

const TONE: Record<string, string> = {
  normal: '#dbdee1',
  muted: '#949ba4',
  lead: '#f2f3f5',
  warn: '#f0b232',
  mine: '#3ba55d',
  bad: '#f23f43',
};

const BTN: Record<EmbedButton['style'], string> = {
  primary: '#5865f2',
  secondary: '#4e5058',
  success: '#248046',
  danger: '#da373c',
};

/** One description line, coloured by tone. `lead` is the bold answer line. */
function Line({ line }: { line: EmbedLine }): JSX.Element {
  return (
    <div
      data-testid={`de-line-${line.id}`}
      style={{ color: TONE[line.tone ?? 'normal'] }}
      className={`text-[13px] leading-[1.35] ${line.tone === 'lead' ? 'font-semibold' : ''}`}
    >
      {line.text}
    </div>
  );
}

/** A mocked Discord component button. Inert — this is a picture. */
function Button({ b, testId }: { b: EmbedButton; testId: string }): JSX.Element {
  return (
    <span
      data-testid={testId}
      style={{ background: BTN[b.style], opacity: b.disabled ? 0.5 : 1 }}
      className="inline-flex min-h-[32px] items-center rounded-[3px] px-3 text-[13px] font-medium text-white"
    >
      {b.label}
    </span>
  );
}

/** The action row beneath a message. Present only on the target embed. */
export function ActionRow({ buttons, idPrefix }: { buttons: EmbedButton[]; idPrefix: string }): JSX.Element {
  return (
    <div data-testid={`${idPrefix}-action-row`} className="mt-2 flex flex-wrap gap-2">
      {buttons.map((b) => <Button key={b.id} b={b} testId={`${idPrefix}-btn-${b.id}`} />)}
    </div>
  );
}

/** The "Only you can see this" reply that carries per-viewer state (F-16). */
export function Ephemeral({ model, idPrefix }: { model: EphemeralModel; idPrefix: string }): JSX.Element {
  return (
    <div
      data-testid={`${idPrefix}-ephemeral`}
      style={{ background: '#313338', borderColor: '#3f4147' }}
      className="mt-3 rounded border border-dashed p-2.5"
    >
      <div style={{ color: '#949ba4' }} className="flex items-center gap-1.5 text-[11px]">
        <span aria-hidden="true">👁</span> Only you can see this · <span>Dismiss message</span>
      </div>
      <div style={{ color: '#f2f3f5' }} className="mt-1.5 text-[13px] font-semibold">{model.headline}</div>
      <div className="mt-1 space-y-0.5">
        {model.lines.map((l) => <Line key={l.id} line={l} />)}
      </div>
      <ActionRow buttons={model.buttons} idPrefix={`${idPrefix}-eph`} />
    </div>
  );
}

/** The embed card itself: left colour bar, author, title, body, footer. */
function EmbedCard({ m, idPrefix }: { m: WfEmbedModel; idPrefix: string }): JSX.Element {
  return (
    <div
      data-testid={`${idPrefix}-embed`}
      style={{ background: '#2b2d31', borderLeft: `4px solid ${m.color}` }}
      className="mt-1.5 max-w-[520px] rounded-[4px] p-3"
    >
      <div data-testid={`${idPrefix}-author`} style={{ color: '#f2f3f5' }} className="text-[12px] font-semibold">
        {m.authorLine}
      </div>
      <div data-testid={`${idPrefix}-title`} style={{ color: '#00a8fc' }} className="mt-1 text-[15px] font-semibold">
        {m.title}
      </div>
      <div className="mt-1.5 space-y-1">
        {m.lines.map((l) => <Line key={l.id} line={l} />)}
        {m.link && (
          <div data-testid={`${idPrefix}-link`} style={{ color: '#00a8fc' }} className="pt-1 text-[13px]">
            {m.link.label}
          </div>
        )}
      </div>
      <div style={{ color: '#949ba4' }} className="mt-2.5 flex items-center gap-1.5 text-[11px]">
        <span style={{ background: '#4e5058' }} className="h-4 w-4 rounded-full" aria-hidden="true" />
        {m.footer} · Today at 7:41 PM
      </div>
    </div>
  );
}

/**
 * A whole Discord message: bot avatar, name + APP tag, timestamp, the embed,
 * then the action row and ephemeral reply when the grammar carries them.
 */
export function DiscordMessage({ m, idPrefix, width }: {
  m: WfEmbedModel;
  idPrefix: string;
  width: number;
}): JSX.Element {
  return (
    <div
      data-testid={idPrefix}
      style={{ background: '#313338', width, maxWidth: '100%' }}
      className="rounded-lg p-3"
    >
      <div className="flex gap-2.5">
        <span style={{ background: '#5865f2' }} className="mt-0.5 h-9 w-9 shrink-0 rounded-full" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span style={{ color: '#f2f3f5' }} className="text-[15px] font-medium">Raid Ledger</span>
            <span style={{ background: '#5865f2' }} className="rounded-[3px] px-1 text-[10px] font-semibold text-white">
              APP
            </span>
            <span style={{ color: '#949ba4' }} className="text-[11px]">Today at 7:41 PM</span>
          </div>
          <EmbedCard m={m} idPrefix={idPrefix} />
          {m.actionRow && <ActionRow buttons={m.actionRow} idPrefix={idPrefix} />}
          {m.ephemeral && <Ephemeral model={m.ephemeral} idPrefix={idPrefix} />}
        </div>
      </div>
    </div>
  );
}

/** Column header + a one-line caption under a Today / Target stack. */
export function EmbedColumn({ label, caption, tone, children }: {
  label: string;
  caption: string;
  tone: 'today' | 'target';
  children: JSX.Element[];
}): JSX.Element {
  const accent = tone === 'today' ? 'text-amber-300' : 'text-emerald-300';
  return (
    <div data-testid={`de-col-${tone}`} className="rounded-lg border border-edge bg-panel/40 p-3">
      <div className={`text-[10px] uppercase tracking-wider ${accent}`}>{label}</div>
      <div className="mt-2 space-y-3">{children}</div>
      <p data-testid={`de-caption-${tone}`} className="mt-2 text-[11px] text-secondary">{caption}</p>
    </div>
  );
}
