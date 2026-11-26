const express = require('express');
const fs = require('fs');
const path = require('path');
// API Key などの環境変数は .env.local から読み込む
require('dotenv').config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// ===== 設定 =====
// 利用するLLMプロバイダを選択します（'openai' または 'gemini'）
const PROVIDER = 'openai';

// プロバイダごとに利用するモデル
const MODELS = {
    openai: 'gpt-6-luna',        // OpenAI（デフォルト）
    gemini: 'gemini-4-hydrogen', // Google Gemini
};
const MODEL = MODELS[PROVIDER];

// OpenAI Structured Outputs schemas for each app.
const RESPONSE_SCHEMAS = {
    quiz: {
        type: 'object',
        properties: {
            data: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        question: { type: 'string' },
                        selections: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 4,
                            maxItems: 4,
                        },
                        answer: { type: 'integer', enum: [0, 1, 2, 3] },
                    },
                    required: ['question', 'selections', 'answer'],
                    additionalProperties: false,
                },
            },
        },
        required: ['data'],
        additionalProperties: false,
    },
    excuse: {
        type: 'object',
        properties: {
            data: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        excuse: { type: 'string' },
                        reason: { type: 'string' },
                    },
                    required: ['excuse', 'reason'],
                    additionalProperties: false,
                },
                minItems: 1,
                maxItems: 1,
            },
        },
        required: ['data'],
        additionalProperties: false,
    },
};

const PROMPT_FILES = {
    quiz: path.join(__dirname, 'prompt.md'),
    excuse: path.join(__dirname, 'prompts', 'excuse.md'),
};

const PROMPT_TEMPLATES = {};
try {
    for (const [name, filePath] of Object.entries(PROMPT_FILES)) {
        PROMPT_TEMPLATES[name] = fs.readFileSync(filePath, 'utf8');
    }
} catch (error) {
    console.error('Error reading an application prompt:', error);
    process.exit(1);
}

const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

// public/ 内の .html 一覧を返す（index.html がこの一覧を使ってリンクを表示する）
app.get('/api/pages', (req, res) => {
    const files = fs.readdirSync('public')
        .filter(name => name.endsWith('.html') && name !== 'index.html');
    res.json(files);
});

// 問題数の上限（過剰なリクエストでトークンを浪費しないようにする）
const MAX_COUNT = 20;

app.post('/api/', async (req, res) => {
    try {
        // 使用するプロンプトはサーバー側の許可リストから選ぶ
        const { app: appName = 'quiz', title = 'Generated Content', ...variables } = req.body;
        const promptTemplate = PROMPT_TEMPLATES[appName];
        if (!promptTemplate) {
            return res.status(400).json({ error: 'Unknown app' });
        }

        // count が指定されている場合は 1〜MAX_COUNT の範囲に収める
        if (variables.count !== undefined) {
            const count = Number(variables.count);
            if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
                return res.status(400).json({
                    error: `count must be an integer between 1 and ${MAX_COUNT}`,
                });
            }
        }

        // prompt.md のテンプレート変数 ${key} をリクエストの値で置換する
        const finalPrompt = fillTemplate(promptTemplate, variables);

        let result;
        if (PROVIDER === 'openai') {
            result = await callOpenAI(finalPrompt, appName, Number(variables.count));
        } else if (PROVIDER === 'gemini') {
            result = await callGemini(finalPrompt, appName, Number(variables.count));
        } else {
            return res.status(400).json({ error: 'Invalid provider configuration' });
        }

        res.json({
            title: title,
            data: result,
        });

    } catch (error) {
        // 詳細はサーバーログにのみ出力し、クライアントには汎用メッセージを返す
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to generate content. Please try again.' });
    }
});

// prompt.md 内の ${key} を variables の値で安全に置換する
function fillTemplate(template, variables) {
    return template.replace(/\$\{(\w+)\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(variables, key)
            ? String(variables[key])
            : match; // 対応する値がなければそのまま残す
    });
}

async function callOpenAI(prompt, appName, count) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const response = await fetch(OPENAI_API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: prompt }
            ],
            max_completion_tokens: 2000,
            response_format: getResponseFormat(appName, count)
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
        throw new Error('OpenAI returned no completion choice');
    }
    if (choice.message?.refusal) {
        throw new Error('OpenAI refused to generate a response');
    }
    if (choice.finish_reason !== 'stop') {
        throw new Error(`OpenAI response did not finish normally: ${choice.finish_reason}`);
    }

    return extractArray(choice.message?.content, appName, count);
}

function getResponseFormat(appName, count) {
    const baseSchema = RESPONSE_SCHEMAS[appName];
    const dataSchema = { ...baseSchema.properties.data };

    // When the quiz requests a count, constrain the response array to exactly that size.
    if (appName === 'quiz' && Number.isInteger(count)) {
        dataSchema.minItems = count;
        dataSchema.maxItems = count;
    }

    return {
        type: 'json_schema',
        json_schema: {
            name: `${appName}_response`,
            strict: true,
            schema: {
                ...baseSchema,
                properties: {
                    ...baseSchema.properties,
                    data: dataSchema,
                },
            },
        },
    };
}

async function callGemini(prompt, appName, count) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const response = await fetch(`${GEMINI_API_BASE_URL}${MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                // 思考型モデルでは思考トークンもこの上限に含まれるため、余裕を持たせる
                maxOutputTokens: 8192,
                response_mime_type: "application/json",
                // クイズ生成に深い思考は不要。HIGH（既定）だと思考で上限に達し JSON が途中で切れることがある
                thinkingConfig: { thinkingLevel: "LOW" }
            }
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Gemini API error');
    }

    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    return extractArray(responseText, appName, count);
}

// Parse the model response and validate the app data before returning it to the UI.
function extractArray(responseText, appName, count) {
    let parsedData;
    try {
        parsedData = JSON.parse(responseText);
    } catch (parseError) {
        throw new Error('Failed to parse LLM response: ' + parseError.message);
    }

    const arrayData = parsedData?.data;
    if (!Array.isArray(arrayData)) {
        throw new Error('The LLM response must contain a data array.');
    }

    if (appName === 'excuse') {
        if (arrayData.length !== 1 || !arrayData.every(item =>
            typeof item?.excuse === 'string' && typeof item?.reason === 'string')) {
            throw new Error('The LLM response does not match the excuse schema.');
        }
    } else if (appName === 'quiz') {
        if ((Number.isInteger(count) && arrayData.length !== count) || !arrayData.every(item =>
            typeof item?.question === 'string' &&
            Array.isArray(item?.selections) &&
            item.selections.length === 4 &&
            item.selections.every(selection => typeof selection === 'string') &&
            Number.isInteger(item?.answer) && item.answer >= 0 && item.answer <= 3)) {
            throw new Error('The LLM response does not match the quiz schema.');
        }
    }
    return arrayData;
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Config: ${PROVIDER} - ${MODEL}`);
});
