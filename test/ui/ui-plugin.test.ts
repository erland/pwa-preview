import { describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { registerUi } from '../../src/ui/ui-plugin.js';

describe('control-plane UI', () => {
  it('contains login and preview management affordances', async () => {
    const source = await readFile('ui/src/main.tsx', 'utf8');
    expect(source).toContain('Fortsätt med GitHub');
    expect(source).toContain('Skapa preview');
    expect(source).toContain('Uppdatera');
    expect(source).toContain('Förläng');
    expect(source).toContain('Radera');
  });

  it('has responsive mobile styles', async () => {
    const css = await readFile('ui/src/styles.css', 'utf8');
    expect(css).toContain('@media(max-width:720px)');
  });

  it('serves the control-plane index from the root route', async () => {
    await mkdir('dist/ui/assets', { recursive: true });
    await writeFile('dist/ui/index.html', '<!doctype html><title>PWA Preview</title>');
    await writeFile('dist/ui/assets/app.js', 'window.__PWA_PREVIEW_TEST__ = true;');

    const app = Fastify();
    try {
      await registerUi(app);
      const response = await app.inject({ method: 'GET', url: '/' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('PWA Preview');

      const assetResponse = await app.inject({ method: 'GET', url: '/assets/app.js' });
      expect(assetResponse.statusCode).toBe(200);
      expect(assetResponse.headers['content-type']).toContain('javascript');
      expect(assetResponse.body).toContain('__PWA_PREVIEW_TEST__');
    } finally {
      await app.close();
      await rm('dist/ui', { recursive: true, force: true });
    }
  });
});
