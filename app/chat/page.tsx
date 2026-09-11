import { ChatWorkspace } from "../../components/chat-workspace";
import { metadataForRoute } from "../../lib/metadata";
export const metadata = metadataForRoute("/chat");
export default function ChatPage() { return <ChatWorkspace />; }
