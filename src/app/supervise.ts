import type { Instance } from 'ink';

/**
 * Ink 7 handles a component throw by showing its error overview, unmounting and rejecting
 * waitUntilExit() — nothing else. Wire both outcomes so the process never hangs in the alt
 * screen with collectors still running.
 */
export function superviseInk(
  instance: Pick<Instance, 'waitUntilExit'>,
  handlers: { onExit: () => void; onCrash: (err: unknown) => void },
): void {
  instance.waitUntilExit().then(handlers.onExit, handlers.onCrash);
}
