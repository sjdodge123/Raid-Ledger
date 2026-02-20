import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PluginSlot } from './plugin-slot';
import { registerSlotComponent, clearRegistry, registerPlugin } from './plugin-registry';
import { usePluginStore } from '../stores/plugin-store';

function TestComponent(props: { message?: string }) {
    return <div data-testid="test-component">{props.message ?? 'default'}</div>;
}

function TestComponent2(props: { message?: string }) {
    return <div data-testid="test-component-2">{props.message ?? 'second'}</div>;
}

describe('PluginSlot', () => {
    beforeEach(() => {
        clearRegistry();
        usePluginStore.setState({
            activeSlugs: new Set<string>(),
            initialized: false,
        });
    });

    it('renders nothing when no registrations exist and no fallback', () => {
        const { container } = render(
            <PluginSlot name="character-detail:sections" />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders fallback when no active plugin fills the slot', () => {
        render(
            <PluginSlot
                name="character-detail:sections"
                fallback={<div data-testid="fallback">No content</div>}
            />,
        );
        expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('renders fallback when registrations exist but plugin is inactive', () => {
        registerSlotComponent({
            pluginSlug: 'blizzard',
            slotName: 'character-detail:sections',
            component: TestComponent,
            priority: 0,
        });

        render(
            <PluginSlot
                name="character-detail:sections"
                fallback={<div data-testid="fallback">Fallback</div>}
            />,
        );
        expect(screen.getByTestId('fallback')).toBeInTheDocument();
        expect(screen.queryByTestId('test-component')).not.toBeInTheDocument();
    });

    it('renders registered component when plugin is active', () => {
        registerSlotComponent({
            pluginSlug: 'blizzard',
            slotName: 'character-detail:sections',
            component: TestComponent,
            priority: 0,
        });

        usePluginStore.getState().setActiveSlugs(['blizzard']);

        render(<PluginSlot name="character-detail:sections" />);
        expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });

    it('passes context props to the rendered component', () => {
        registerSlotComponent({
            pluginSlug: 'blizzard',
            slotName: 'character-detail:sections',
            component: TestComponent,
            priority: 0,
        });

        usePluginStore.getState().setActiveSlugs(['blizzard']);

        render(
            <PluginSlot
                name="character-detail:sections"
                context={{ message: 'hello from context' }}
            />,
        );
        expect(screen.getByTestId('test-component')).toHaveTextContent('hello from context');
    });

    it('renders multiple components stacked by priority', () => {
        registerSlotComponent({
            pluginSlug: 'blizzard',
            slotName: 'character-detail:header-badges',
            component: TestComponent,
            priority: 10,
        });
        registerSlotComponent({
            pluginSlug: 'custom',
            slotName: 'character-detail:header-badges',
            component: TestComponent2,
            priority: 0,
        });

        usePluginStore.getState().setActiveSlugs(['blizzard', 'custom']);

        render(<PluginSlot name="character-detail:header-badges" />);
        const components = screen.getAllByTestId(/test-component/);
        expect(components).toHaveLength(2);
        // Priority 0 (custom) before priority 10 (blizzard)
        expect(components[0]).toHaveTextContent('second');
        expect(components[1]).toHaveTextContent('default');
    });

    it('wraps content in div with className when provided', () => {
        registerSlotComponent({
            pluginSlug: 'blizzard',
            slotName: 'character-detail:sections',
            component: TestComponent,
            priority: 0,
        });

        usePluginStore.getState().setActiveSlugs(['blizzard']);

        const { container } = render(
            <PluginSlot
                name="character-detail:sections"
                className="my-wrapper"
            />,
        );
        const wrapper = container.querySelector('.my-wrapper');
        expect(wrapper).toBeInTheDocument();
        expect(wrapper?.querySelector('[data-testid="test-component"]')).toBeInTheDocument();
    });

    it('wraps fallback in div with className when provided', () => {
        const { container } = render(
            <PluginSlot
                name="character-detail:sections"
                className="fallback-wrapper"
                fallback={<span>Fallback content</span>}
            />,
        );
        const wrapper = container.querySelector('.fallback-wrapper');
        expect(wrapper).toBeInTheDocument();
        expect(wrapper?.textContent).toBe('Fallback content');
    });

    it('renders plugin badge when plugin has badge metadata', () => {
        registerPlugin('blizzard', {
            icon: 'W',
            color: 'blue',
            label: 'WoW Plugin',
        });
        registerSlotComponent({
            pluginSlug: 'blizzard',
            slotName: 'character-detail:sections',
            component: TestComponent,
            priority: 0,
        });

        usePluginStore.getState().setActiveSlugs(['blizzard']);

        render(<PluginSlot name="character-detail:sections" />);
        expect(screen.getByTestId('test-component')).toBeInTheDocument();
        expect(screen.getByTitle('WoW Plugin')).toBeInTheDocument();
    });

    it('does not render badge when plugin has no badge metadata', () => {
        registerSlotComponent({
            pluginSlug: 'no-badge-plugin',
            slotName: 'character-detail:sections',
            component: TestComponent,
            priority: 0,
        });

        usePluginStore.getState().setActiveSlugs(['no-badge-plugin']);

        const { container } = render(
            <PluginSlot name="character-detail:sections" />,
        );
        expect(screen.getByTestId('test-component')).toBeInTheDocument();
        // No badge element should be present
        expect(container.querySelector('[aria-label]')).toBeNull();
    });
});
