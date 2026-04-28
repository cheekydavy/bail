import { BinaryNode } from '../WABinary'

// MessageType is intentionally NOT exported here — the same name is already
// exported from './messages' via Utils/index.ts. Exporting it again causes
// TS2308 "already exported" error at build time.
// This local alias is only used internally within this file.
type MessageType = 'message' | 'call' | 'receipt' | 'notification'

type OfflineNode = { type: MessageType; node: BinaryNode }

export type OfflineNodeProcessorDeps = {
	isWsOpen: () => boolean
	onUnexpectedError: (err: Error, msg: string) => void
	yieldToEventLoop: () => Promise<void>
}

export function makeOfflineNodeProcessor(
	nodeProcessorMap: Map<MessageType, (node: BinaryNode) => Promise<void>>,
	deps: OfflineNodeProcessorDeps,
	batchSize = 10
) {
	const nodes: OfflineNode[] = []
	let isProcessing = false

	const enqueue = (type: MessageType, node: BinaryNode) => {
		nodes.push({ type, node })

		if(isProcessing) return
		isProcessing = true

		const runLoop = async() => {
			let count = 0
			while(nodes.length && deps.isWsOpen()) {
				const item = nodes.shift()!
				const processor = nodeProcessorMap.get(item.type)
				if(!processor) {
					deps.onUnexpectedError(
						new Error(`unknown offline node type: ${item.type}`),
						'processing offline node'
					)
					continue
				}
				await processor(item.node).catch(err =>
					deps.onUnexpectedError(err, `processing offline ${item.type}`)
				)
				count++
				if(count >= batchSize) {
					count = 0
					await deps.yieldToEventLoop()
				}
			}
			isProcessing = false
		}

		runLoop().catch(err => deps.onUnexpectedError(err, 'offline node processor loop'))
	}

	return { enqueue }
}
