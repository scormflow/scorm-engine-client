# @scormflow/client

Umbrella package for [ScormFlow](https://github.com/scormflow/scorm-engine-client): the SDK, player, React bindings, and generated types in a single install.

```bash
npm install @scormflow/client
# or, for React apps
npm install @scormflow/client react react-dom
```

## Entry points

| Import                      | Re-exports          | Needs                |
| --------------------------- | ------------------- | -------------------- |
| `@scormflow/client`         | `@scormflow/sdk`    | —                    |
| `@scormflow/client/player`  | `@scormflow/player` | a DOM                |
| `@scormflow/client/react`   | `@scormflow/react`  | `react`, `react-dom` |
| `@scormflow/client/types`   | `@scormflow/types`  | — (types only)       |

```ts
import { createScormClient } from '@scormflow/client';
import { mountScormPlayer } from '@scormflow/client/player';
import { ScormProvider, ScormPlayer } from '@scormflow/client/react';
```

`react` and `react-dom` are **optional** peers — you only need them if you import `@scormflow/client/react`.

Prefer the individual packages (`@scormflow/sdk`, `@scormflow/player`, `@scormflow/react`, `@scormflow/types`) when you only need one of them. See the [main README](https://github.com/scormflow/scorm-engine-client#readme) for full docs.

## License

MIT
