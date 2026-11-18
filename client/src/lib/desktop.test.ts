import { describe, expect, it } from 'vitest';
import { groupWorld, loadView } from './desktop';
import type { AppSpace, HcTerminal } from './desktop';

const SPACES: AppSpace[] = [
    {
        id: 'sp1',
        name: 'skills',
        folder: '/w/skills',
        tabs: [
            { id: 'tb1', name: 'main', terminals: [{ terminal: 't1', status: 'working', app: 'claude' }] },
            { id: 'tb2', name: 'empty', terminals: [] },
        ],
    },
];

const labelled = (address: string, space: string, tab: string, extra: Partial<HcTerminal> = {}): HcTerminal => ({
    address,
    labels: { 'herdr.space': space, 'herdr.tab': tab },
    ...extra,
});

describe('groupWorld', () => {
    it('puts terminals under the app space and tab and keeps empty tabs for new terminals', () => {
        const world = groupWorld(SPACES, [labelled('t1', 'sp1', 'tb1', { title: 'Claude' })]);
        expect(world).toHaveLength(1);
        expect(world[0].tabs.map((tab) => tab.name)).toEqual(['main', 'empty']);
        expect(world[0].tabs[0].terminals).toEqual([{ address: 't1', title: 'Claude', agent: 'claude', status: 'working' }]);
    });

    it('prefers the live hc status over the app snapshot', () => {
        const world = groupWorld(SPACES, [labelled('t1', 'sp1', 'tb1', { status: { app: 'opencode', state: 'idle' } })]);
        expect(world[0].tabs[0].terminals[0]).toMatchObject({ agent: 'opencode', status: 'idle' });
    });

    it('names spaces and tabs from the where label without herdr-app', () => {
        const terminal = { address: 't2', labels: { 'herdr.space': 'sp9', 'herdr.tab': 'tb9', where: 'a / b / c' } };
        const world = groupWorld(null, [terminal]);
        expect(world[0]).toMatchObject({ id: 'sp9', name: 'a / b' });
        expect(world[0].tabs[0]).toMatchObject({ id: 'tb9', name: 'c' });
    });

    it('collects unlabelled terminals in a last group', () => {
        const world = groupWorld(SPACES, [{ address: 't3', foreground: { name: 'zsh' } }]);
        expect(world.at(-1)).toMatchObject({ id: null, tabs: [{ id: null, terminals: [{ address: 't3', title: 'zsh' }] }] });
    });
});

describe('loadView', () => {
    it('defaults to the TUI view', () => {
        expect(loadView({ getItem: () => null })).toBe('tui');
        expect(loadView({ getItem: () => 'desktop' })).toBe('desktop');
    });
});
