export type DriftErrorCode =
  | 'EMPTY_INPUT'
  | 'INCONSISTENT_DIMENSIONS'
  | 'INCOMPATIBLE_DIMENSIONS'
  | 'NO_BASELINE'
  | 'INVALID_SNAPSHOT'
  | 'NO_CANARY_BASELINE'
  | 'EMBED_FN_FAILED';

export class DriftError extends Error {
  readonly name = 'DriftError';
  constructor(
    message: string,
    readonly code: DriftErrorCode,
  ) {
    super(message);
    Object.setPrototypeOf(this, DriftError.prototype);
  }
}
