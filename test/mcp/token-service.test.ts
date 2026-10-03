import { describe, expect, it } from 'vitest';
import { parseBearer } from '../../src/mcp/token-service.js';

describe('MCP bearer parsing', () => {
  it('accepts a bearer token', () => expect(parseBearer('Bearer pwp_abc')).toBe('pwp_abc'));
  it('rejects malformed auth', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
  });
});
