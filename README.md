# AIアプリ集

Markdown のプロンプトと HTML 画面を組み合わせて、LLM を使った小さなアプリを動かす Node.js サーバーです。現在は IT パスポート対策クイズと言い訳メーカーを収録しています。

## Features

- 🎯 **Generic Design**: One API endpoint for all included apps
- 📝 **Markdown Prompts**: Define each app's logic in a Markdown prompt
- 🔄 **Variable Substitution**: Automatic replacement of `${variable}` placeholders
- 🤖 **Multi-Provider**: Supports OpenAI and Google Gemini
- 🔀 **Prompt Routing**: Select an app's registered prompt with the `app` request field

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env.local` and set your API key:

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
# For OpenAI (default)
OPENAI_API_KEY=your_openai_api_key_here

# For Gemini (if switching)
GEMINI_API_KEY=your_gemini_api_key_here

PORT=8080
```

> `.env.local` holds your real keys and is git-ignored. Do not commit it.

### 3. Configure LLM Provider

Edit the `PROVIDER` constant near the top of `server.js`:

```javascript
// For OpenAI (default) -> gpt-6-luna
const PROVIDER = 'openai';

// For Gemini -> gemini-4-hydrogen
// const PROVIDER = 'gemini';
```

The model is selected automatically from the `MODELS` map based on `PROVIDER`.

### 4. Start Server

```bash
npm start
```

Visit `http://localhost:8080`

## How It Works

### Architecture

```
Client HTML → POST /api/ → server.js → LLM → Response
                                ↓
                 prompt.md / prompts/excuse.md
```

### Variable Substitution

The API automatically replaces variables in `prompt.md` with request data:

**prompt.md:**
```markdown
Create ${count} questions about ${topic}.
Format: JSON array
```

**Request:**
```json
{
  "count": 5,
  "topic": "JavaScript"
}
```

**Result:** Variables `${count}` and `${topic}` are replaced with actual values.

### API Endpoint

**POST** `/api/`

**Request Body:**
```json
{
  "app": "quiz",
  "title": "My Quiz",
  "count": 5,
  "any_variable": "value"
}
```

`app` は `quiz` または `excuse` を指定します。省略すると `quiz` になります。指定したアプリに対応するプロンプトの `${variable}` が、リクエスト値に置き換わります。

**Response:**
```json
{
  "title": "My Quiz",
  "data": [...]
}
```

## Example Applications

### 1. IT Certification Quiz

**Files:**
- `prompt.md` - Defines IT quiz generation logic
- `public/quiz.html` - Quiz interface

**Usage:** Generate IT certification practice questions

### 2. 言い訳メーカー

**Files:**
- `prompts/excuse.md` - Defines the excuse generation logic
- `public/excuse.html` - Excuse maker interface

The app sends `app: "excuse"` along with `situation` and `style` to `/api/`.

### 3. Translation App (Example)

**prompt.md:**
```markdown
# Translation Service

Translate the following text to ${target_language}:

"${text}"

Return only the translated text.
```

**Request:**
```json
{
  "text": "Hello world",
  "target_language": "Japanese"
}
```

### 3. Code Review App (Example)

**prompt.md:**
```markdown
# Code Review Assistant

Review this ${language} code and provide feedback:

```${language}
${code}
```

Provide:
1. Issues found
2. Suggestions for improvement
3. Best practices
```

**Request:**
```json
{
  "language": "Python",
  "code": "def hello():\n    print('world')"
}
```

## File Structure

```
generic-webapi/
├── server.js          # API server and app-to-prompt mapping
├── prompt.md          # IT quiz prompt template
├── prompts/
│   └── excuse.md       # Excuse maker prompt template
├── package.json       # Dependencies
├── .env.example       # Environment variables template
├── public/            # Static files
│   ├── quiz.html     # IT quiz application
│   ├── excuse.html   # Excuse maker
│   ├── style.css     # Styles
│   ├── excuse.css    # Excuse maker styles
│   └── quiz.css      # Quiz-specific styles
└── README.md         # This file
```

## Creating New Applications

1. **Create a prompt file** - Define the app logic and variables in Markdown
2. **Register the prompt in `server.js`** - Add its app name to `PROMPT_FILES`
3. **Create client HTML** - Build the interface in `public/` and send its app name plus variables to `/api/`

Each app has a registered prompt template and its own client page.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes (if using Gemini) |
| `OPENAI_API_KEY` | OpenAI API key | Yes (if using OpenAI) |
| `PORT` | Server port | No (default: 8080) |

## LLM Provider Configuration

### Switch to OpenAI (default)

1. Edit `server.js`:
```javascript
const PROVIDER = 'openai';
```

2. Set OpenAI API key in `.env.local`:
```env
OPENAI_API_KEY=your_key_here
```

### Switch to Gemini

1. Edit `server.js`:
```javascript
const PROVIDER = 'gemini';
```

2. Set Gemini API key in `.env.local`:
```env
GEMINI_API_KEY=your_key_here
```

## Development

### Run with auto-restart:
```bash
npm run dev
```

### Supported Models

**OpenAI:**
- `gpt-6-luna` (default)

**Gemini:**
- `gemini-4-hydrogen` (called with `thinkingLevel: "LOW"`; thinking tokens count toward `maxOutputTokens`)

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
