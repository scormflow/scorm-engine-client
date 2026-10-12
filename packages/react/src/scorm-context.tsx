import { createContext, createElement, useContext, type ReactNode } from 'react';
import type {
  CertificatesClient,
  Cmi5Client,
  ResourceClient,
  ScormClient,
  ScormTransport,
  WebhooksClient,
  XapiClient,
} from '@scormflow/sdk';

const ScormContext = createContext<ScormClient | null>(null);

export interface ScormProviderProps {
  /** The configured client every descendant hook reads from. */
  client: ScormClient;
  children: ReactNode;
}

/**
 * Provides a {@link ScormClient} to the component tree so hooks can resolve it
 * from context instead of being handed a sub-client at every call site.
 *
 * ```tsx
 * const client = createScormClient({ baseUrl, apiKey });
 *
 * <ScormProvider client={client}>
 *   <App />
 * </ScormProvider>
 * ```
 *
 * Inside the tree, `useScormClient()` returns the client and the typed
 * accessors (`useResourceClient`, `useXapiClient`, …) return its namespaces.
 */
export function ScormProvider({ client, children }: ScormProviderProps): JSX.Element {
  return createElement(ScormContext.Provider, { value: client }, children);
}

/**
 * Read the {@link ScormClient} from the nearest {@link ScormProvider}. Throws a
 * descriptive error when used outside a provider.
 */
export function useScormClient(): ScormClient {
  const client = useContext(ScormContext);
  if (!client) {
    throw new Error('useScormClient must be used within a <ScormProvider>.');
  }
  return client;
}

/** The provided client's course + analytics REST surface. */
export function useResourceClient(): ResourceClient {
  return useScormClient().resources;
}

/** The provided client's runtime transport (what a player drives). */
export function useScormTransport(): ScormTransport {
  return useScormClient().runtime;
}

/** The provided client's xAPI (LRS) surface. */
export function useXapiClient(): XapiClient {
  return useScormClient().xapi;
}

/** The provided client's cmi5 surface. */
export function useCmi5Client(): Cmi5Client {
  return useScormClient().cmi5;
}

/** The provided client's webhooks surface. */
export function useWebhooksClient(): WebhooksClient {
  return useScormClient().webhooks;
}

/** The provided client's certificates surface. */
export function useCertificatesClient(): CertificatesClient {
  return useScormClient().certificates;
}

/** The provided client, or null outside a provider — for components that also accept a client prop. */
export function useOptionalScormClient(): ScormClient | null {
  return useContext(ScormContext);
}
