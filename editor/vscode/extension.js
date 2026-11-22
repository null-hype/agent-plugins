// Starts the Witness language server over stdio for .pkl files. Witness finds
// .witness/run/findings.json by walking up from each opened file, so no
// workspace root is needed.
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

exports.activate = async () => {
  const command = vscode.workspace.getConfiguration('witness').get('serverPath') || 'witness';
  client = new LanguageClient(
    'witness',
    'Witness',
    { command, transport: TransportKind.stdio },
    { documentSelector: [{ scheme: 'file', language: 'pkl' }] },
  );
  await client.start();
};

exports.deactivate = () => client && client.stop();
