import { describe, expect, it, vi } from 'vitest';
import { createMcpHttpHandler } from '../../src/mcp/server.js';

const config = { ttlMinMinutes: 5, ttlMaxMinutes: 60 } as any;

function fakeService() {
  const preview = { id:'p-1234567890abcdef', hostname:'p-1234567890abcdef.preview.test', displayName:'Demo', status:'READY', createdAt:new Date('2026-01-01T00:00:00Z'), updatedAt:new Date('2026-01-01T00:00:00Z'), expiresAt:new Date('2026-01-01T01:00:00Z'), compressedSizeBytes:10, extractedSizeBytes:20, fileCount:2, sourceSha256:'abc', sourceType:'URL' };
  return {
    listOwned: vi.fn(async () => [preview]),
    getOwned: vi.fn(async () => preview),
    createFromUrl: vi.fn(async () => preview),
    updateFromUrl: vi.fn(async () => preview),
    extendOwned: vi.fn(async () => preview),
    deleteOwned: vi.fn(async () => true),
  } as any;
}

async function rpc(handler: ReturnType<typeof createMcpHttpHandler>, body: unknown) {
  const response = await handler.fetch(new Request('https://control.test/mcp', {
    method:'POST', headers:{'content-type':'application/json','accept':'application/json, text/event-stream'}, body:JSON.stringify(body),
  }));
  const text = await response.text();
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice(6) : text);
}

describe('MCP server', () => {
  it('exposes all lifecycle tools', async () => {
    const handler = createMcpHttpHandler(fakeService(), 'user-a', config);
    const reply = await rpc(handler, { jsonrpc:'2.0', id:1, method:'tools/list', params:{} });
    const names = reply.result.tools.map((t:any)=>t.name);
    expect(names).toEqual(expect.arrayContaining(['preview_create','preview_list','preview_get','preview_update','preview_extend','preview_delete']));
    const byName = Object.fromEntries(reply.result.tools.map((t:any)=>[t.name,t]));
    expect(byName.preview_list.annotations).toMatchObject({ readOnlyHint:true, destructiveHint:false });
    expect(byName.preview_create.annotations).toMatchObject({ readOnlyHint:false, openWorldHint:true, destructiveHint:false });
    expect(byName.preview_delete.annotations).toMatchObject({ readOnlyHint:false, destructiveHint:true });
  });

  it('derives owner from authenticated MCP identity', async () => {
    const service = fakeService();
    const handler = createMcpHttpHandler(service, 'user-a', config);
    await rpc(handler, { jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'preview_create', arguments:{ sourceUrl:'https://example.com/app.zip' } } });
    expect(service.createFromUrl).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId:'user-a', sourceUrl:'https://example.com/app.zip' }));
  });
  it('rejects invalid shared preview inputs before calling the service', async () => {
    const service = fakeService();
    const handler = createMcpHttpHandler(service, 'user-a', config);

    const badUrl = await rpc(handler, { jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'preview_create', arguments:{ sourceUrl:'http://example.com/app.zip' } } });
    expect(badUrl.result?.isError ?? badUrl.error).toBeTruthy();
    expect(service.createFromUrl).not.toHaveBeenCalled();

    const badId = await rpc(handler, { jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'preview_get', arguments:{ previewId:'not-a-preview-id' } } });
    expect(badId.result?.isError ?? badId.error).toBeTruthy();
    expect(service.getOwned).not.toHaveBeenCalled();
  });

});
