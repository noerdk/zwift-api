export class ZwiftError extends Error {
  constructor(message, { status, path, body, cause } = {}) {
    super(message, { cause });
    this.name = 'ZwiftError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

/** Credentials were rejected, or the token is no longer valid. */
export class ZwiftAuthError extends ZwiftError {
  constructor(message, opts) { super(message, opts); this.name = 'ZwiftAuthError'; }
}

/** The response did not have the shape we expect — usually schema drift. */
export class ZwiftSchemaError extends ZwiftError {
  constructor(message, opts) { super(message, opts); this.name = 'ZwiftSchemaError'; }
}
