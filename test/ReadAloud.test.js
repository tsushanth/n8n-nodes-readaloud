'use strict';
// Unit tests: run the node's execute() against a mocked IExecuteFunctions.
// Run with `npm test` (builds first, then uses the built files in dist/).
const test = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { ReadAloud } = require('../dist/nodes/ReadAloud/ReadAloud.node.js');
const { ReadAloudApi } = require('../dist/credentials/ReadAloudApi.credentials.js');

function makeCtx({ items = [{ json: {} }], params = {}, response, continueOnFail = false, baseUrl } = {}) {
	const calls = [];
	const perItem = (i) => ({
		resource: 'speech',
		operation: 'textToSpeech',
		text: 'Hello',
		voice: 'piper-default',
		format: 'mp3',
		speed: 1,
		options: {},
		...(Array.isArray(params) ? params[i] : params),
	});
	const ctx = {
		getInputData: () => items,
		getNodeParameter: (name, i, fallback) => {
			const v = perItem(i)[name];
			return v === undefined ? fallback : v;
		},
		getCredentials: async () => ({ apiKey: 'test-key', ...(baseUrl !== undefined ? { baseUrl } : {}) }),
		getNode: () => ({ name: 'ReadAloud', type: 'n8n-nodes-readaloud.readAloud', typeVersion: 1, id: 'x', position: [0, 0], parameters: {} }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async function (cred, opts) {
				calls.push({ cred, opts });
				return typeof response === 'function' ? response(opts, calls.length) : response;
			},
			prepareBinaryData: async (buf, fileName, mimeType) => ({ data: buf.toString('base64'), fileName, mimeType }),
		},
	};
	return { ctx, calls };
}
const run = (ctx) => new ReadAloud().execute.call(ctx);
const audio = Buffer.from('ID3fakeaudiobytes');
const ok = { statusCode: 200, headers: { 'content-type': 'audio/mpeg', 'x-sample-rate': '24000' }, body: audio };
const err = (statusCode, message) => ({
	statusCode,
	headers: {},
	body: Buffer.from(JSON.stringify({ error: { message, type: 'invalid_request_error' } })),
});

test('text to speech sends the OpenAI-compatible request and returns binary audio', async () => {
	const { ctx, calls } = makeCtx({ response: ok, params: { text: 'Hi there', voice: 'piper-default', speed: 1.5 } });
	const [out] = await run(ctx);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].cred, 'readAloudApi');
	assert.equal(calls[0].opts.method, 'POST');
	assert.equal(calls[0].opts.url, 'https://api.readaloudai.org/v1/audio/speech');
	assert.equal(calls[0].opts.encoding, 'arraybuffer');
	assert.deepEqual(JSON.parse(calls[0].opts.body), {
		model: 'tts-1',
		input: 'Hi there',
		voice: 'piper-default',
		response_format: 'mp3',
		speed: 1.5,
	});
	assert.equal(out.length, 1);
	assert.equal(out[0].binary.data.fileName, 'speech.mp3');
	assert.equal(out[0].binary.data.mimeType, 'audio/mpeg');
	assert.equal(Buffer.from(out[0].binary.data.data, 'base64').toString(), audio.toString());
	assert.equal(out[0].json.sampleRate, 24000);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
});

test('formats map to the right mime type and extension; options are honoured', async () => {
	const cases = { wav: 'audio/wav', opus: 'audio/ogg', pcm: 'audio/pcm' };
	for (const [format, mime] of Object.entries(cases)) {
		const { ctx } = makeCtx({
			response: { statusCode: 200, headers: {}, body: audio },
			params: { format, options: { fileName: 'greeting', binaryPropertyName: 'sound' } },
		});
		const [out] = await run(ctx);
		assert.equal(out[0].binary.sound.fileName, `greeting.${format}`);
		assert.equal(out[0].binary.sound.mimeType, mime);
	}
});

test('custom base URL is used and trailing slashes are trimmed', async () => {
	const { ctx, calls } = makeCtx({ response: ok, baseUrl: 'https://tts.example.com//' });
	await run(ctx);
	assert.equal(calls[0].opts.url, 'https://tts.example.com/v1/audio/speech');
});

