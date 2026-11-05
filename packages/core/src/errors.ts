export type ErrorCode =
  | 'invalid_id'
  | 'invalid_input'
  | 'not_found'
  | 'already_exists'
  | 'corrupt_entry'
  | 'path_escape'
  | 'too_large'
  | 'too_many'
  | 'locked'
  | 'not_a_repo'
  | 'changed';

/** An expected failure. Its message is written for the person using the tool. */
export class ParkedPromptsError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ParkedPromptsError';
    this.code = code;
  }
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const isNodeError = (error: unknown, ...codes: string[]): boolean =>
  error instanceof Error && 'code' in error && codes.includes(String((error as NodeJS.ErrnoException).code));
