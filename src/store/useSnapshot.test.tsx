import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Store } from './store.js';
import { useSnapshot } from './useSnapshot.js';

function Probe({ store }: { store: Store }) {
  const snap = useSnapshot(store);
  return <Text>sessions:{snap.sessions.length}</Text>;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('useSnapshot', () => {
  it('re-renders when the store notifies', async () => {
    const store = new Store({
      now: () => Date.parse('2026-10-11T14:32:07Z'),
      refreshMs: 1000,
      endedWindowHours: 24,
      claudeDir: '/c',
      claudeDirFound: true,
    });
    const { lastFrame, unmount } = render(<Probe store={store} />);
    expect(lastFrame()).toContain('sessions:0');
    store.upsertRegistry({ pid: 1, sessionId: 's1', cwd: '/w', status: 'idle' });
    store.flush();
    await tick();
    expect(lastFrame()).toContain('sessions:1');
    unmount();
    store.stop();
  });
});