test('empty base URL falls back to the default', async () => {
	const { ctx, calls } = makeCtx({ response: ok, baseUrl: '' });
	await run(ctx);
	assert.equal(calls[0].opts.url, 'https://api.readaloudai.org/v1/audio/speech');
});

test('multiple input items produce one output each with paired items', async () => {
	const { ctx, calls } = makeCtx({
		items: [{ json: {} }, { json: {} }, { json: {} }],
		response: ok,
		params: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
	});
	const [out] = await run(ctx);
	assert.equal(calls.length, 3);
	assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1, 2]);
	assert.deepEqual(calls.map((c) => JSON.parse(c.opts.body).input), ['one', 'two', 'three']);
});

for (const [status, apiMsg, expected] of [
	[401, 'Invalid API key', /Invalid ReadAloud API key/],
	[402, 'Free tier exhausted', /free tier exhausted/],
	[400, 'bad voice', /rejected the request: bad voice/],
	[500, 'boom', /HTTP 500/],
]) {
	test(`HTTP ${status} becomes a NodeApiError with a clear message`, async () => {
		const { ctx } = makeCtx({ response: err(status, apiMsg) });
		await assert.rejects(run(ctx), (e) => {
			assert.ok(e instanceof NodeApiError);
			assert.match(e.message, expected);
			assert.equal(String(e.httpCode), String(status));
			return true;
		});
	});
}

test('402 description tells the user what to do', async () => {
	const { ctx } = makeCtx({ response: err(402, 'x') });
	await assert.rejects(run(ctx), (e) => /Add credit or upgrade/.test(e.description));
});

test('validation errors are NodeOperationError and make no request', async () => {
	const bad = [
		{ text: '   ' },
		{ text: 'a'.repeat(5001) },
		{ speed: 5 },
		{ speed: 0.1 },
		{ format: 'flac' },
	];
	for (const params of bad) {
		const { ctx, calls } = makeCtx({ response: ok, params });
		await assert.rejects(run(ctx), (e) => e instanceof NodeOperationError);
		assert.equal(calls.length, 0);
	}
});

test('exactly 5000 characters is accepted', async () => {
	const { ctx, calls } = makeCtx({ response: ok, params: { text: 'a'.repeat(5000) } });
	await run(ctx);
	assert.equal(calls.length, 1);
});

test('continueOnFail returns an error item and keeps processing the rest', async () => {
	const { ctx } = makeCtx({
		items: [{ json: {} }, { json: {} }],
		continueOnFail: true,
		response: (_o, n) => (n === 1 ? err(402, 'x') : ok),
	});
	const [out] = await run(ctx);
	assert.equal(out.length, 2);
	assert.match(out[0].json.error, /free tier exhausted/);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.ok(out[1].binary.data);
});

test('empty audio response is rejected', async () => {
	const { ctx } = makeCtx({ response: { statusCode: 200, headers: {}, body: Buffer.alloc(0) } });
	await assert.rejects(run(ctx), (e) => /empty audio/.test(e.message));
});

test('network failure is wrapped in NodeApiError', async () => {
	const { ctx } = makeCtx({
		response: () => {
			throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
		},
	});
	await assert.rejects(run(ctx), (e) => e instanceof NodeApiError);
});

test('credential: bearer auth, secret field, default base URL, test request', () => {
	const c = new ReadAloudApi();
	const key = c.properties.find((p) => p.name === 'apiKey');
	assert.equal(key.typeOptions.password, true);
	assert.equal(c.properties.find((p) => p.name === 'baseUrl').default, 'https://api.readaloudai.org');
	assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(c.test.request.url, '/v1/voices');
});

test('empty voice falls back to piper-default', async () => {
	const { ctx, calls } = makeCtx({ response: ok, params: { voice: '   ' } });
	await run(ctx);
	assert.equal(JSON.parse(calls[0].opts.body).voice, 'piper-default');
});

test('voice field defaults to piper-default and is free text', () => {
	const prop = new ReadAloud().description.properties.find((p) => p.name === 'voice');
	assert.equal(prop.default, 'piper-default');
	assert.equal(prop.type, 'string');
});

test('only the Speech resource exists (no voice listing is offered)', () => {
	const resource = new ReadAloud().description.properties.find((p) => p.name === 'resource');
	assert.deepEqual(resource.options.map((o) => o.value), ['speech']);
});
