// Import the VS Code API and the Gemini API client
const vscode = require('vscode');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Module-level variable to hold the initialized Gemini client
let genAI;

/**
 * Initializes the GoogleGenerativeAI client using the API key from secret storage.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @returns {Promise<boolean>} - True if initialization was successful, false otherwise.
 */
async function initializeGenAI(context) {
    const apiKey = await context.secrets.get('geminiApiKey');
    if (apiKey) {
        genAI = new GoogleGenerativeAI(apiKey);
        return true;
    }
    // If no API key is found, genAI remains undefined.
    return false;
}

/**
 * This function is called when your extension is activated.
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    console.log('Congratulations, your extension "gemini-copilot" is now active!');

    // Attempt to initialize the Gemini client on activation
    await initializeGenAI(context);

    // Command to set the API key securely.
    context.subscriptions.push(vscode.commands.registerCommand('gemini-copilot.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Gemini API key',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'Enter your key here...'
        });

        if (apiKey) {
            await context.secrets.store('geminiApiKey', apiKey);
            // Re-initialize the client with the new key
            const success = await initializeGenAI(context);
            if (success) {
                vscode.window.showInformationMessage('Gemini API key saved and client initialized!');
            }
        }
    }));

    // Register an inline completion provider for JavaScript and TypeScript
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
        ['javascript', 'typescript','python','java','csharp','cpp','ruby','go','php'],
        {
            async provideInlineCompletionItems(document, position, context, token) {
                if (!genAI) return [];

                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                if (!linePrefix.trim().startsWith('//')) return [];

                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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

    // Register a chat participant for a conversational UI
    context.subscriptions.push(vscode.chat.createChatParticipant('gemini.chatParticipant', async (request, chatContext, stream, token) => {
        if (!genAI) {
            const initialized = await initializeGenAI(context);
            if (!initialized) {
                stream.markdown('Gemini API key is not set. Please run the **Gemini: Set API Key** command to set it.');
                return;
            }
        }
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Get the active editor to check for selected text and full file content
        const editor = vscode.window.activeTextEditor;
        const selection = editor ? editor.document.getText(editor.selection) : '';
        const fileContent = editor ? editor.document.getText() : '';
        const fileName = editor ? editor.document.fileName : 'the current file';
        const languageId = editor ? editor.document.languageId : 'text';

        let userPrompt = request.prompt;
        let systemInstruction = `You are a helpful coding assistant.`;

        // Add the full file content to the system instruction if an editor is active
        if (editor && fileContent) {
            systemInstruction += ` The user is currently viewing the file "${fileName}". Here is the full content of that file:\n\n\`\`\`${languageId}\n${fileContent}\n\`\`\`\n\nBased on this file context, answer the user's question concisely.`;
        } else {
            systemInstruction += ` Answer the user's question concisely.`;
        }


        // Handle specific slash commands
        if (request.command) {
            if (request.command === 'explain' || request.command === 'fix') {
                if (!selection) {
                    stream.markdown('Please select a block of code in your editor to use this command.');
                    return;
                }
                // Override the system instruction for slash commands
                systemInstruction = request.command === 'explain' 
                    ? `You are an expert at explaining code. Explain the following code snippet clearly and concisely.`
                    : `You are an expert at fixing code. Suggest a fix for the following code snippet, providing the corrected code and a brief explanation.`;
                userPrompt = `Here is the code:\n\`\`\`\n${selection}\n\`\`\``;
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
    }));
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
