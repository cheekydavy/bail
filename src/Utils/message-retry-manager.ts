import { ILogger } from './logger'
import { proto } from '../../WAProto'

const RECENT_MESSAGES_SIZE = 256
const RECREATE_SESSION_TIMEOUT = 60 * 60 * 1000 // 1 hour

export interface RecentMessage {
	message: proto.IMessage
	timestamp: number
}

export class MessageRetryManager {
	private recentMessages = new Map<string, RecentMessage>()
	private sessionRecreateHistory = new Map<string, number>()
	private retryCounters = new Map<string, number>()
	private pendingPhoneRequests: Record<string, ReturnType<typeof setTimeout>> = {}
	private readonly maxMsgRetryCount: number

	constructor(
		private logger: ILogger,
		maxMsgRetryCount: number
	) {
		this.maxMsgRetryCount = maxMsgRetryCount
	}

	addRecentMessage(to: string, id: string, message: proto.IMessage): void {
		const key = `${to}:${id}`
		if(this.recentMessages.size >= RECENT_MESSAGES_SIZE) {
			// evict oldest entry
			const oldest = this.recentMessages.keys().next().value
			if(oldest) this.recentMessages.delete(oldest)
		}
		this.recentMessages.set(key, { message, timestamp: Date.now() })
	}

	getRecentMessage(to: string, id: string): RecentMessage | undefined {
		return this.recentMessages.get(`${to}:${id}`)
	}

	private removeRecentMessage(id: string): void {
		for(const key of this.recentMessages.keys()) {
			if(key.endsWith(`:${id}`)) {
				this.recentMessages.delete(key)
				break
			}
		}
	}

	incrementRetryCount(messageId: string): number {
		const count = (this.retryCounters.get(messageId) || 0) + 1
		this.retryCounters.set(messageId, count)
		return count
	}

	getRetryCount(messageId: string): number {
		return this.retryCounters.get(messageId) || 0
	}

	hasExceededMaxRetries(messageId: string): boolean {
		return this.getRetryCount(messageId) >= this.maxMsgRetryCount
	}

	markRetrySuccess(messageId: string): void {
		this.retryCounters.delete(messageId)
		this.cancelPendingPhoneRequest(messageId)
		this.removeRecentMessage(messageId)
	}

	markRetryFailed(messageId: string): void {
		this.retryCounters.delete(messageId)
		this.cancelPendingPhoneRequest(messageId)
		this.removeRecentMessage(messageId)
	}

	shouldRecreateSession(jid: string, hasSession: boolean): { recreate: boolean; reason: string } {
		if(!hasSession) {
			this.sessionRecreateHistory.set(jid, Date.now())
			return { recreate: true, reason: "no Signal session exists" }
		}
		const now = Date.now()
		const prev = this.sessionRecreateHistory.get(jid)
		if(!prev || now - prev > RECREATE_SESSION_TIMEOUT) {
			this.sessionRecreateHistory.set(jid, now)
			return { recreate: true, reason: "retry count > 1 and over an hour since last recreation" }
		}
		return { recreate: false, reason: '' }
	}

	schedulePhoneRequest(messageId: string, callback: () => void, delayMs = 3000): void {
		this.cancelPendingPhoneRequest(messageId)
		this.pendingPhoneRequests[messageId] = setTimeout(() => {
			delete this.pendingPhoneRequests[messageId]
			callback()
		}, delayMs)
		this.logger.debug({ messageId }, 'scheduled phone resend request')
	}

	cancelPendingPhoneRequest(messageId: string): void {
		const t = this.pendingPhoneRequests[messageId]
		if(t) {
			clearTimeout(t)
			delete this.pendingPhoneRequests[messageId]
		}
	}
}
