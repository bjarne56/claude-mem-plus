#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const codexPluginPath = path.join(rootDir, '.codex-plugin', 'plugin.json');
const claudePluginPath = path.join(rootDir, '.claude-plugin', 'plugin.json');
// fork: 也同步 plugin/.claude-plugin/plugin.json — readPluginVersion()
// (npx-cli) 优先读这个文件,所以 version 必须保持和 root package.json 一致,
// 否则 claude-mem-plus --version 显示旧值 + plugin tree 显示旧版。
const pluginTreeManifestPath = path.join(rootDir, 'plugin', '.claude-plugin', 'plugin.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function syncCodexPlugin(plugin, pkg) {
  const author =
    typeof plugin.author === 'object' && plugin.author ? plugin.author : {};

  return {
    ...plugin,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    keywords: pkg.keywords,
    author: {
      ...author,
      name: normalizeAuthorName(pkg.author),
    },
    interface: {
      ...plugin.interface,
      developerName: normalizeAuthorName(pkg.author),
      websiteURL: normalizeRepositoryUrl(pkg.repository),
    },
  };
}

function syncClaudePlugin(plugin, pkg) {
  return {
    ...plugin,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: pkg.homepage,
    repository: normalizeRepositoryUrl(pkg.repository),
    license: pkg.license,
    keywords: pkg.keywords,
    author: {
      ...(typeof plugin.author === 'object' && plugin.author ? plugin.author : {}),
      name: normalizeAuthorName(pkg.author),
    },
  };
}

function normalizeAuthorName(author) {
  if (typeof author === 'string') return author;
  if (author && typeof author === 'object' && typeof author.name === 'string') return author.name;
  return '';
}

function normalizeRepositoryUrl(repository) {
  if (typeof repository === 'string') return repository.replace(/\.git$/, '');
  if (repository && typeof repository === 'object' && typeof repository.url === 'string')
    return repository.url.replace(/\.git$/, '');
  return '';
}

function main() {
  for (const filePath of [packageJsonPath, codexPluginPath, claudePluginPath]) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing required file: ${filePath}`);
      process.exit(1);
    }
  }

  const pkg = readJson(packageJsonPath);
  const codexPlugin = readJson(codexPluginPath);
  const claudePlugin = readJson(claudePluginPath);

  writeJson(codexPluginPath, syncCodexPlugin(codexPlugin, pkg));
  writeJson(claudePluginPath, syncClaudePlugin(claudePlugin, pkg));

  // fork: 同步 plugin/.claude-plugin/plugin.json 的 version,但保留 upstream
  // 的 name / description / author / repository / license / keywords 不动
  // (这是 plugin marketplace 看到的元数据,跟 fork 的 npm 包名独立)
  if (fs.existsSync(pluginTreeManifestPath)) {
    const pluginTreeManifest = readJson(pluginTreeManifestPath);
    if (pluginTreeManifest.version !== pkg.version) {
      pluginTreeManifest.version = pkg.version;
      writeJson(pluginTreeManifestPath, pluginTreeManifest);
    }
  }

  console.log('✓ Synced plugin manifests from package.json');
}

main();
