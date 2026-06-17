import type { ConnectorSource, LinkStatusError } from "../../shared/types";

export type ResourceFailureCode =
  | LinkStatusError
  | "invalid-config"
  | "bad-query"
  | "internal";

export interface ResourceFailure<Ref extends ResourceRef = ResourceRef> {
  code: ResourceFailureCode;
  message?: string;
  ref?: Ref;
  retryAfterMs?: number;
  cause?: unknown;
}

export type Ok<T> = { ok: true; value: T };
export type Failed<E = ResourceFailure> = { ok: false; error: E };
export type Result<T, E = ResourceFailure> = Ok<T> | Failed<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function failed<E = ResourceFailure>(error: E): Failed<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isFailed<T, E>(result: Result<T, E>): result is Failed<E> {
  return !result.ok;
}

/** A stable identity for something Atrium can observe and hydrate from an
 * external provider. URLs, workspace PR refs, and future inbox records should
 * all converge to this shape before entering the refresh/cache layer. */
export interface ResourceRef<
  Source extends ConnectorSource = ConnectorSource,
  Kind extends string = string,
> {
  source: Source;
  kind: Kind;
  /** Provider-stable id, e.g. `owner/repo#123` or a Notion page UUID. */
  id: string;
  /** Canonical URL when the provider can produce one. */
  url?: string;
}

/** A typed, provider-built query. Callers choose provider query builders; they
 * do not assemble private payloads or pass stringly operation names into the
 * provider. */
export interface ResourceQuery<
  Source extends ConnectorSource = ConnectorSource,
  Kind extends string = string,
  Payload = unknown,
> {
  source: Source;
  kind: Kind;
  /** Stable key for logging, cache bookkeeping, and deduping observe calls. */
  key: string;
  /** Provider-private execution payload. Only the matching provider reads it. */
  payload: Payload;
}

/** Cheap/current view returned by observe(). This is enough to seed cards,
 * compare signatures, and decide whether full hydration is needed. */
export interface ObservedResource<
  Ref extends ResourceRef = ResourceRef,
  Preview = unknown,
> {
  ref: Ref;
  signature: string;
  observedAt: string;
  preview?: Preview;
}

export type ObservedResourceResult<
  Ref extends ResourceRef = ResourceRef,
  Preview = unknown,
> = Result<ObservedResource<Ref, Preview>, ResourceFailure<Ref>>;

/** Full provider-specific data for a resource. UI layers can project this into
 * PR cards, link cards, inbox items, or agent-context snippets. */
export interface HydratedResource<
  Ref extends ResourceRef = ResourceRef,
  Data = unknown,
> {
  ref: Ref;
  data: Data;
  hydratedAt: string;
  signature?: string;
}

export interface ResourceProviderClient<
  Source extends ConnectorSource,
  Query extends ResourceQuery<Source, string, unknown>,
  Ref extends ResourceRef<Source, string>,
  Preview,
  Data,
> {
  source: Source;

  observe(
    query: Query,
  ): Promise<
    Result<ObservedResourceResult<Ref, Preview>[], ResourceFailure<Ref>>
  >;
  hydrate(
    ref: Ref,
  ): Promise<Result<HydratedResource<Ref, Data>, ResourceFailure<Ref>>>;
  hydrateMany?(
    refs: Ref[],
  ): Promise<Result<HydratedResource<Ref, Data>[], ResourceFailure<Ref>>>;
}

/** Core provider definition. Provider-specific modules expose typed query
 * builders next to this object. configure() returns a client that no longer
 * needs credentials passed per request. */
export interface ResourceProviderDefinition<
  Source extends ConnectorSource,
  Query extends ResourceQuery<Source, string, unknown>,
  Ref extends ResourceRef<Source, string>,
  Preview,
  Data,
  Config = unknown,
> {
  source: Source;

  parseUrl(url: string): Result<Ref, ResourceFailure<Ref>>;
  normalizeRef(ref: Ref): Result<Ref, ResourceFailure<Ref>>;

  configure(
    config: unknown,
  ): Result<
    ResourceProviderClient<Source, Query, Ref, Preview, Data>,
    ResourceFailure<Ref>
  >;
}
