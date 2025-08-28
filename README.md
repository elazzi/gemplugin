Gemini Copilot VS Code Extension
This is a custom VS Code extension that provides features similar to GitHub Copilot, but powered by Google's Gemini API.

Features
Inline Code Suggestions: Get code completions based on comments. Simply write a comment (e.g., // function to fetch data from an API) and the extension will suggest the code.
AI Chat Assistant: A chat panel powered by Gemini to answer your coding questions.
Secure API Key Storage: Your Gemini API key is stored securely using VS Code's SecretStorage.
Prerequisites
Node.js and npm
A Gemini API Key from Google AI Studio.
How to Compile and Run
These are the instructions for running the extension from the source code in a development environment.

1. Install Dependencies
Install the necessary npm packages defined in package.json. From the root of the project directory, run:

npm install
2. Compile the TypeScript
Compile the TypeScript code from the src directory into JavaScript in the out directory.

npm run compile
3. Run the Extension
Now you can launch the extension in a special VS Code window called the "Extension Development Host".

Open this project folder in VS Code.
Go to the Run and Debug view (or press F5).
Select Run Extension from the dropdown menu and click the green play button.
A new VS Code window will open with the extension running.
How to Use
Set Your API Key: In the new window (the Extension Development Host), open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P).
Type Gemini Copilot: Set API Key and press Enter.
Paste your Gemini API key when prompted.
Test Inline Completion: Open a JavaScript or TypeScript file. Type a comment like // function to add two numbers and you should see a code suggestion.
Test Chat: Open the Chat view in the activity bar, select "Gemini" from the dropdown, and ask a question.
