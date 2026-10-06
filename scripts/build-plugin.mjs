import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const version = valueAfter('--version') || process.env.PLUGIN_VERSION;
const target = valueAfter('--target') || 'desktop';
const mcpUrl = process.env.PWA_PREVIEW_MCP_URL || 'https://pwa-preview.apphome.one/mcp';
const chatgptAppId = process.env.PWA_PREVIEW_CHATGPT_APP_ID?.trim();
const configuredChatgptPluginName = process.env.PWA_PREVIEW_CHATGPT_PLUGIN_NAME?.trim();
const allowedTargets = new Set(['chatgpt', 'desktop']);

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`PLUGIN_VERSION must be a strict semantic version, got: ${version ?? '<missing>'}`);
}
if (!allowedTargets.has(target)) {
  throw new Error('Specify --target chatgpt or --target desktop');
}

const outputRoot = resolve(process.env.PLUGIN_OUTPUT_DIR || `build/plugin-${target}`);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

if (target === 'chatgpt') {
  if (!chatgptAppId) {
    throw new Error('PWA_PREVIEW_CHATGPT_APP_ID is required for the ChatGPT update package');
  }
  if (!/^asdk_app_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(chatgptAppId)) {
    throw new Error('PWA_PREVIEW_CHATGPT_APP_ID must be the registered asdk_app_... id');
  }

  const derivedName = `dev-${chatgptAppId.slice('asdk_app_'.length)}`;
  const chatgptPluginName = configuredChatgptPluginName || derivedName;
  if (!/^dev-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(chatgptPluginName)) {
    throw new Error('PWA_PREVIEW_CHATGPT_PLUGIN_NAME must be the stable exported dev-... plugin name');
  }

  const nativeTemplate = await readFile('plugin/chatgpt-update.template.json', 'utf8');
  const nativeManifest = JSON.parse(
    nativeTemplate
      .replaceAll('__PLUGIN_VERSION__', version)
      .replaceAll('__CHATGPT_PLUGIN_NAME__', chatgptPluginName)
  );
  if (nativeManifest.name !== chatgptPluginName || nativeManifest.version !== version || nativeManifest.apps !== './.app.json') {
    throw new Error('Generated ChatGPT update manifest identity/version validation failed');
  }

  const appTemplate = await readFile('plugin/app.template.json', 'utf8');
  const appManifest = JSON.parse(
    appTemplate
      .replaceAll('__CHATGPT_APP_ID__', chatgptAppId)
      .replaceAll('__CHATGPT_PLUGIN_NAME__', chatgptPluginName)
  );
  if (appManifest.apps?.[chatgptPluginName]?.id !== chatgptAppId) {
    throw new Error('Generated ChatGPT app binding validation failed');
  }

  await mkdir(resolve(outputRoot, '.codex-plugin'), { recursive: true });
  await writeFile(resolve(outputRoot, '.app.json'), `${JSON.stringify(appManifest, null, 2)}\n`);
  await writeFile(resolve(outputRoot, '.codex-plugin', 'plugin.json'), `${JSON.stringify(nativeManifest, null, 2)}\n`);

  console.log(`Generated ChatGPT update package directory: ${outputRoot}`);
  console.log(`Plugin version: ${version}`);
  console.log(`ChatGPT app id: ${chatgptAppId}`);
  console.log(`ChatGPT plugin name: ${chatgptPluginName}`);
} else {
  const outputDir = resolve(outputRoot, 'pwa-preview');
  await mkdir(outputDir, { recursive: true });

  const parsedMcpUrl = new URL(mcpUrl);
  if (parsedMcpUrl.protocol !== 'https:') {
    throw new Error('PWA_PREVIEW_MCP_URL must use HTTPS');
  }

  const pluginTemplate = await readFile('plugin/plugin.template.json', 'utf8');
  const mcpTemplate = await readFile('plugin/mcp.template.json', 'utf8');

  const pluginJson = pluginTemplate.replaceAll('__PLUGIN_VERSION__', version);
  const mcpJson = mcpTemplate.replaceAll('__PWA_PREVIEW_MCP_URL__', mcpUrl);

  const manifest = JSON.parse(pluginJson);
  const mcp = JSON.parse(mcpJson);
  if (manifest.name !== 'pwa-preview' || manifest.version !== version) {
    throw new Error('Generated desktop plugin manifest identity/version validation failed');
  }
  if (manifest.extensions?.['com.openai']?.interface?.shortDescription?.length > 30) {
    throw new Error('OpenAI shortDescription must be at most 30 characters');
  }
  if (mcp.mcpServers?.['pwa-preview']?.url !== mcpUrl) {
    throw new Error('Generated MCP URL validation failed');
  }

  await writeFile(resolve(outputDir, 'plugin.json'), pluginJson);
  await writeFile(resolve(outputDir, 'mcp.json'), mcpJson);
  await cp('plugin/skills', resolve(outputDir, 'skills'), { recursive: true });

  console.log(`Generated desktop plugin package directory: ${outputDir}`);
  console.log(`Plugin version: ${version}`);
  console.log(`MCP endpoint: ${mcpUrl}`);
}
