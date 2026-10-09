# n8n-nodes-readaloud

This is an n8n community node. It lets you use [ReadAloud](https://readaloudai.org) in your n8n workflows to turn text into spoken audio.

ReadAloud is a text-to-speech service with a streaming, OpenAI-compatible speech API. This node sends text to the API and returns the audio as n8n binary data, ready to save, upload, email or pass to another node.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Error handling](#error-handling)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install the package `n8n-nodes-readaloud`.

## Operations

**Speech**

- **Text to Speech**: convert text (up to 5000 characters per item) into an audio file.
  - **Text**: the text to speak.
  - **Voice**: voice ID, free text. Defaults to `piper-default`, which is currently the only voice offered.
  - **Output Format**: MP3, WAV, Opus (Ogg) or PCM (raw 16-bit).
  - **Speed**: 0.25 to 4, default 1.
  - **Options**: base file name, binary property name (default `data`), model name (default `tts-1`).

The node can also be used as a tool by AI agents (`usableAsTool`).

## Credentials

You need a ReadAloud account and an API key.

1. Sign up at [readaloudai.org](https://readaloudai.org) and create an API key.
2. In n8n, create a **ReadAloud API** credential and paste the key into **API Key**.
3. Leave **Base URL** at `https://api.readaloudai.org` unless you use a self-hosted or proxied gateway.

The key is sent as `Authorization: Bearer <key>`. Saving the credential runs a test request against `GET /v1/voices`.

## Compatibility

Built with `n8n-workflow` 2.x and the `@n8n/node-cli` toolchain (`n8nNodesApiVersion` 1). Tested against n8n 2.x on Node.js 24. It uses only n8n's built-in HTTP helpers and has no runtime dependencies, so it is suitable for n8n Cloud.

## Usage

The audio is written to the binary property `data` of the output item (change this under Options). Typical chains:

- ReadAloud -> **Write Binary File** to save the audio on disk.
- ReadAloud -> Google Drive / S3 / Slack / Email to share it.
- ReadAloud -> **Convert to File** or an HTTP Request node to forward it.

The JSON part of each output item contains `voice`, `format`, `characters`, `bytes` and, when the API reports it, `sampleRate`.

An importable example is in [`examples/text-to-speech.workflow.json`](examples/text-to-speech.workflow.json): a manual trigger, a ReadAloud node and a Write Binary File node. Select your own credential after importing.

Text longer than 5000 characters must be split into several items first (for example with a Code or Split node).

## Error handling

| HTTP status | Node message |
| --- | --- |
| 401 | Invalid ReadAloud API key |
| 402 | ReadAloud free tier exhausted (add credit or upgrade at readaloudai.org) |
| 400 / 404 / 422 | ReadAloud rejected the request, with the API's reason |
| 429 / 503 | ReadAloud is busy or rate limited, try again |

The free allowance is a single capped pool per account owner, shared across all of that owner's API keys. Creating more keys does not increase it.

Enable **Continue On Fail** on the node to get an item with an `error` field instead of stopping the workflow.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [ReadAloud](https://readaloudai.org)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
