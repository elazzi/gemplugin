// Import the VS Code API and the Gemini API client
const vscode = require('vscode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Module-level variable to hold the initialized Gemini client
let genAI;
const diffContentStore = new Map();
const diffFixStore = new Map();
let acceptButton, discardButton;
let inlineCompletionProvider, chatParticipant;

async function activate(context) {
    console.log('Congratulations, your extension "gemini-copilot" is now active!');

    setupDiffView(context);
    registerCommands(context);
    registerInlineCompletionProvider(context);
    registerChatParticipant(context);

    const webviewProvider = new GeminiChatViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("geminiChatView", webviewProvider));

    // Attempt to initialize the Gemini client on activation
    await initializeGenAI(context);
}

function setupDiffView(context) {
    const provider = vscode.workspace.registerTextDocumentContentProvider('gemini-diff', {
        provideTextDocumentContent: uri => diffContentStore.get(uri.toString())
    });
    context.subscriptions.push(provider);

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        if (doc.uri.scheme === 'gemini-diff') {
            const uuid = doc.uri.path.split('/')[2];
            diffContentStore.delete(doc.uri.toString());
            if (diffFixStore.has(uuid)) {
                diffFixStore.delete(uuid);
            }
            updateStatusBar(false);
        }
    }));

    acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    acceptButton.command = 'gemini-copilot.acceptFix';
    acceptButton.text = '$(check) Accept Fix';
    context.subscriptions.push(acceptButton);

    discardButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    discardButton.command = 'gemini-copilot.discardFix';
    discardButton.text = '$(close) Discard Fix';
    context.subscriptions.push(discardButton);

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.uri.scheme === 'gemini-diff') {
            const uuid = editor.document.uri.path.split('/')[2];
            vscode.commands.executeCommand('setContext', 'gemini.diffViewActive', true);
            vscode.commands.executeCommand('setContext', 'gemini.diffId', uuid);
            updateStatusBar(true);
        } else {
            vscode.commands.executeCommand('setContext', 'gemini.diffViewActive', false);
            updateStatusBar(false);
        }
    }));
}

function updateStatusBar(visible) {
    if (visible) {
        acceptButton.show();
        discardButton.show();
    } else {
        acceptButton.hide();
        discardButton.hide();
    }
}

