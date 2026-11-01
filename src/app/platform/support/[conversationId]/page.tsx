import SupportInboxClient from '../SupportInboxClient'

export default async function PlatformSupportConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = await params
  return <SupportInboxClient initialConversationId={conversationId} />
}
