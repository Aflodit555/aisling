import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleAlibabaTts(req: IncomingMessage, res: ServerResponse): Promise<void>
