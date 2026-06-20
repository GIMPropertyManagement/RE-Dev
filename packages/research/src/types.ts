import type {
  Confidence,
  NeedsHumanReason,
  ResearchKind,
  SourceRef,
} from '@forge/shared';
import type { L3Attributes } from '@forge/gis';

/**
 * The envelope every research producer returns. The "never invent" contract is
 * structural: a payload value that can't be grounded in a source becomes null +
 * needsHuman, never a guess. The financial go/no-go is gated on
 * needsHuman === false AND high-confidence financial fields downstream.
 */
export interface ResearchResult<T = unknown> {
  kind: ResearchKind;
  payload: T;
  sources: SourceRef[];
  confidence: Confidence;
  needsHuman: boolean;
  needsHumanReasons: NeedsHumanReason[];
}

/** Everything a producer needs about the parcel under analysis. */
export interface ResearchInput {
  parcelId: string;
  locId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  town: string | null;
  lotAcres: number | null;
  zoningHint: string | null;
  /** L3 assessor attributes captured at resolution (ownership reads these). */
  l3: L3Attributes | null;
}

export type FetchLike = typeof fetch;

/** A producer turns parcel input into a cached research result for one kind. */
export type ResearchProducer<T = unknown> = (
  input: ResearchInput,
  deps: ProducerDeps,
) => Promise<ResearchResult<T>>;

export interface ProducerDeps {
  fetchImpl?: FetchLike;
  /** Claude wrapper (LLM kinds only). */
  llm?: import('./claude.js').ResearchLlm;
  /** MLS provider for sold comps (CMA only). */
  comps?: import('@forge/shared').MlsProvider;
}
