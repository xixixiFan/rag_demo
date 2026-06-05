import { Langfuse } from 'langfuse';
import config from '../config/index.js';

const langfuse = new Langfuse({
    publicKey: config.langfuse.publicKey,
    secretKey: config.langfuse.secretKey,
    baseUrl: config.langfuse.baseUrl,
    requestTimeout: config.langfuse.timeout,
});

process.on('exit', () => {
    langfuse.shutdownAsync();
});

export default langfuse;