function registerCommands(context) {
    context.subscriptions.push(vscode.commands.registerCommand('gemini-copilot.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Gemini API key',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'Enter your key here...'
        });

        if (apiKey) {
            await context.secrets.store('geminiApiKey', apiKey);
            const success = await initializeGenAI(context);
            if (success) {
                vscode.window.showInformationMessage('Gemini API key saved and client initialized!');
                // Re-register providers to use the new client
                registerInlineCompletionProvider(context);
                registerChatParticipant(context);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gemini-copilot.acceptFix', async () => {
        const uuid = await vscode.commands.executeCommand('getContext', 'gemini.diffId');
        if (diffFixStore.has(uuid)) {
            const { uri, selection, suggestedCode } = diffFixStore.get(uuid);
            const document = await vscode.workspace.openTextDocument(uri);
            let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
            if (!editor) {
                editor = await vscode.window.showTextDocument(document);
            }

            editor.edit(editBuilder => {
                editBuilder.replace(selection, suggestedCode);
            });

            diffFixStore.delete(uuid);
            vscode.window.tabGroups.all.forEach(group => group.tabs.forEach(tab => {
                if (tab.input instanceof vscode.TabInputTextDiff && tab.input.original.scheme === 'gemini-diff') {
                    vscode.window.tabGroups.close(tab);
                }
            }));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gemini-copilot.discardFix', async () => {
        const uuid = await vscode.commands.executeCommand('getContext', 'gemini.diffId');
        if (diffFixStore.has(uuid)) {
            diffFixStore.delete(uuid);
            vscode.window.tabGroups.all.forEach(group => group.tabs.forEach(tab => {
                if (tab.input instanceof vscode.TabInputTextDiff && tab.input.original.scheme === 'gemini-diff') {
                    vscode.window.tabGroups.close(tab);
                }
            }));
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('gemini-copilot.generateInNewFile', async () => {
        const prompt = await vscode.window.showInputBox({
            prompt: 'What do you want to generate?',
            placeHolder: 'e.g., a python flask server'
        });

        if (prompt) {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
            const fullPrompt = `Generate a complete code file for the following request: "${prompt}". Your response should be a single JSON object with two keys: "language" (e.g., "python", "javascript") and "code" (the full code content).`;

            try {
                const result = await model.generateContent(fullPrompt);
                const responseText = result.response.text();

                let jsonResponse;
                try {
                    jsonResponse = JSON.parse(responseText);
                } catch (e) {
                    console.error('Failed to parse JSON response from Gemini:', responseText);
                    vscode.window.showErrorMessage('I received an invalid response from the API. I cannot create the file.');
                    return;
                }

                const { language, code } = jsonResponse;

                const newDocument = await vscode.workspace.openTextDocument({
                    content: code,
                    language: language || 'untitled'
                });
                await vscode.window.showTextDocument(newDocument);
            } catch (error) {
                console.error('Error generating code in new file:', error);
                vscode.window.showErrorMessage('Failed to generate code. Please check the extension logs.');
            }
        }
    }));
}

async function initializeGenAI(context) {
    const apiKey = await context.secrets.get('geminiApiKey');
    if (apiKey) {
        genAI = new GoogleGenerativeAI(apiKey);
        return true;
    }
    return false;
}

function registerChatParticipant(context) {
    if (chatParticipant) {
        chatParticipant.dispose();
    }
    chatParticipant = vscode.chat.createChatParticipant('gemini.chatParticipant', async (request, chatContext, stream, token) => {
        if (!genAI) {
            const initialized = await initializeGenAI(context);
            if (!initialized) {
                stream.markdown('Gemini API key is not set. Please run the **Gemini: Set API Key** command to set it.');
                return;
            }
        }
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        
        const editor = vscode.window.activeTextEditor;
        const selection = editor ? editor.document.getText(editor.selection) : '';
        const fileName = editor ? editor.document.fileName : 'the current file';
        const languageId = editor ? editor.document.languageId : 'text';

        let userPrompt = request.prompt;
        let systemInstruction = `You are a helpful coding assistant.`;

        if (request.command) {
            if (request.command === 'explain') {
                if (!selection) {
                    stream.markdown('Please select a block of code in your editor to use this command.');
                    return;
                }
                systemInstruction = `You are an expert at explaining code. Explain the following code snippet clearly and concisely.`;
                userPrompt = `Here is the code:\n\`\`\`\n${selection}\n\`\`\``;
            } else if (request.command === 'fix') {
                if (!selection) {
                    stream.markdown('Please select a block of code in your editor to use this command.');
                    return;
                }

                systemInstruction = `You are an expert at fixing code. Review the following code snippet and provide a corrected version along with a brief explanation of the changes. Please format your response as a single JSON object with two keys: "code" and "explanation".`;
                userPrompt = `Here is the code to fix:\n\`\`\`${languageId}\n${selection}\n\`\`\``;

                try {
                    stream.markdown('Analyzing the code and preparing a suggestion...');

                    const result = await model.generateContent([systemInstruction, userPrompt]);
                    const responseText = result.response.text();

                    let jsonResponse;
                    try {
                        jsonResponse = JSON.parse(responseText);
                    } catch (e) {
                        console.error('Failed to parse JSON response from Gemini:', responseText);
                        stream.markdown('I received an invalid response from the API. I cannot provide a fix at this time.');
                        return;
                    }

                    const { code: suggestedCode, explanation } = jsonResponse;
                    if (!suggestedCode || !explanation) {
                        console.error('Invalid JSON structure from Gemini:', jsonResponse);
                        stream.markdown('The API response was not in the expected format. I cannot provide a fix.');
                        return;
                    }

                    stream.markdown(`\n\n**Explanation of changes:**\n\n${explanation}\n\nI've opened a diff view for you to see the changes. You can accept or discard them there.`);

                    const uuid = crypto.randomUUID();
                    const originalUri = vscode.Uri.parse(`gemini-diff:/original/${uuid}/${fileName}`);
                    const suggestedUri = vscode.Uri.parse(`gemini-diff:/suggested/${uuid}/${fileName}`);

                    diffContentStore.set(originalUri.toString(), selection);
                    diffContentStore.set(suggestedUri.toString(), suggestedCode);
                    diffFixStore.set(uuid, { uri: editor.document.uri, selection, suggestedCode });

                    await vscode.commands.executeCommand('vscode.diff', originalUri, suggestedUri, `Suggestion for ${fileName}`);
                } catch (error) {
                    console.error('Error in /fix command:', error);
                    stream.markdown('I apologize, but I encountered an error while trying to suggest a fix.');
                }
                return;
            }
        }

        const fullPrompt = `${systemInstruction}\n\nUser Prompt: "${userPrompt}"`;

        try {
            const result = await model.generateContentStream(fullPrompt);
            for await (const chunk of result.stream) {
                if (token.isCancellationRequested) break;
                stream.markdown(chunk.text());
            }
        } catch (error) {
            console.error('Error in chat participant:', error);
            stream.markdown('I apologize, but I encountered an error. Please check the extension logs for details.');
        }
    });
    context.subscriptions.push(chatParticipant);
}

function registerInlineCompletionProvider(context) {
    if (inlineCompletionProvider) {
        inlineCompletionProvider.dispose();
    }
    inlineCompletionProvider = vscode.languages.registerInlineCompletionItemProvider(
        ['javascript', 'typescript','python','java','csharp','cpp','ruby','go','php'],
        {
            async provideInlineCompletionItems(document, position, context, token) {
                if (!genAI) return [];

                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (!linePrefix.trim().startsWith('//')) return [];

                const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
                const functionRange = findFunctionOrBlockRange(document, position);
                const codeContext = document.getText(functionRange);

                const prompt = `You are a helpful AI coding assistant. Generate a complete and correct code snippet based on the user's comment. Provide only the code, with no extra explanation or markdown. The code should fit perfectly into the existing file.\n\nFile: ${document.fileName}\n\nCurrent code block:\n\`\`\`${document.languageId}\n${codeContext}\n\`\`\`\n\nUser comment: "${linePrefix.trim()}"\n\nGenerated code:\n`;

                try {
                    const result = await model.generateContent(prompt);
                    const text = result.response.text();
                    if (text) {
                        return [{ insertText: text, range: new vscode.Range(position, position) }];
                    }
                } catch (error) {
                    console.error('Error generating inline completion from Gemini API:', error);
                }
                return [];
            }
        }
    ));
    context.subscriptions.push(inlineCompletionProvider);
}

class GeminiChatViewProvider {
    constructor(context) {
        this.context = context;
    }

    resolveWebviewView(webviewView, context, token) {
        this.webviewView = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'webview'))]
        };

        const htmlPath = path.join(this.context.extensionPath, 'webview', 'chat.html');
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const scriptUri = webviewView.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'chat.js')));
        const styleUri = webviewView.webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'chat.css')));

        htmlContent = htmlContent.replace('${scriptUri}', scriptUri).replace('${styleUri}', styleUri);
        webviewView.webview.html = htmlContent;

        webviewView.webview.onDidReceiveMessage(async message => {
            if (message.command === 'new-message') {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
                const prompt = `You are a helpful coding assistant. Respond to the user's request. If you are providing code, format your response as a single JSON object with two keys: "language" and "code". If you are providing a natural language response, just respond with the text.\n\nUser request: "${message.text}"`;
                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                this.webviewView.webview.postMessage({ command: 'new-message-response', text: text });
            } else if (message.command === 'create-new-file') {
                const newDocument = await vscode.workspace.openTextDocument({
                    content: message.code,
                    language: message.language
                });
                await vscode.window.showTextDocument(newDocument);
            } else if (message.command === 'merge-into-file') {
                const openEditors = vscode.window.visibleTextEditors;
                const items = openEditors.map(editor => ({
                    label: path.basename(editor.document.fileName),
                    description: editor.document.fileName,
                    document: editor.document
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a file to merge into'
                });

                if (selected) {
                    const editor = await vscode.window.showTextDocument(selected.document);
                    vscode.window.showInformationMessage('Please select the code you want to replace.');

                    const disposable = vscode.window.onDidChangeTextEditorSelection(async e => {
                        if (e.textEditor === editor && e.selections[0].start.isEqual(e.selections[0].end) === false) {
                            await editor.edit(editBuilder => {
                                editBuilder.replace(e.selections[0], message.code);
                            });
                            disposable.dispose();
                        }
                    });
                }
            }
        });
    }
}

function deactivate() {}

function findFunctionOrBlockRange(document, position) {
    let startLine = position.line;
    let endLine = position.line;
    while (startLine > 0 && document.lineAt(startLine - 1).text.trim() !== '') {
        startLine--;
    }
    while (endLine < document.lineCount - 1 && document.lineAt(endLine + 1).text.trim() !== '') {
        endLine++;
    }
    return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
}

module.exports = {
    activate,
    deactivate
};
