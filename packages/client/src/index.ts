/**
 * `@scormflow/client` — umbrella package.
 *
 * One dependency that bundles the whole ScormFlow client surface:
 *
 *  - the root entry re-exports `@scormflow/sdk` (the main client + transports)
 *  - `@scormflow/client/player` re-exports `@scormflow/player`
 *  - `@scormflow/client/react` re-exports `@scormflow/react`
 *  - `@scormflow/client/types` re-exports `@scormflow/types`
 *
 * Prefer the individual packages when you only need one; use this when you want
 * a single install and import root.
 */
export * from '@scormflow/sdk';
