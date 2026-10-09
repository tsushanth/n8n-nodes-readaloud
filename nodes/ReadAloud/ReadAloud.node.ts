import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const DEFAULT_BASE_URL = 'https://api.readaloudai.org';
const MAX_CHARACTERS = 5000;
const DEFAULT_VOICE = 'piper-default';

const FORMATS: Record<string, { mimeType: string; extension: string }> = {
	mp3: { mimeType: 'audio/mpeg', extension: 'mp3' },
	wav: { mimeType: 'audio/wav', extension: 'wav' },
	opus: { mimeType: 'audio/ogg', extension: 'opus' },
	pcm: { mimeType: 'audio/pcm', extension: 'pcm' },
};

function describeApiError(status: number, apiMessage: string): { message: string; description: string } {
	switch (status) {
		case 401:
			return {
				message: 'Invalid ReadAloud API key',
				description: 'Check the API key in your ReadAloud credential.',
			};
		case 402:
			return {
				message: 'ReadAloud free tier exhausted',
				description:
					'The free allowance is one shared pool per account owner across all of their API keys, and it has been used up. Add credit or upgrade your plan at https://readaloudai.org, then run the node again.',
			};
		case 400:
		case 404:
		case 422:
			return {
				message: `ReadAloud rejected the request: ${apiMessage}`,
				description: 'Check the text, voice, speed and output format parameters.',
			};
		case 429:
		case 503:
			return {
				message: 'ReadAloud is busy or rate limited',
				description: `${apiMessage}. Wait a moment and try again.`,
			};
		default:
			return { message: `ReadAloud request failed (HTTP ${status}): ${apiMessage}`, description: apiMessage };
	}
}

function parseErrorBody(body: unknown): { message: string; raw: IDataObject } {
	let text = '';
	if (Buffer.isBuffer(body)) text = body.toString('utf8');
	else if (typeof body === 'string') text = body;
	else if (body && typeof body === 'object') text = JSON.stringify(body);

	let parsed: unknown = text;
	try {
		parsed = JSON.parse(text);
	} catch {
		// not JSON, keep text
	}
	if (parsed && typeof parsed === 'object') {
		const obj = parsed as IDataObject;
		const err = obj.error;
		if (err && typeof err === 'object' && typeof (err as IDataObject).message === 'string') {
			return { message: (err as IDataObject).message as string, raw: obj };
		}
		if (typeof err === 'string') return { message: err, raw: obj };
		if (typeof obj.message === 'string') return { message: obj.message, raw: obj };
		return { message: text.slice(0, 300), raw: obj };
	}
	return { message: text.slice(0, 300) || 'Unknown error', raw: { body: text.slice(0, 300) } };
}

