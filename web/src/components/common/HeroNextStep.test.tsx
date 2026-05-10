/**
 * Tests for HeroNextStep (ROK-1209).
 *
 * Productionized from `web/src/dev/lineup-wireframes/HeroNextStep.tsx`.
 * Four tones (action / waiting / aborted / privacy), CTA + secondary slots,
 * IntersectionObserver-driven compact mode for mobile sticky.
 *
 * AC-14, AC-16, AC-17, AC-18.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroNextStep } from './HeroNextStep';

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

interface FakeObserverHandle {
  callback: ObserverCallback;
  disconnect: () => void;
  observe: (target: Element) => void;
  unobserve: (target: Element) => void;
}

let observers: FakeObserverHandle[] = [];

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];
  private cb: ObserverCallback;
  constructor(cb: ObserverCallback) {
    this.cb = cb;
    const handle: FakeObserverHandle = {
      callback: cb,
      disconnect: () => {},
      observe: () => {},
      unobserve: () => {},
    };
    observers.push(handle);
  }
  disconnect = (): void => {};
  observe = (target: Element): void => { void target; };
  takeRecords = (): IntersectionObserverEntry[] => [];
  unobserve = (target: Element): void => { void target; };
}

beforeEach(() => {
  observers = [];
  // jsdom doesn't ship IntersectionObserver — provide a controllable fake.
  (globalThis as unknown as { IntersectionObserver: typeof FakeIntersectionObserver }).IntersectionObserver =
    FakeIntersectionObserver;
});

afterEach(() => {
  observers = [];
});

/** Trigger the latest observer with a synthetic entry. */
function triggerObserver(isIntersecting: boolean): void {
  const handle = observers[observers.length - 1];
  if (!handle) throw new Error('No observers registered yet');
  handle.callback([
    { isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry,
  ]);
}

describe('HeroNextStep — four tones rendered', () => {
  it('renders action tone', () => {
    render(<HeroNextStep tone="action" headline="Nominate" />);
    const root = screen.getByTestId('hero-next-step');
    expect(root).toHaveAttribute('data-tone', 'action');
  });

  it('renders waiting tone', () => {
    render(<HeroNextStep tone="waiting" headline="Sit tight" />);
    expect(screen.getByTestId('hero-next-step')).toHaveAttribute(
      'data-tone',
      'waiting',
    );
  });

  it('renders aborted tone', () => {
    render(<HeroNextStep tone="aborted" headline="Lineup cancelled" />);
    expect(screen.getByTestId('hero-next-step')).toHaveAttribute(
      'data-tone',
      'aborted',
    );
  });

  it('renders privacy tone', () => {
    render(<HeroNextStep tone="privacy" headline="Read-only" />);
    expect(screen.getByTestId('hero-next-step')).toHaveAttribute(
      'data-tone',
      'privacy',
    );
  });
});

describe('HeroNextStep — CTA wiring (AC-16)', () => {
  it("invokes the CTA's onClick when the primary button is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <HeroNextStep
        tone="action"
        headline="Nominate"
        cta={{ text: 'Nominate a game', onClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /nominate a game/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('invokes the secondary onClick when the secondary button is clicked', async () => {
    const user = userEvent.setup();
    const onSecondaryClick = vi.fn();
    render(
      <HeroNextStep
        tone="waiting"
        headline="You voted"
        secondary={{ text: 'Change my votes', onClick: onSecondaryClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /change my votes/i }));
    expect(onSecondaryClick).toHaveBeenCalledTimes(1);
  });

  it('renders disabled state with tooltip when CTA.disabled = true (privacy persona)', () => {
    render(
      <HeroNextStep
        tone="privacy"
        headline="Read-only"
        cta={{
          text: 'Request invite',
          onClick: () => {},
          disabled: true,
          tooltip: 'Coming soon — message the creator directly',
        }}
      />,
    );
    const btn = screen.getByRole('button', { name: /request invite/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      'title',
      'Coming soon — message the creator directly',
    );
  });

  it('uses an explicit aria-label on the CTA when provided', () => {
    render(
      <HeroNextStep
        tone="action"
        headline="Nominate"
        cta={{
          text: 'Nominate a game',
          onClick: () => {},
          ariaLabel: 'Open the nomination modal',
        }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /open the nomination modal/i }),
    ).toBeInTheDocument();
  });
});

describe('HeroNextStep — sticky compact mode (AC-18)', () => {
  it("flips compact when the sentinel leaves the viewport", () => {
    render(
      <HeroNextStep
        tone="action"
        headline="Nominate"
        cta={{ text: 'Nominate', onClick: () => {} }}
      />,
    );
    // Sentinel registered with our fake IO.
    expect(observers.length).toBeGreaterThan(0);

    // Initially not scrolled past — full hero shows the headline copy.
    const before = screen.getByTestId('hero-next-step');
    expect(before).not.toHaveAttribute('data-compact', 'true');

    // Sentinel leaves the viewport → compact mode flips on.
    triggerObserver(false);
    const after = screen.getByTestId('hero-next-step');
    expect(after).toHaveAttribute('data-compact', 'true');
  });
});

describe('HeroNextStep — label and detail', () => {
  it('renders the optional label slot', () => {
    render(
      <HeroNextStep
        tone="aborted"
        label="Lineup cancelled"
        headline="Nothing to do — this lineup was cancelled."
      />,
    );
    expect(screen.getByText('Lineup cancelled')).toBeInTheDocument();
  });

  it('renders the optional detail slot', () => {
    render(
      <HeroNextStep
        tone="action"
        headline="Cast your votes"
        detail="Each pick counts toward shortlisting."
      />,
    );
    expect(
      screen.getByText('Each pick counts toward shortlisting.'),
    ).toBeInTheDocument();
  });
});
