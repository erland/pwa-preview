import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

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
});
