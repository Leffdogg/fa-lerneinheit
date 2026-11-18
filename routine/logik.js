// Lädt die Logik des Plugins FA-Lerneinheit unter Node, ohne Obsidian.
// Aufruf: const l = require('<ROUTINE>/logik.js')('<VAULT>/.obsidian/plugins/fa-lerneinheit');
const Module = require('module');
const path = require('path');

module.exports = (pluginOrdner) => {
  const leer = class {};
  const stub = {
    Plugin: leer, MarkdownRenderChild: leer, ItemView: leer, Modal: leer, Component: leer, PluginSettingTab: leer, Setting: leer, Notice: leer, TFile: leer,
    MarkdownRenderer: { render() {} }, setIcon() {}, parseYaml: () => ({}),
  };
  const original = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    return req === 'obsidian' ? 'obsidian' : original.call(this, req, ...rest);
  };
  require.cache.obsidian = { id: 'obsidian', filename: 'obsidian', loaded: true, exports: stub };
  return require(path.join(pluginOrdner, 'main.js')).logik;
};
