// Import the VS Code API and the Gemini API client
const vscode = require('vscode');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// IMPORTANT: Do not hardcode your API key. Use SecretStorage.
let genAI;

function activate(context) {

    // Command to set the API key securely.
    context.subscriptions.push(vscode.commands.registerCommand('gemini-copilot.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Gemini API key',
            password: true,
            ignoreFocusOut: true
        });

        if (apiKey) {
            await context.secrets.store('geminiApiKey', apiKey);
            vscode.window.showInformationMessage('Gemini API key saved securely!');
            // Reset the genAI instance to use the new key
            genAI = undefined;
        }
    }));

    // Register an inline completion provider for JavaScript and TypeScript
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
        ['javascript', 'typescript'],
        {
            async provideInlineCompletionItems(document, position, inlineContext, token) {
                const apiKey = await context.secrets.get('geminiApiKey');
                if (!apiKey) {
                    // Don't show a warning on every keystroke
                    return [];
                }

                if (!genAI) {
                    genAI = new GoogleGenerativeAI(apiKey);
                }

                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

                // A simple trigger logic: we provide a suggestion after a comment
                if (!linePrefix.trim().startsWith('//')) {
                    return [];
                }

                // Get the text of the current function or a block of surrounding code
                const functionRange = findFunctionOrBlockRange(document, position);
                const codeContext = document.getText(functionRange);

                // Build a prompt that includes the current file and code context
                const prompt = `You are a helpful AI coding assistant. Generate a complete and correct code snippet based on the user's comment. Provide only the code, with no extra explanation or markdown. The code should fit perfectly into the existing file.

File: ${document.fileName}

Current code block:
\`\`\`${document.languageId}
${codeContext}
\`\`\`

User comment: "${linePrefix.trim()}"

Generated code:
`;

                try {
                    const result = await model.generateContent(prompt);
                    const response = result.response;
                    const responseText = response.text();

                    if (responseText) {
                        return [
                            {
                                insertText: responseText,
                                range: new vscode.Range(position, position)
                            }
                        ];
                    }
                } catch (error) {
                    console.error('Error generating content from Gemini API:', error);
                    return [];
                }

                return [];
            }
        }
    ));

    // Register a chat participant for a conversational UI
    context.subscriptions.push(vscode.chat.createChatParticipant('gemini.chatParticipant', async (request, chatContext, stream, token) => {
        const apiKey = await context.secrets.get('geminiApiKey');
        if (!apiKey) {
            stream.markdown('Please set your Gemini API key using the "Gemini Copilot: Set API Key" command.');
            return;
        }

        if (!genAI) {
            genAI = new GoogleGenerativeAI(apiKey);
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const fullPrompt = `You are a coding assistant. Answer the user's question about the codebase. Be concise but thorough.

User prompt: "${request.prompt}"
`;

        try {
            const result = await model.generateContentStream(fullPrompt);
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                stream.markdown(chunkText);
            }
        } catch (error) {
            console.error('Error in chat participant:', error);
            stream.markdown('I apologize, but I encountered an error while processing your request.');
        }
    }));
}

// This function is called when your extension is deactivated
function deactivate() {}

// Helper function to find the range of the current function or class
function findFunctionOrBlockRange(document, position) {
    let startLine = position.line;
    let endLine = position.line;

    // A simple, heuristic-based approach to find a code block
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
