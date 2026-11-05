import { withAttachmentPaths, type AttachmentResolution, type ParkedPrompt } from '@parked-prompts/core'

export type SdkAttachment =
  | { type: 'file'; path: string; displayName?: string }
  | { type: 'selection'; filePath: string; displayName: string; selection: { start: { line: number; character: number }; end: { line: number; character: number } } }

/** A prompt's attachments in the shape `session.send` takes. */
export function toSdkAttachments(resolution: AttachmentResolution): SdkAttachment[] {
  return resolution.resolved.map(item => {
    if (!item.range) return { type: 'file', path: item.absolutePath, displayName: item.name }
    return {
      type: 'selection',
      filePath: item.absolutePath,
      displayName: item.name,
      // The SDK counts lines from zero. The end is the start of the line after the range.
      selection: { start: { line: item.range.startLine - 1, character: 0 }, end: { line: item.range.endLine, character: 0 } },
    }
  })
}

export interface Delivery {
  prompt: string
  attachments: SdkAttachment[]
  mode: 'enqueue' | 'immediate'
}

/**
 * What goes to the agent. The paths are also listed in the text, so the agent can
 * read the files even if a host ignores `attachments`, which canvas-kit passes through
 * without declaring. The full text shows in the chat, so nothing is sent unseen.
 */
export function buildDelivery(prompt: ParkedPrompt, resolution: AttachmentResolution, mode: Delivery['mode']): Delivery {
  return { prompt: withAttachmentPaths(prompt.body, resolution), attachments: toSdkAttachments(resolution), mode }
}
