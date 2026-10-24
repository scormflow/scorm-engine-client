/**
 * React bindings for completion certificates: one attempt's certificate (what
 * a learner sees) and the tenant's certificate list (what an admin sees).
 * Mutations (`issue`, `revoke`) are plain `CertificatesClient` calls — follow
 * them with `refetch`.
 */
import type { Certificate, CertificateList, CertificateQuery, CertificatesClient } from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/**
 * The attempt's certificate. `data` is `null` until it is issued — the engine
 * issues it on the commit that completes the attempt, so `refetch` after the
 * player reports completion. Idle while `attemptId` is falsy.
 */
export function useCertificate(
  certificates: CertificatesClient,
  attemptId: string | null | undefined,
): AsyncResource<Certificate | null> {
  return useAsyncResource<Certificate | null>(
    `certificate:${attemptId ?? ''}`,
    (signal) => certificates.forAttempt(attemptId as string, { signal }),
    Boolean(attemptId),
  );
}

/** One page of the tenant's certificates; pass `pagination.nextCursor` back as `query.before`. */
export function useCertificates(
  certificates: CertificatesClient,
  query: CertificateQuery = {},
): AsyncResource<CertificateList> {
  const key = `certificates:${query.learnerId ?? ''}:${query.courseId ?? ''}:${query.status ?? ''}:${query.limit ?? ''}:${query.before ?? ''}`;
  return useAsyncResource<CertificateList>(key, (signal) => certificates.list(query, { signal }));
}
