import { BinaryNode } from '../WABinary'

// Exported so messages-recv.ts can import it directly.
// NOT re-exported through Utils/index.ts barrel (that would cause TS2308
// conflict with the MessageType already exported from Types via messages.ts).
export type MessageType = 'message' | 'call' | 'receipt' | 'notification'

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
