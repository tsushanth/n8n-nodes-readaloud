import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class ReadAloudApi implements ICredentialType {
	name = 'readAloudApi';

	displayName = 'ReadAloud API';

	icon: Icon = { light: 'file:readaloud.svg', dark: 'file:readaloud.dark.svg' };

	documentationUrl = 'https://github.com/tsushanth/n8n-nodes-readaloud#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your ReadAloud API key, created at readaloudai.org',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.readaloudai.org',
			description: 'Only change this if you use a self-hosted or proxied ReadAloud gateway',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{($credentials.baseUrl || "https://api.readaloudai.org").replace(/\\/+$/, "")}}',
			url: '/v1/voices',
			method: 'GET',
		},
	};
}