export class ReadAloud implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ReadAloud',
		name: 'readAloud',
		icon: { light: 'file:readaloud.svg', dark: 'file:readaloud.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Convert text to speech with the ReadAloud API',
		defaults: {
			name: 'ReadAloud',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'readAloudApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Speech', value: 'speech' },
				],
				default: 'speech',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['speech'] } },
				options: [
					{
						name: 'Text to Speech',
						value: 'textToSpeech',
						description: 'Convert text to spoken audio',
						action: 'Convert text to speech',
					},
				],
				default: 'textToSpeech',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				placeholder: 'Hello from n8n',
				description: `The text to speak (up to ${MAX_CHARACTERS} characters)`,
				displayOptions: { show: { resource: ['speech'], operation: ['textToSpeech'] } },
			},
			{
				displayName: 'Voice',
				name: 'voice',
				type: 'string',
				default: 'piper-default',
				description:
					'Voice ID to speak with. Currently only piper-default is offered, which is the default.',
				displayOptions: { show: { resource: ['speech'], operation: ['textToSpeech'] } },
			},
			{
				displayName: 'Output Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'MP3', value: 'mp3' },
					{ name: 'Opus (Ogg)', value: 'opus' },
					{ name: 'PCM (Raw 16-Bit)', value: 'pcm' },
					{ name: 'WAV', value: 'wav' },
				],
				default: 'mp3',
				description: 'The audio format of the generated file',
				displayOptions: { show: { resource: ['speech'], operation: ['textToSpeech'] } },
			},
			{
				displayName: 'Speed',
				name: 'speed',
				type: 'number',
				typeOptions: { minValue: 0.25, maxValue: 4, numberPrecision: 2 },
				default: 1,
				description: 'Speaking speed multiplier (0.25 to 4)',
				displayOptions: { show: { resource: ['speech'], operation: ['textToSpeech'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['speech'], operation: ['textToSpeech'] } },
				options: [
					{
						displayName: 'Base File Name',
						name: 'fileName',
						type: 'string',
						default: 'speech',
						description: 'File name for the audio, without extension (it is added from the output format)',
					},
					{
						displayName: 'Model',
						name: 'model',
						type: 'string',
						default: 'tts-1',
						description:
							'Model name sent to the OpenAI-compatible endpoint. Most users can leave this unchanged.',
					},
					{
						displayName: 'Put Output in Field',
						name: 'binaryPropertyName',
						type: 'string',
						default: 'data',
						description: 'Name of the binary property that will hold the audio',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('readAloudApi');
		const baseUrl = (((credentials.baseUrl as string) || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL).replace(
			/\/+$/,
			'',
		);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				const requestOptions: IHttpRequestOptions = {
					url: '',
					method: 'GET',
					returnFullResponse: true,
					ignoreHttpStatusErrors: true,
				};

				let format = 'mp3';
				let fileBase = 'speech';
				let binaryProperty = 'data';
				let voice = DEFAULT_VOICE;
				let text = '';

				if (resource === 'speech' && operation === 'textToSpeech') {
					text = this.getNodeParameter('text', i) as string;
					voice = (this.getNodeParameter('voice', i, DEFAULT_VOICE) as string).trim() || DEFAULT_VOICE;
					format = this.getNodeParameter('format', i, 'mp3') as string;
					const speed = this.getNodeParameter('speed', i, 1) as number;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;

					if (!text.trim()) {
						throw new NodeOperationError(this.getNode(), 'Text is empty', {
							itemIndex: i,
							description: 'Provide the text you want ReadAloud to speak.',
						});
					}
					if (text.length > MAX_CHARACTERS) {
						throw new NodeOperationError(this.getNode(), `Text is too long (${text.length} characters)`, {
							itemIndex: i,
							description: `ReadAloud accepts at most ${MAX_CHARACTERS} characters per request. Split the text into smaller items.`,
						});
					}
					if (!FORMATS[format]) {
						throw new NodeOperationError(this.getNode(), `Unsupported output format "${format}"`, {
							itemIndex: i,
						});
					}
					if (typeof speed !== 'number' || speed < 0.25 || speed > 4) {
						throw new NodeOperationError(this.getNode(), 'Speed must be between 0.25 and 4', {
							itemIndex: i,
						});
					}

					fileBase = ((options.fileName as string) || 'speech').trim() || 'speech';
					binaryProperty = ((options.binaryPropertyName as string) || 'data').trim() || 'data';

					requestOptions.method = 'POST';
					requestOptions.url = `${baseUrl}/v1/audio/speech`;
					requestOptions.json = false;
					requestOptions.encoding = 'arraybuffer';
					requestOptions.headers = { 'Content-Type': 'application/json', Accept: '*/*' };
					requestOptions.body = JSON.stringify({
						model: (options.model as string) || 'tts-1',
						input: text,
						voice,
						response_format: format,
						speed,
					});
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'readAloudApi',
					requestOptions,
				)) as { body: unknown; statusCode: number; headers: IDataObject };

				if (response.statusCode < 200 || response.statusCode >= 300) {
					const { message: apiMessage, raw } = parseErrorBody(response.body);
					const { message, description } = describeApiError(response.statusCode, apiMessage);
					throw new NodeApiError(this.getNode(), raw as JsonObject, {
						message,
						description,
						httpCode: String(response.statusCode),
						itemIndex: i,
					});
				}

				const raw = response.body;
				const audio = Buffer.isBuffer(raw)
					? raw
					: raw instanceof ArrayBuffer
						? Buffer.from(raw)
						: Buffer.from(raw as string, 'binary');
				if (audio.length === 0) {
					throw new NodeOperationError(this.getNode(), 'ReadAloud returned an empty audio response', {
						itemIndex: i,
					});
				}

				const meta = FORMATS[format];
				const headerType = String(response.headers?.['content-type'] ?? '')
					.split(';')[0]
					.trim();
				const mimeType = headerType.startsWith('audio/') ? headerType : meta.mimeType;
				const fileName = `${fileBase}.${meta.extension}`;
				const binaryData = await this.helpers.prepareBinaryData(audio, fileName, mimeType);

				const sampleRate = Number(response.headers?.['x-sample-rate']);
				returnData.push({
					json: {
						voice,
						format,
						characters: text.length,
						bytes: audio.length,
						...(Number.isFinite(sampleRate) && sampleRate > 0 ? { sampleRate } : {}),
					},
					binary: { [binaryProperty]: binaryData },
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
