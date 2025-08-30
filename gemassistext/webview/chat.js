(function () {
    const vscode = acquireVsCodeApi();

    const messageContainer = document.getElementById('message-container');
    const promptInput = document.getElementById('prompt-input');
    const sendButton = document.getElementById('send-button');

    sendButton.addEventListener('click', () => {
        const prompt = promptInput.value;
        if (prompt) {
            vscode.postMessage({
                command: 'new-message',
                text: prompt
            });

            const userMessage = document.createElement('div');
            userMessage.className = 'message user-message';
            userMessage.textContent = prompt;
            messageContainer.appendChild(userMessage);

            promptInput.value = '';
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'new-message-response':
                let response;
                try {
                    response = JSON.parse(message.text);
                } catch (e) {
                    response = { text: message.text };
                }

                const geminiMessage = document.createElement('div');
                geminiMessage.className = 'message gemini-message';

                if (response.code) {
                    const pre = document.createElement('pre');
                    const code = document.createElement('code');
                    code.textContent = response.code;
                    pre.appendChild(code);
                    geminiMessage.appendChild(pre);

                    const buttonContainer = document.createElement('div');
                    const copyButton = document.createElement('button');
                    copyButton.textContent = 'Copy';
                    copyButton.addEventListener('click', () => {
                        navigator.clipboard.writeText(response.code);
                    });
                    buttonContainer.appendChild(copyButton);

                    const newFileButton = document.createElement('button');
                    newFileButton.textContent = 'Create New File';
                    newFileButton.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'create-new-file',
                            code: response.code,
                            language: response.language
                        });
                    });
                    buttonContainer.appendChild(newFileButton);

                    const mergeButton = document.createElement('button');
                    mergeButton.textContent = 'Merge into File...';
                    mergeButton.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'merge-into-file',
                            code: response.code
                        });
                    });
                    buttonContainer.appendChild(mergeButton);

                    geminiMessage.appendChild(buttonContainer);

                } else {
                    geminiMessage.textContent = response.text || message.text;
                }

                messageContainer.appendChild(geminiMessage);
                break;
        }
    });
}());
